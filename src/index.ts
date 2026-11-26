import { resolveGitHubToken } from './auth.js';
import { computeBlastRadius } from './blast-radius.js';
import { parseFailingJobLog } from './ci-parser.js';
import { compileBrief } from './compiler.js';
import { getLocalGitContext, parsePRUrl } from './git.js';
import { GitHubClient } from './github.js';
import { filterUnresolvedThreads } from './reviews.js';
import type { FailingCheck, PRMetadata } from './types.js';

export interface FixCommandOptions {
  pr?: string;
  budget: number;
  full: boolean;
  json: boolean;
  cwd?: string;
}

export async function runFix(options: FixCommandOptions): Promise<string> {
  const token = resolveGitHubToken();
  const client = new GitHubClient(token);
  const cwd = options.cwd ?? '.';

  let pr: PRMetadata;
  const rawPr = options.pr?.trim();

  if (!rawPr) {
    const local = getLocalGitContext(cwd);
    pr = await client.findOpenPRForBranch(local.owner, local.repo, local.branch);
  } else {
    const parsedUrl = parsePRUrl(rawPr);
    if (parsedUrl) {
      pr = await client.getPRMetadata(parsedUrl);
    } else if (/^#?\d+$/.test(rawPr)) {
      const local = getLocalGitContext(cwd);
      pr = await client.getPRMetadata({
        owner: local.owner,
        repo: local.repo,
        number: Number.parseInt(rawPr.replace(/^#/, ''), 10),
      });
    } else {
      throw new Error(
        `Invalid PR identifier "${rawPr}". Pass a PR number (e.g. 42) or full GitHub PR URL.`,
      );
    }
  }

  const [failedCheckRuns, rawThreads] = await Promise.all([
    client.getFailingCheckRuns(pr.owner, pr.repo, pr.headSha),
    client.getReviewThreads(pr),
  ]);

  const failingChecks: FailingCheck[] = await Promise.all(
    failedCheckRuns.map(async (run) => {
      const rawLog = await client.getActionsJobLog(pr.owner, pr.repo, run.id);
      if (rawLog) {
        return parseFailingJobLog(run.name, rawLog);
      }
      const fallbackText = [run.outputTitle, run.outputSummary, run.outputText]
        .filter((s): s is string => Boolean(s))
        .join('\n');
      return parseFailingJobLog(run.name, fallbackText);
    }),
  );

  const unresolvedReviews = filterUnresolvedThreads(rawThreads);
  const blastRadius = computeBlastRadius(failingChecks, unresolvedReviews, cwd);

  const { markdown, brief } = compileBrief(
    pr,
    failingChecks,
    unresolvedReviews,
    blastRadius,
    { budget: options.budget, full: options.full },
  );

  return options.json ? JSON.stringify(brief, null, 2) : markdown;
}