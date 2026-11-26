import { describe, expect, it } from 'vitest';
import { compileBrief } from '../src/compiler.js';
import { countTokens } from '../src/tokens.js';
import type { BlastRadiusTuple, FailingCheck, PRMetadata, UnresolvedReview } from '../src/types.js';

const samplePR: PRMetadata = {
  owner: 'acme',
  repo: 'backend',
  number: 42,
  title: 'Fix JWT expiry check',
  branch: 'fix/jwt-exp',
  headSha: 'abc1234',
};

describe('compileBrief', () => {
  it('enforces strict <=1,000-token cap and deterministic Markdown schema', () => {
    const heavyChecks: FailingCheck[] = Array.from({ length: 8 }, (_, i) => ({
      jobName: `test-shard-${i} (npm test)`,
      command: 'npm test',
      errorSummary: `AssertionError: expected session #${i} to be rejected on expired JWT token`,
      stackTrace: Array.from(
        { length: 12 },
        (_, j) => `at checkFrame${j} (src/auth/shard_${i}.ts:${10 + j}:5)`,
      ),
      referencedFiles: [{ file: `src/auth/shard_${i}.ts`, symbol: `checkFrame0` }],
    }));

    const heavyReviews: UnresolvedReview[] = Array.from({ length: 15 }, (_, i) => ({
      file: `src/auth/shard_${i}.ts`,
      line: 20 + i,
      author: 'bob',
      comment: `Avoid mutable global clock state in shard ${i}; inject clock dependency instead.`,
      diffHunk: [
        '@@ -18,6 +18,6 @@',
        ' const now = Date.now();',
        '-if (exp < now) return false;',
        '+if (exp <= now) return false;',
        ' return true;',
        '}',
      ].join('\n'),
      symbol: `checkFrame0`,
    }));

    const blastRadius: BlastRadiusTuple[] = Array.from({ length: 10 }, (_, i) => ({
      file: `src/auth/shard_${i}.ts`,
      symbol: `checkFrame0`,
      callers: [`src/routes/login_${i}.ts`],
      tests: [`tests/auth/shard_${i}.test.ts`],
    }));

    const run1 = compileBrief(samplePR, heavyChecks, heavyReviews, blastRadius, {
      budget: 1000,
      full: false,
    });
    const run2 = compileBrief(samplePR, heavyChecks, heavyReviews, blastRadius, {
      budget: 1000,
      full: false,
    });

    // Determinism
    expect(run1.markdown).toBe(run2.markdown);

    // Exact <= 1,000 token enforcement via o200k_base
    const exactCount = countTokens(run1.markdown);
    expect(exactCount).toBeLessThanOrEqual(1000);
    expect(run1.brief.tokens).toBe(exactCount);

    // Exact Markdown output schema
    expect(run1.markdown).toContain('# PR #42: Fix JWT expiry check (fix/jwt-exp)');
    expect(run1.markdown).toContain(
      `Tokens: ${exactCount}/1000 | Failed Checks: 8 | Unresolved Threads: 15`,
    );
    expect(run1.markdown).toContain('## 1. Failing CI');
    expect(run1.markdown).toContain('## 2. Unresolved Reviews');
    expect(run1.markdown).toContain('## 3. Blast Radius');
  });
});