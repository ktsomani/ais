import type { FailingCheck } from './types.js';

// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s?/;

const SETUP_TEARDOWN_GROUP =
  /^(?:Set up job|Complete job|Post\s|Run actions\/|Setup\s|Cache\s|Fetching the repository|Checking out the ref|Getting Git version|Initializing the repository|Cleaning up|Evaluate and set job outputs)/i;

const RUNNER_NOISE_LINE =
  /^(?:##\[debug\]|##\[notice\]|Current runner version:|Operating System|Runner Image|GITHUB_TOKEN Permissions|Secret source:|Prepare workflow directory|Prepare all required actions|Getting action download info|Cleaning up orphan processes)/i;

const THIRD_PARTY_FRAME =
  /(?:node_modules|node:internal\/|internal\/modules\/|site-packages|dist-packages|\/usr\/lib\/python|\/usr\/local\/lib\/python|\/opt\/hostedtoolcache\/|\/usr\/local\/go\/src\/|\/go\/pkg\/mod\/|\bruntime\/proc\.go|\btesting\/testing\.go|\b_pytest\/|\bpluggy\/|\bvitest\/dist\/|\bjest-circus\/)/i;

const ERROR_PATTERNS = [
  /^##\[error\]\s*(.+)/i,
  /^(?:FAIL|FAILED)\s+.+/,
  /^---\s*FAIL:\s*.+/,
  /^(?:AssertionError|TypeError|ReferenceError|SyntaxError|RangeError|ValueError|KeyError|AttributeError|RuntimeError|ImportError|ModuleNotFoundError|Error):.*/,
  /^error TS\d+:.+/,
  /^E\s{2,}.+/,
  /^[×✕]\s+.+/,
  /^(?:Expected|Received|Actual)\s*[:(].*/,
  /^panic:\s*.+/,
  /^\s*Error(?:\s+Trace)?:\s+.+/,
  /^\s*[\w./-]+_test\.go:\d+:\s+.+/,
];

const USER_FRAME_PATTERNS = [
  // JS / TS: at fn (src/file.ts:12:5) or src/file.ts:12:5
  /^\s*at\s+(?:(?<sym>[\w$.<>[\] ]+)\s+)?\(?(?<file>(?:[A-Za-z]:)?\/?(?:[\w@.-]+\/)*[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs)):\d+(?::\d+)?\)?/,
  /^\s*[❯>]\s*(?<file>(?:[A-Za-z]:)?\/?(?:[\w@.-]+\/)*[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs)):\d+:\d+/,
  // Python: File "app/service.py", line 42, in process
  /^\s*File\s+"(?<file>[^"]+\.py)",\s+line\s+\d+(?:,\s+in\s+(?<sym>[\w.<>]+))?/,
  // Go: /abs/path/pkg/foo/bar.go:42 +0x1a or pkg/foo/bar_test.go:18: msg
  /^\s*(?<file>(?:[A-Za-z]:)?\/?(?:[\w.-]+\/)*[\w.-]+\.go):\d+/,
];

export function stripAnsiAndTimestamps(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(ANSI_REGEX, '')
    .split('\n')
    .map((line) => line.replace(TIMESTAMP_REGEX, ''))
    .join('\n');
}

