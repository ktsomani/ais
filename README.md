# haq

Fast, deterministic, failure-first PR triage CLI that compiles a sub-1,000-token Markdown brief for unblocking stuck GitHub PRs.

Zero LLM calls. Exact `o200k_base` token budgeting. Cross-platform (Windows, macOS, Linux).

## Why `haq`?

Raw GitHub PRs dump tens of thousands of tokens of runner setup logs, ANSI codes, resolved review chatter, and third-party stack frames into your context window. `haq` deterministically strips the noise and compiles only what you need to unblock a PR:

1. **Failing CI Checks (~45% budget)** — Strips ANSI codes, timestamps, runner setup/teardown blocks, and third-party/stdlib stack frames (`node_modules`, `site-packages`, `/usr/local/go`, etc.). Retains job/step name, command, primary error, and user-land frames.
2. **Unresolved Review Hunks (~35% budget)** — Fetches only `isResolved: false` threads via GitHub GraphQL, drops outdated/collapsed noise and bot badge markup, and anchors each comment to its 5–10 line diff hunk. Switches to compact 1-line summaries on overflow unless `--full` is set.
3. **Filtered Blast Radius (~15% budget)** — Scopes strictly to files and symbols already referenced in failing stack traces or unresolved reviews, emitting `file -> symbol -> callers | tests` tuples via local `git grep`.

## Requirements

- Node.js 20+
- GitHub credentials via `GITHUB_TOKEN` or an authenticated [GitHub CLI (`gh`)](https://cli.github.com/) session

## Installation

bash
git clone [https://github.com/ktsomani/haq.git](https://github.com/ktsomani/haq.git)
cd haq
npm install
npm run build
npm link


## Authentication

`haq` requires no login flow or config file. It resolves credentials automatically in this order:

1. process.env.GITHUB_TOKEN`
2. gh auth token`

## Usage

bash
# Auto-detect the open PR for your current local git branch
haq fix

# Triage by PR number in the current repo
haq fix 42

# Triage any PR by URL
haq fix [https://github.com/owner/repo/pull/42](https://github.com/owner/repo/pull/42)


### Flags

| Flag | Default | Description |
| :--- | :--- | :--- |
| `--budget <number>` | `1000` | Max token cap counted with `o200k_base` |
| `--full` | `false` | Disable truncation when unresolved review threads overflow the budget |
| `--json` | `false` | Output structured JSON instead of Markdown (for eval pipelines) |

### Piping to Coding Agents

bash
haq fix 42 | pbcopy                     # macOS
haq fix 42 | clip                       # Windows
haq fix 42 --json > pr-brief.json       # Downstream evals


## Example Output

md
# PR #42: Fix JWT expiry check (fix/jwt-exp)
Tokens: 412/1000 | Failed Checks: 1 | Unresolved Threads: 1

## 1. Failing CI
- **unit-tests (npm test)**: `FAIL src/auth/jwt.test.ts > verifySession > rejects expired tokens`
  text
  $ npm test
  AssertionError: expected true to be false
  ❯ src/auth/jwt.test.ts:42:28
  at verifySession (src/auth/jwt.ts:19:12)

## 2. Unresolved Reviews
- **`src/auth/jwt.ts:24`** (@alice): Check `exp` against UTC seconds instead of milliseconds.
  diff
  const payload = decode(token);
  if (!payload) return false;
  const now = Date.now();
  - return payload.exp > now;
  + return payload.exp >= now;
  

## 3. Blast Radius
- src/auth/jwt.ts -> verifySession -> callers: [src/routes/login.ts] | tests: [src/auth/jwt.test.ts]


## Development

bash
npm run build   # Compile TypeScript to dist/
npm test        # Run Vitest unit test suite

## Benchmarks (10 Live PRs)

Measured with `o200k_base` comparing raw PR context (`gh pr view` + `gh pr diff`) against `haq fix`:

| PR | Raw Tokens | `haq` Tokens | Ratio | CI Checks | Reviews | Time |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| `twentyhq/twenty#31534` | 22,881 | 338 | 67.7x | 2 | 1 | 6.3s |
| `twentyhq/twenty#31494` | 30,255 | 844 | 35.8x | 1 | 4 | 6.6s |
| `twentyhq/twenty#31377` | 30,013 | 747 | 40.2x | 6 | 1 | 7.4s |
| `vitest-dev/vitest#12029` | 8,045 | 382 | 21.1x | 3 | 0 | 6.2s |
| `vitest-dev/vitest#10691` | 9,423 | 750 | 12.6x | 7 | 3 | 2.8s |
| `pydantic/pydantic#14342` | 13,176 | 97 | 135.8x | 1 | 0 | 3.0s |
| `pydantic/pydantic#14339` | 14,346 | 77 | 186.3x | 0 | 0 | 2.9s |
| `kubernetes/kubernetes#144485` | 4,222 | 83 | 50.9x | 0 | 0 | 2.3s |
| `kubernetes/kubernetes#144461` | 5,165 | 80 | 64.6x | 0 | 0 | 2.5s |
| `kubernetes/kubernetes#144410` | 4,623 | 447 | 10.3x | 0 | 2 | 2.5s |
| **Total** | **142,149** | **3,845** | **37.0x** | **20** | **11** | **4.2s avg** |