// ── Types partagés pour le module Git ──────────────────────────────────

export interface GitCommit {
  oid: string;
  message: string;
  author: { name: string; email: string; timestamp: number };
  committer: { name: string; email: string; timestamp: number };
  timestamp: number;
}

export interface FileStatus {
  filepath: string;
  head: 0 | 1;
  workdir: 0 | 1 | 2;
  staged: 0 | 1 | 2 | 3;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: Array<{
    origin: string;
    content: string;
    oldLineno: number | null;
    newLineno: number | null;
  }>;
}

export interface DiffFile {
  filepath: string;
  hunks: DiffHunk[];
}

export interface BranchInfo {
  name: string;
  isCurrent: boolean;
  oid: string;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface RemoteInfo {
  name: string;
  url: string;
}

export interface GitState {
  isInitialized: boolean;
  currentBranch: string;
  commits: GitCommit[];
  status: FileStatus[];
  branches: BranchInfo[];
  remotes: RemoteInfo[];
  error: string | null;
  repoPath: string | null;
}