function normalizeRepoPath(filePath: string): string {
  return filePath
    .replace(/\\/g, '/')
    .replace(/^\/home\/runner\/work\/[^/]+\/[^/]+\//, '')
    .replace(/^\/github\/workspace\//, '')
    .replace(/^[A-Za-z]:\/a\/[^/]+\/[^/]+\//, '')
    .replace(/^\.\//, '');
}

export function parseFailingJobLog(jobName: string, rawLog: string): FailingCheck {
  const cleaned = stripAnsiAndTimestamps(rawLog);
  const lines = cleaned.split('\n');

  let inIgnoredGroup = false;
  let lastCommand: string | undefined;
  let activeStepName: string | undefined;

  const errorLines: string[] = [];
  const stackLines: string[] = [];
  const referencedFiles = new Map<string, string | undefined>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('##[group]')) {
      const groupTitle = trimmed.slice('##[group]'.length).trim();
      if (SETUP_TEARDOWN_GROUP.test(groupTitle)) {
        inIgnoredGroup = true;
        continue;
      }
      inIgnoredGroup = false;
      if (/^Run\s+/i.test(groupTitle)) {
        lastCommand = groupTitle.replace(/^Run\s+/i, '').trim();
        activeStepName = lastCommand;
      }
      continue;
    }

    if (trimmed.startsWith('##[endgroup]')) {
      inIgnoredGroup = false;
      continue;
    }

    if (inIgnoredGroup || RUNNER_NOISE_LINE.test(trimmed)) {
      continue;
    }

    if (trimmed.startsWith('##[command]')) {
      const cmd = trimmed.slice('##[command]'.length).trim();
      if (!SETUP_TEARDOWN_GROUP.test(cmd)) {
        lastCommand = cmd;
      }
      continue;
    }

    // Drop third-party / stdlib stack frames
    if (THIRD_PARTY_FRAME.test(trimmed)) {
      continue;
    }

    // Check for user-land stack frames
    let matchedFrame = false;
    for (const pattern of USER_FRAME_PATTERNS) {
      const m = line.match(pattern);
      if (m?.groups?.file) {
        const normalizedFile = normalizeRepoPath(m.groups.file);
        const sym = m.groups.sym?.trim();
        if (!referencedFiles.has(normalizedFile) || (!referencedFiles.get(normalizedFile) && sym)) {
          referencedFiles.set(normalizedFile, sym);
        }
        // Preserve Go's preceding function line if present (e.g. github.com/org/repo/pkg.Fn(...))
        if (normalizedFile.endsWith('.go') && i > 0) {
          const prev = lines[i - 1].trim();
          const goFn = prev.match(/([A-Za-z0-9_.*()]+)\([^)]*\)$/);
          if (goFn && !THIRD_PARTY_FRAME.test(prev)) {
            const cleanedSym = goFn[1].replace(/^.*\./, '');
            if (!referencedFiles.get(normalizedFile)) {
              referencedFiles.set(normalizedFile, cleanedSym);
            }
          }
        }
        stackLines.push(trimmed.replace(m.groups.file, normalizedFile));
        matchedFrame = true;
        break;
      }
    }

    // Check for primary error / assertion lines
    if (ERROR_PATTERNS.some((p) => p.test(trimmed))) {
      const cleanErr = trimmed.replace(/^##\[error\]\s*/i, '');
      // Ignore generic exit-code wrapper if we already have a real error
      if (/^Process completed with exit code \d+\.?$/i.test(cleanErr)) {
        if (errorLines.length === 0) errorLines.push(cleanErr);
      } else {
        errorLines.push(cleanErr);
        if (!matchedFrame) {
          stackLines.push(cleanErr);
        }
      }
    }
  }

  // Deduplicate while preserving deterministic order
  const uniqueTrace = Array.from(new Set(stackLines)).slice(0, 14);
  const primaryError =
    errorLines.find((e) => !/^Process completed with exit code/i.test(e)) ??
    errorLines[0] ??
    'Job failed (see CI logs)';

  const displayJob = activeStepName ? `${jobName} (${activeStepName})` : jobName;

  if (lastCommand && uniqueTrace.length > 0 && !uniqueTrace[0].startsWith('$ ')) {
    uniqueTrace.unshift(`$ ${lastCommand}`);
  }

  return {
    jobName: displayJob,
    command: lastCommand,
    errorSummary: primaryError.slice(0, 180),
    stackTrace: uniqueTrace,
    referencedFiles: Array.from(referencedFiles.entries()).map(([file, symbol]) => ({
      file,
      symbol,
    })),
  };
}