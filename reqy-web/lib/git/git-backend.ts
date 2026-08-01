// ── Interface injectable pour abstraire les appels Tauri ──────────────

/**
 * GitBackend is the seam between GitService and Tauri IPC.
 * In production, TauriGitBackend calls `invoke()`.
 * In tests, a mock backend returns canned responses.
 */
export interface GitBackend {
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

/**
 * Production backend — delegates to @tauri-apps/api/core invoke.
 */
export class TauriGitBackend implements GitBackend {
  async invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  }
}
