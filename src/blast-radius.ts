import { execFileSync } from 'child_process';
import fs from 'node:fs';
import * as path from 'node:path';
import type { BlastRadiusTuple, FailingCheck, UnresolvedReview } from './types.js';

const TEST_FILE_PATTERN =
  /(?:^|\/)(?:__tests__\/|tests?\/|test_[^/]+\.py$|[^/]+\.(?:test|spec)\.[jt]sx?$|[^/]+_test\.go$)/i;

const NON_CODE_FILE_PATTERN =
  /\.(?:md|txt|json|lock|ya?ml|toml|ini|svg|png|jpe?g|gif|ico|map|snap)$/i;

const GENERIC_STEMS = new Set(['index', 'main', 'mod', 'lib', '__init__', 'app', 'types']);

function normalizePath(filePath: string): string {
  return filePath.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function stemOf(filePath: string): string {
  const base = path.posix.basename(normalizePath(filePath));
  return base.replace(/\.[^.]+$/, '');
}

function isTestFile(filePath: string): boolean {
  return TEST_FILE_PATTERN.test(filePath);
}

function gitGrepFiles(pattern: string, cwd: string): string[] {
  const clean = pattern.trim();
  if (!clean || clean.length < 2) return [];

  try {
    const out = execFileSync('git', ['grep', '-l', '-F', '-w', '--', clean], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 3000,
    });
    return out
      .split(/\r?\n/)
      .map((s) => normalizePath(s))
      .filter((s) => Boolean(s) && !NON_CODE_FILE_PATTERN.test(s));
  } catch {
    return [];
  }
}

function findMatchingTests(file: string, cwd: string): string[] {
  const normalized = normalizePath(file);
  if (isTestFile(normalized)) return [];

  const dir = path.posix.dirname(normalized);
  const ext = path.posix.extname(normalized);
  const stem = stemOf(normalized);
  if (!stem) return [];

  // Mirror subdirectory under tests/ (e.g. src/auth/jwt.ts -> tests/auth/jwt.test.ts)
  const subDir = dir.replace(/^(?:src|lib|app|pkg)(?:\/|$)/, '');

  const candidates = new Set<string>([
    path.posix.join(dir, `${stem}.test${ext}`),
    path.posix.join(dir, `${stem}.spec${ext}`),
    path.posix.join(dir, '__tests__', `${stem}.test${ext}`),
    path.posix.join('tests', `${stem}.test${ext}`),
    path.posix.join('test', `${stem}.test${ext}`),
    ...(subDir
      ? [
          path.posix.join('tests', subDir, `${stem}.test${ext}`),
          path.posix.join('test', subDir, `${stem}.test${ext}`),
          path.posix.join('tests', subDir, `test_${stem}.py`),
        ]
      : []),
    path.posix.join(dir, `test_${stem}.py`),
    path.posix.join('tests', `test_${stem}.py`),
    path.posix.join(dir, `${stem}_test.go`),
  ]);

  const found: string[] = [];
  for (const candidate of candidates) {
    const cleanCandidate = normalizePath(candidate);
    if (cleanCandidate === normalized) continue;
    const abs = path.resolve(cwd, cleanCandidate);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      found.push(cleanCandidate);
    }
  }

  return found;
}

export function computeBlastRadius(
  failingChecks: FailingCheck[],
  unresolvedReviews: UnresolvedReview[],
  cwd = process.cwd(),
): BlastRadiusTuple[] {
  // Key by normalized file -> set of explicit symbols (falls back to stem only if none found)
  const fileSymbols = new Map<string, Set<string>>();

  const record = (rawFile: string, rawSymbol?: string) => {
    const file = normalizePath(rawFile);
    if (!file) return;
    if (!fileSymbols.has(file)) {
      fileSymbols.set(file, new Set<string>());
    }
    const sym = rawSymbol?.trim();
    if (sym) {
      fileSymbols.get(file)!.add(sym);
    }
  };

  for (const check of failingChecks) {
    for (const ref of check.referencedFiles) {
      record(ref.file, ref.symbol);
    }
  }

  for (const review of unresolvedReviews) {
    record(review.file, review.symbol);
  }

  const tuples: BlastRadiusTuple[] = [];

  for (const [file, symbolsSet] of fileSymbols.entries()) {
    const stem = stemOf(file);
    const symbols = symbolsSet.size > 0 ? Array.from(symbolsSet) : [stem];
    const baseTests = findMatchingTests(file, cwd);

    for (const symbol of symbols) {
      const matchingTests = new Set<string>(baseTests);
      const callers = new Set<string>();

      const searchStem = stem && stem !== symbol && !GENERIC_STEMS.has(stem.toLowerCase());
      const grepHits = new Set<string>([
        ...(GENERIC_STEMS.has(symbol.toLowerCase()) ? [] : gitGrepFiles(symbol, cwd)),
        ...(searchStem ? gitGrepFiles(stem, cwd) : []),
      ]);

      for (const hit of grepHits) {
        if (hit === file) continue;
        if (isTestFile(hit)) {
          matchingTests.add(hit);
        } else {
          callers.add(hit);
        }
      }

      tuples.push({
        file,
        symbol,
        callers: Array.from(callers).sort().slice(0, 3),
        tests: Array.from(matchingTests).sort().slice(0, 3),
      });
    }
  }

  return tuples;
}