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
  /** Fichier en conflit de fusion (index non fusionné). */
  conflicted?: boolean;
}

export interface DiffLine {
  origin: string;
  content: string;
  oldLineno: number | null;
  newLineno: number | null;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
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

/** Credentials kept in memory for the current Git session only. */
export interface GitCredentials {
  username: string;
  password: string;
}

export interface GitStashEntry {
  index: number;
  message: string;
  oid: string;
}

export interface GitState {
  isInitialized: boolean;
  currentBranch: string;
  commits: GitCommit[];
  status: FileStatus[];
  branches: BranchInfo[];
  remotes: RemoteInfo[];
  stashes: GitStashEntry[];
  conflicts: string[];
  error: string | null;
  repoPath: string | null;
}
