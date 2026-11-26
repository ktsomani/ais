import type { PRMetadata, PRTarget, RawReviewThread } from './types.js';

const REST_BASE = 'https://api.github.com';
const GRAPHQL_URL = 'https://api.github.com/graphql';

export interface CheckRunSummary {
  id: number;
  name: string;
  conclusion: string | null;
  appSlug: string | null;
  outputTitle: string | null;
  outputSummary: string | null;
  outputText: string | null;
}

const FAILING_CONCLUSIONS = new Set([
  'failure',
  'timed_out',
  'action_required',
  'startup_failure',
]);

export class GitHubClient {
  constructor(private readonly token: string) {}

  private headers(accept = 'application/vnd.github+json'): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ais-cli/0.1.0',
    };
  }

  async findOpenPRForBranch(
    owner: string,
    repo: string,
    branch: string,
  ): Promise<PRMetadata> {
    const url = `${REST_BASE}/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(
      `${owner}:${branch}`,
    )}&per_page=1`;

    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) {
      throw new Error(`GitHub API error (${res.status}) finding PR for branch "${branch}"`);
    }

    const prs = (await res.json()) as Array<{
      number: number;
      title: string;
      head: { ref: string; sha: string };
    }>;

    if (prs.length === 0) {
      throw new Error(`No open PR found for branch "${branch}" in ${owner}/${repo}.`);
    }

    const pr = prs[0];
    return {
      owner,
      repo,
      number: pr.number,
      title: pr.title,
      branch: pr.head.ref,
      headSha: pr.head.sha,
    };
  }

  async getPRMetadata(target: PRTarget): Promise<PRMetadata> {
    const url = `${REST_BASE}/repos/${target.owner}/${target.repo}/pulls/${target.number}`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) {
      throw new Error(
        `GitHub API error (${res.status}) fetching PR #${target.number} in ${target.owner}/${target.repo}`,
      );
    }

    const pr = (await res.json()) as {
      number: number;
      title: string;
      head: { ref: string; sha: string };
    };

    return {
      owner: target.owner,
      repo: target.repo,
      number: pr.number,
      title: pr.title,
      branch: pr.head.ref,
      headSha: pr.head.sha,
    };
  }

  async getFailingCheckRuns(
    owner: string,
    repo: string,
    headSha: string,
  ): Promise<CheckRunSummary[]> {
    const url = `${REST_BASE}/repos/${owner}/${repo}/commits/${headSha}/check-runs?per_page=100`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) {
      throw new Error(`GitHub API error (${res.status}) fetching check runs for ${headSha}`);
    }

    const data = (await res.json()) as {
      check_runs: Array<{
        id: number;
        name: string;
        conclusion: string | null;
        app?: { slug?: string | null } | null;
        output?: {
          title?: string | null;
          summary?: string | null;
          text?: string | null;
        } | null;
      }>;
    };

    return data.check_runs
      .filter((run) => run.conclusion !== null && FAILING_CONCLUSIONS.has(run.conclusion))
      .map((run) => ({
        id: run.id,
        name: run.name,
        conclusion: run.conclusion,
        appSlug: run.app?.slug ?? null,
        outputTitle: run.output?.title ?? null,
        outputSummary: run.output?.summary ?? null,
        outputText: run.output?.text ?? null,
      }));
  }

  async getActionsJobLog(owner: string, repo: string, jobId: number): Promise<string | null> {
    const url = `${REST_BASE}/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`;
    const res = await fetch(url, {
      headers: this.headers(),
      redirect: 'manual',
    });

    // GitHub redirects to a signed Azure Blob URL; fetch without Authorization header
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return null;
      const logRes = await fetch(location);
      if (!logRes.ok) return null;
      return await logRes.text();
    }

    if (res.ok) {
      return await res.text();
    }

    return null;
  }

  async getReviewThreads(target: PRTarget): Promise<RawReviewThread[]> {
    const query = `
      query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            reviewThreads(first: 100, after: $cursor) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                id
                isResolved
                isOutdated
                isCollapsed
                path
                line
                originalLine
                comments(first: 10) {
                  nodes {
                    author { login }
                    body
                    diffHunk
                  }
                }
              }
            }
          }
        }
      }
    `;

    const allThreads: RawReviewThread[] = [];
    let cursor: string | null = null;

    while (true) {
      const res = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: {
          ...this.headers(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          variables: {
            owner: target.owner,
            repo: target.repo,
            number: target.number,
            cursor,
          },
        }),
      });

      if (!res.ok) {
        throw new Error(`GitHub GraphQL error (${res.status}) fetching review threads`);
      }

      const payload = (await res.json()) as {
        data?: {
          repository?: {
            pullRequest?: {
              reviewThreads?: {
                pageInfo: { hasNextPage: boolean; endCursor: string | null };
                nodes: RawReviewThread[];
              };
            };
          };
        };
        errors?: Array<{ message: string }>;
      };

      if (payload.errors?.length) {
        throw new Error(`GitHub GraphQL error: ${payload.errors[0].message}`);
      }

      const conn = payload.data?.repository?.pullRequest?.reviewThreads;
      if (!conn) break;

      allThreads.push(...conn.nodes);
      if (!conn.pageInfo.hasNextPage || !conn.pageInfo.endCursor) break;
      cursor = conn.pageInfo.endCursor;
    }

    return allThreads;
  }
}