import { countTokens } from './tokens.js';
import type { RawReviewThread, UnresolvedReview } from './types.js';

const MAX_HUNK_LINES = 8;
const MIN_HUNK_LINES = 5;

const SYMBOL_DECLARATION_REGEX =
  /(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|def|func)\s+(?:\([^)]+\)\s+)?([A-Za-z_][A-Za-z0-9_]*)/;

export function extractAnchoredHunk(diffHunk: string, maxLines = MAX_HUNK_LINES): string {
  const lines = diffHunk
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((l, idx, arr) => !(idx === arr.length - 1 && l === ''));

  if (lines.length <= maxLines) {
    return lines.join('\n');
  }

  // GitHub anchors review comments to the end of diffHunk; take the trailing 5–10 lines
  const windowSize = Math.max(MIN_HUNK_LINES, Math.min(10, maxLines));
  return lines.slice(-windowSize).join('\n');
}

export function extractSymbolFromHunk(diffHunk: string): string | undefined {
  const lines = diffHunk.split('\n').reverse();
  for (const line of lines) {
    const clean = line.replace(/^[+-@ ]+/, '');
    const match = clean.match(SYMBOL_DECLARATION_REGEX);
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
}

export function trimReviewComment(body: string, maxChars = 160): string {
  const collapsed = body
    .replace(/\r\n/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/<\/?[^>]+(>|$)/g, '')
    .replace(/```[\s\S]*?```/g, '[code]')
    .replace(/\s+/g, ' ')
    .trim();

  if (collapsed.length <= maxChars) return collapsed;
  return collapsed.slice(0, maxChars - 1).trimEnd() + '…';
}

export function filterUnresolvedThreads(rawThreads: RawReviewThread[]): UnresolvedReview[] {
  return rawThreads
    .filter(
      (t) =>
        !t.isResolved &&
        !t.isOutdated &&
        !t.isCollapsed &&
        t.comments.nodes.length > 0,
    )
    .map((t) => {
      const first = t.comments.nodes[0];
      const hunk = extractAnchoredHunk(first.diffHunk);
      return {
        file: t.path,
        line: t.line ?? t.originalLine ?? 1,
        author: first.author?.login ?? 'reviewer',
        comment: trimReviewComment(first.body),
        diffHunk: hunk,
        symbol: extractSymbolFromHunk(first.diffHunk),
      };
    });
}

export function formatFullReviewItem(r: UnresolvedReview): string {
  return [
    `- **\`${r.file}:${r.line}\`** (@${r.author}): ${r.comment}`,
    '  ```diff',
    ...r.diffHunk.split('\n').map((l) => `  ${l}`),
    '  ```',
  ].join('\n');
}

export function formatCompactReviewItem(r: UnresolvedReview): string {
  return `- **\`${r.file}:${r.line}\`** (@${r.author}): ${r.comment}`;
}

export interface RenderedReviewsResult {
  markdown: string;
  included: UnresolvedReview[];
  truncatedCount: number;
  usedCompactMode: boolean;
}

export function renderReviewsWithinBudget(
  reviews: UnresolvedReview[],
  budgetTokens: number,
  full: boolean,
): RenderedReviewsResult {
  if (reviews.length === 0) {
    return {
      markdown: '- None',
      included: [],
      truncatedCount: 0,
      usedCompactMode: false,
    };
  }

  const fullBlocks = reviews.map(formatFullReviewItem);
  const fullMarkdown = fullBlocks.join('\n');

  if (full || countTokens(fullMarkdown) <= budgetTokens) {
    return {
      markdown: fullMarkdown,
      included: reviews,
      truncatedCount: 0,
      usedCompactMode: false,
    };
  }

  // Overflow without --full: switch to compact 1-line-per-thread summaries
  const footerReserve = countTokens(
    `\n[TRUNCATED: ${reviews.length} more unresolved threads — rerun with --full]`,
  );
  const compactLimit = Math.max(0, budgetTokens - footerReserve);

  const lines: string[] = [];
  const included: UnresolvedReview[] = [];
  let usedTokens = 0;

  for (const review of reviews) {
    const line = formatCompactReviewItem(review);
    const lineTokens = countTokens((lines.length > 0 ? '\n' : '') + line);
    if (usedTokens + lineTokens > compactLimit) {
      break;
    }
    lines.push(line);
    included.push(review);
    usedTokens += lineTokens;
  }

  const truncatedCount = reviews.length - included.length;
  if (truncatedCount > 0) {
    lines.push(`[TRUNCATED: ${truncatedCount} more unresolved threads — rerun with --full]`);
  }

  return {
    markdown: lines.join('\n'),
    included,
    truncatedCount,
    usedCompactMode: true,
  };
}