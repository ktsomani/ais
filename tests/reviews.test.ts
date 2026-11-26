import { describe, expect, it } from 'vitest';
import { filterUnresolvedThreads, renderReviewsWithinBudget } from '../src/reviews.js';
import type { RawReviewThread } from '../src/types.js';

function makeThread(overrides: Partial<RawReviewThread> = {}): RawReviewThread {
  return {
    id: 't1',
    isResolved: false,
    isOutdated: false,
    isCollapsed: false,
    path: 'src/auth/jwt.ts',
    line: 24,
    originalLine: 24,
    comments: {
      nodes: [
        {
          author: { login: 'alice' },
          body: 'Check `exp` against UTC seconds instead of milliseconds.',
          diffHunk: [
            '@@ -15,12 +15,12 @@ export function verifySession(token: string) {',
            '   const payload = decode(token);',
            '   if (!payload) return false;',
            '   const now = Date.now();',
            '-  return payload.exp > now;',
            '+  return payload.exp >= now;',
            '   // trailing line 1',
            '   // trailing line 2',
            '   // trailing line 3',
            '   // trailing line 4',
            '   // trailing line 5',
            '   // trailing line 6',
          ].join('\n'),
        },
      ],
    },
    ...overrides,
  };
}

describe('review thread filtering and budget overflow', () => {
  it('keeps only unresolved, non-outdated, non-collapsed threads and anchors 5-10 line hunks', () => {
    const raw: RawReviewThread[] = [
      makeThread({ id: 'open-1' }),
      makeThread({ id: 'resolved-1', isResolved: true }),
      makeThread({ id: 'outdated-1', isOutdated: true }),
      makeThread({ id: 'collapsed-1', isCollapsed: true }),
    ];

    const filtered = filterUnresolvedThreads(raw);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].file).toBe('src/auth/jwt.ts');
    expect(filtered[0].author).toBe('alice');

    const hunkLines = filtered[0].diffHunk.split('\n');
    expect(hunkLines.length).toBeGreaterThanOrEqual(5);
    expect(hunkLines.length).toBeLessThanOrEqual(10);
  });

  it('switches to compact 1-line summaries and appends truncation notice on overflow, unless --full is set', () => {
    const manyThreads = Array.from({ length: 12 }, (_, i) =>
      makeThread({
        id: `t-${i}`,
        path: `src/module_${i}.ts`,
        line: 10 + i,
      }),
    );

    const unresolved = filterUnresolvedThreads(manyThreads);

    // Tight budget triggers compact mode + truncation footer
    const truncated = renderReviewsWithinBudget(unresolved, 90, false);
    expect(truncated.usedCompactMode).toBe(true);
    expect(truncated.truncatedCount).toBeGreaterThan(0);
    expect(truncated.markdown).not.toContain('```diff');
    expect(truncated.markdown).toMatch(
      /\[TRUNCATED: \d+ more unresolved threads — rerun with --full\]/,
    );

    // --full disables truncation and preserves all diff hunks
    const fullResult = renderReviewsWithinBudget(unresolved, 90, true);
    expect(fullResult.usedCompactMode).toBe(false);
    expect(fullResult.truncatedCount).toBe(0);
    expect(fullResult.included).toHaveLength(12);
    expect(fullResult.markdown).toContain('```diff');
    expect(fullResult.markdown).not.toContain('[TRUNCATED:');
  });
});