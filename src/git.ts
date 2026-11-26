// @ts-ignore Node.js type definitions are not available in this project.
import { execFileSync } from 'child_process';
import type { PRTarget } from './types.js';

const PR_URL_REGEX =
  /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/i;

export function parsePRUrl(input: string): PRTarget | null {
  const match = input.trim().match(PR_URL_REGEX);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2],
    number: Number.parseInt(match[3], 10),
  };
}

export function parseGitRemoteUrl(remoteUrl: string): { owner: string; repo: string } {
  const trimmed = remoteUrl.trim();

  // SSH: git@github.com:owner/repo.git
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  // HTTPS / SSH URL: https://github.com/owner/repo.git or ssh://git@github.com/owner/repo.git
  const urlMatch = trimmed.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2] };
  }

  throw new Error(`Could not parse GitHub owner/repo from git remote: ${trimmed}`);
}

export function getLocalGitContext(cwd?: string): {
  owner: string;
  repo: string;
  branch: string;
} {
  try {
    const remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

    const { owner, repo } = parseGitRemoteUrl(remoteUrl);
    return { owner, repo, branch };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to detect local git repository/branch: ${msg}`);
  }
}