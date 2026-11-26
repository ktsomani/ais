# ais

Fast, deterministic, failure-first PR triage CLI.

`ais fix` compiles failing CI logs, unresolved review threads, and scoped blast-radius context into a single **sub-1,000-token Markdown brief**—built to pipe straight into Claude Code, Codex, or any coding agent without burning context on raw `gh` output.

## Installation

Run directly with `npx`:

```bash
npx useais fix
```

Or install globally to use the `ais` command anywhere:

```bash
npm install -g useais
ais fix
```

## Usage

```bash
# Auto-detect the PR for your current git branch
ais fix

# Target a PR by number (in current repo) or full GitHub URL
ais fix 42
ais fix [https://github.com/owner/repo/pull/42](https://github.com/owner/repo/pull/42)
```

### Authentication

`ais` automatically uses your existing GitHub CLI session (`gh auth login`) or a `GITHUB_TOKEN` environment variable.

## Using with Coding Agents (Claude Code & Codex)

Pipe a compiled brief directly into your agent to unblock a PR without feeding it tens of thousands of tokens of noisy CI logs:

```bash
# Claude Code
ais fix 42 | claude -p "Fix the failing CI checks and address every unresolved review thread."

# OpenAI Codex CLI
codex "Fix the issues in this PR brief:\n$(ais fix 42)"
```

### Auto-trigger via `CLAUDE.md` or `AGENTS.md`

Add this to your repository's `CLAUDE.md` or `AGENTS.md` so agents default to `ais` before inspecting raw PR diffs or Actions logs:

```markdown
## PR Triage
When asked to fix CI failures or address review comments on a PR, run `npx useais fix` first instead of fetching raw `gh pr view` output or full Actions logs.
```

## Benchmarks (10 Live PRs)

Measured with `o200k_base` comparing raw PR context (`gh pr view` + `gh pr diff`) against `ais fix`:

| PR | Raw Tokens | `ais` Tokens | Ratio | CI Checks | Reviews | Time |
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

Every PR stayed strictly under the 1,000-token cap (max 844 tokens).

## License

MIT
