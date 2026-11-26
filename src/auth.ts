
import { execFileSync } from 'node:child_process';

export function resolveGitHubToken(): string {
  const envToken = (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }).process?.env?.GITHUB_TOKEN?.trim();
  if (envToken) {
    return envToken;
  }

  try {
    const ghToken = execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    }).trim();

    if (ghToken) {
      return ghToken;
    }
  } catch {
    // Fall through to unified error message
  }

  throw new Error(
    'No GitHub token found. Set GITHUB_TOKEN or authenticate with `gh auth login`.',
  );
}