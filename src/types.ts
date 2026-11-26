export interface PRTarget {
  owner: string;
  repo: string;
  number: number;
}

export interface PRMetadata extends PRTarget {
  title: string;
  branch: string;
  headSha: string;
}

export interface FailingCheck {
  jobName: string;
  command?: string;
  errorSummary: string;
  stackTrace: string[];
  referencedFiles: Array<{ file: string; symbol?: string }>;
}

export interface RawReviewThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  isCollapsed: boolean;
  path: string;
  line: number | null;
  originalLine: number | null;
  comments: {
    nodes: Array<{
      author: { login: string } | null;
      body: string;
      diffHunk: string;
    }>;
  };
}

export interface UnresolvedReview {
  file: string;
  line: number;
  author: string;
  comment: string;
  diffHunk: string;
  symbol?: string;
}

export interface BlastRadiusTuple {
  file: string;
  symbol: string;
  callers: string[];
  tests: string[];
}

export interface CompileOptions {
  budget: number;
  full: boolean;
}

export interface TriageBrief {
  pr: PRMetadata;
  tokens: number;
  budget: number;
  failedChecksCount: number;
  unresolvedThreadsCount: number;
  truncatedThreadsCount: number;
  failingChecks: FailingCheck[];
  unresolvedReviews: UnresolvedReview[];
  blastRadius: BlastRadiusTuple[];
}