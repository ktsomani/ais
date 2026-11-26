import { renderReviewsWithinBudget } from './reviews.js';
import { countTokens, truncateToTokens } from './tokens.js';
import type {
  BlastRadiusTuple,
  CompileOptions,
  FailingCheck,
  PRMetadata,
  TriageBrief,
  UnresolvedReview,
} from './types.js';

function formatCheckBlock(check: FailingCheck, maxTraceLines: number): string {
  const lines = check.stackTrace.slice(0, maxTraceLines);
  if (lines.length === 0) {
    return `- **${check.jobName}**: \`${check.errorSummary}\``;
  }
  return [
    `- **${check.jobName}**: \`${check.errorSummary}\``,
    '  ```text',
    ...lines.map((l) => `  ${l}`),
    '  ```',
  ].join('\n');
}

function renderCISection(checks: FailingCheck[], budgetTokens: number, full: boolean): string {
  if (checks.length === 0) return '- None';

  const blocks: string[] = [];
  let used = 0;

  for (const check of checks) {
    let block = formatCheckBlock(check, check.stackTrace.length);
    if (!full && used + countTokens(block) > budgetTokens) {
      // Progressively trim stack trace lines to stay within Priority 1 budget
      const remaining = Math.max(0, budgetTokens - used);
      let fitted: string | null = null;
      for (let keep = Math.min(check.stackTrace.length, 6); keep >= 0; keep--) {
        const candidate = formatCheckBlock(check, keep);
        if (countTokens(candidate) <= remaining) {
          fitted = candidate;
          break;
        }
      }
      if (!fitted) {
        if (blocks.length === 0 && remaining > 12) {
          fitted = truncateToTokens(formatCheckBlock(check, 0), remaining);
        } else {
          break;
        }
      }
      block = fitted;
    }

    blocks.push(block);
    used += countTokens((blocks.length > 1 ? '\n' : '') + block);
  }

  return blocks.join('\n') || '- None';
}

function renderBlastRadiusSection(
  tuples: BlastRadiusTuple[],
  budgetTokens: number,
  full: boolean,
): string {
  if (tuples.length === 0) return '- None';

  const lines: string[] = [];
  let used = 0;

  for (const t of tuples) {
    const callers = t.callers.join(', ');
    const tests = t.tests.join(', ');
    const line = `- \`${t.file} -> ${t.symbol} -> callers: [${callers}] | tests: [${tests}]\``;
    const cost = countTokens((lines.length > 0 ? '\n' : '') + line);

    if (!full && used + cost > budgetTokens) {
      break;
    }
    lines.push(line);
    used += cost;
  }

  return lines.join('\n') || '- None';
}

function assembleMarkdown(
  pr: PRMetadata,
  tokenCount: number,
  budget: number,
  failedChecksCount: number,
  unresolvedThreadsCount: number,
  ciBody: string,
  reviewsBody: string,
  blastBody: string,
): string {
  return [
    `# PR #${pr.number}: ${pr.title} (${pr.branch})`,
    `Tokens: ${tokenCount}/${budget} | Failed Checks: ${failedChecksCount} | Unresolved Threads: ${unresolvedThreadsCount}`,
    '',
    '## 1. Failing CI',
    ciBody,
    '',
    '## 2. Unresolved Reviews',
    reviewsBody,
    '',
    '## 3. Blast Radius',
    blastBody,
  ].join('\n');
}

export function compileBrief(
  pr: PRMetadata,
  failingChecks: FailingCheck[],
  unresolvedReviews: UnresolvedReview[],
  blastRadius: BlastRadiusTuple[],
  options: CompileOptions,
): { markdown: string; brief: TriageBrief } {
  const { budget, full } = options;

  // Measure fixed scaffolding overhead (~5% of budget)
  const scaffoldTokens = countTokens(
    assembleMarkdown(
      pr,
      budget,
      budget,
      failingChecks.length,
      unresolvedReviews.length,
      '',
      '',
      '',
    ),
  );

  const available = Math.max(0, budget - scaffoldTokens);

  // Priority allocations: 45% CI, 35% Reviews, 15% Blast Radius (unused budget rolls forward)
  const ciBudget = Math.floor(available * 0.45);
  let ciBody = renderCISection(failingChecks, ciBudget, full);
  const ciUsed = countTokens(ciBody);

  const reviewBudget = Math.floor(available * 0.35) + Math.max(0, ciBudget - ciUsed);
  const reviewResult = renderReviewsWithinBudget(unresolvedReviews, reviewBudget, full);
  let reviewsBody = reviewResult.markdown;
  const reviewsUsed = countTokens(reviewsBody);

  const blastBudget = Math.max(0, available - ciUsed - reviewsUsed);
  let blastBody = renderBlastRadiusSection(blastRadius, blastBudget, full);

  // Strict budget enforcement when --full is not set
  let finalMarkdown = assembleMarkdown(
    pr,
    0,
    budget,
    failingChecks.length,
    unresolvedReviews.length,
    ciBody,
    reviewsBody,
    blastBody,
  );

  let actualTokens = countTokens(finalMarkdown);
  finalMarkdown = assembleMarkdown(
    pr,
    actualTokens,
    budget,
    failingChecks.length,
    unresolvedReviews.length,
    ciBody,
    reviewsBody,
    blastBody,
  );
  actualTokens = countTokens(finalMarkdown);

  // Hard cap fallback in case of tight custom --budget values
  if (!full && actualTokens > budget) {
    const excess = actualTokens - budget;
    if (blastBody !== '- None') {
      blastBody = '- None';
    }
    finalMarkdown = assembleMarkdown(
      pr,
      actualTokens,
      budget,
      failingChecks.length,
      unresolvedReviews.length,
      ciBody,
      reviewsBody,
      blastBody,
    );
    actualTokens = countTokens(finalMarkdown);

    if (actualTokens > budget) {
      const targetBodyTokens = Math.max(0, countTokens(ciBody) - (actualTokens - budget) - 2);
      ciBody = truncateToTokens(ciBody, targetBodyTokens);
      finalMarkdown = assembleMarkdown(
        pr,
        actualTokens,
        budget,
        failingChecks.length,
        unresolvedReviews.length,
        ciBody,
        reviewsBody,
        blastBody,
      );
      actualTokens = countTokens(finalMarkdown);
    }

    if (actualTokens > budget && excess > 0) {
      finalMarkdown = truncateToTokens(finalMarkdown, budget, '');
      actualTokens = countTokens(finalMarkdown);
    } else {
      // Refresh exact token header after trimming
      finalMarkdown = assembleMarkdown(
        pr,
        actualTokens,
        budget,
        failingChecks.length,
        unresolvedReviews.length,
        ciBody,
        reviewsBody,
        blastBody,
      );
      actualTokens = countTokens(finalMarkdown);
    }
  }

  const brief: TriageBrief = {
    pr,
    tokens: actualTokens,
    budget,
    failedChecksCount: failingChecks.length,
    unresolvedThreadsCount: unresolvedReviews.length,
    truncatedThreadsCount: reviewResult.truncatedCount,
    failingChecks,
    unresolvedReviews: reviewResult.included,
    blastRadius,
  };

  return { markdown: finalMarkdown, brief };
}