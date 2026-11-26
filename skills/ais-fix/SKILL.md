---
name: ais-fix
description: Compile a sub-1,000-token failure-first PR triage brief (failing CI logs, unresolved review threads, blast radius) using `npx useais fix` before fixing CI or review feedback on a GitHub PR.
---

# PR Failure Triage (`ais fix`)

When asked to fix failing CI checks, debug broken GitHub Actions runs, or address pull request review comments:

1. Run `ais fix` (or `npx useais fix` if not installed globally). Pass a PR number or full URL if not checked out on the PR branch.
2. Do not fetch raw `gh pr view`, full `gh pr diff`, or raw Actions logs first—use the compiled brief as your starting context.
3. Fix every failing CI check first, then address every listed unresolved review thread.
4. Run the relevant local test or lint commands to verify before wrapping up.
