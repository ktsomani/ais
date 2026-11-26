import { describe, expect, it } from 'vitest';
import { parseFailingJobLog } from '../src/ci-parser.js';

describe('parseFailingJobLog', () => {
  it('strips noisy TypeScript/Vitest GitHub Actions logs and retains user-land stack frames', () => {
    const tsLog = [
      '2026-11-26T06:00:01.100Z ##[group]Set up job',
      '2026-11-26T06:00:01.101Z Current runner version: 2.319.1',
      '2026-11-26T06:00:01.102Z ##[endgroup]',
      '2026-11-26T06:00:02.000Z ##[group]Run actions/checkout@v4',
      '2026-11-26T06:00:02.500Z Fetching the repository',
      '2026-11-26T06:00:03.000Z ##[endgroup]',
      '2026-11-26T06:00:04.000Z ##[group]Run npm test',
      '2026-11-26T06:00:05.100Z \x1b[31mFAIL\x1b[39m src/auth/jwt.test.ts > verifySession > rejects expired tokens',
      '2026-11-26T06:00:05.101Z \x1b[31mAssertionError: expected true to be false\x1b[39m',
      '2026-11-26T06:00:05.102Z  ❯ src/auth/jwt.test.ts:42:28',
      '2026-11-26T06:00:05.103Z     at verifySession (src/auth/jwt.ts:19:12)',
      '2026-11-26T06:00:05.104Z     at Object.<anonymous> (node_modules/vitest/dist/chunk-runner.js:120:15)',
      '2026-11-26T06:00:05.105Z     at processTicksAndRejections (node:internal/process/task_queues:95:5)',
      '2026-11-26T06:00:05.200Z ##[error]Process completed with exit code 1.',
      '2026-11-26T06:00:05.300Z ##[endgroup]',
      '2026-11-26T06:00:06.000Z ##[group]Post Run actions/checkout@v4',
      '2026-11-26T06:00:06.100Z Cleaning up orphan processes',
      '2026-11-26T06:00:06.200Z ##[endgroup]',
    ].join('\n');

    const result = parseFailingJobLog('unit-tests', tsLog);

    expect(result.jobName).toBe('unit-tests (npm test)');
    expect(result.command).toBe('npm test');
    expect(result.errorSummary).toContain('FAIL src/auth/jwt.test.ts');
    expect(result.stackTrace.join('\n')).not.toContain('node_modules');
    expect(result.stackTrace.join('\n')).not.toContain('node:internal');
    expect(result.stackTrace.join('\n')).not.toContain('\x1b[');
    expect(result.stackTrace.join('\n')).not.toContain('2026-11-26T');
    expect(result.stackTrace.join('\n')).toContain('src/auth/jwt.ts:19:12');
    expect(result.referencedFiles).toContainEqual({
      file: 'src/auth/jwt.ts',
      symbol: 'verifySession',
    });
  });

  it('strips noisy Python/pytest logs and drops site-packages frames', () => {
    const pyLog = [
      '2026-11-26T06:10:00.000Z ##[group]Run pytest',
      '2026-11-26T06:10:01.000Z FAILED tests/test_billing.py::test_charge_declined - ValueError: negative amount',
      '2026-11-26T06:10:01.010Z   File "/opt/hostedtoolcache/Python/3.12.0/lib/python3.12/site-packages/_pytest/runner.py", line 341, in from_call',
      '2026-11-26T06:10:01.020Z   File "/home/runner/work/acme/api/app/billing.py", line 88, in charge_card',
      '2026-11-26T06:10:01.030Z E       ValueError: negative amount',
      '2026-11-26T06:10:01.100Z ##[endgroup]',
    ].join('\n');

    const result = parseFailingJobLog('pytest', pyLog);

    expect(result.errorSummary).toContain('FAILED tests/test_billing.py::test_charge_declined');
    expect(result.stackTrace.join('\n')).not.toContain('site-packages');
    expect(result.stackTrace.join('\n')).toContain('app/billing.py');
    expect(result.referencedFiles).toContainEqual({
      file: 'app/billing.py',
      symbol: 'charge_card',
    });
  });

  it('strips noisy Go test logs and drops stdlib/runtime frames', () => {
    const goLog = [
      '2026-11-26T06:20:00.000Z ##[group]Run go test ./...',
      '2026-11-26T06:20:01.000Z --- FAIL: TestEvictLRU (0.01s)',
      '2026-11-26T06:20:01.001Z     store_test.go:45: expected 0 items, got 2',
      '2026-11-26T06:20:01.002Z panic: runtime error: index out of range [3] with length 2',
      '2026-11-26T06:20:01.003Z github.com/acme/cache.(*Store).Evict(0xc00012a000)',
      '2026-11-26T06:20:01.004Z     /home/runner/work/acme/cache/pkg/cache/store.go:54 +0x1b',
      '2026-11-26T06:20:01.005Z     /usr/local/go/src/testing/testing.go:1689 +0xf4',
      '2026-11-26T06:20:01.006Z     /usr/local/go/src/runtime/proc.go:271 +0x20',
      '2026-11-26T06:20:01.100Z ##[endgroup]',
    ].join('\n');

    const result = parseFailingJobLog('go-test', goLog);

    expect(result.errorSummary).toContain('--- FAIL: TestEvictLRU');
    expect(result.stackTrace.join('\n')).not.toContain('/usr/local/go/src/');
    expect(result.stackTrace.join('\n')).toContain('pkg/cache/store.go:54');
    expect(result.referencedFiles).toContainEqual({
      file: 'pkg/cache/store.go',
      symbol: 'Evict',
    });
  });
});