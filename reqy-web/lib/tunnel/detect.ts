/**
 * Free-tunnel CLI detection for receiving real external webhooks/callbacks
 * on the user's own machine — without Reqly hosting any relay.
 *
 * The callback URL field in the UI is GENERIC (no provider hardcoded). This
 * module only *detects* which free tunnel CLI is already installed on the
 * user's desktop so the UI can show the right copy-paste command. It never
 * phones home and never requires an account.
 *
 * Browser/WebView guard: `node:child_process` does not exist in a browser or
 * Tauri WebView. We load it lazily via a dynamic import that is ignored by the
 * bundler (`webpackIgnore`), so the production bundle never tries to resolve a
 * Node core module. If the import fails (browser) we simply return `null`.
 */

export type TunnelCli = "ngrok" | "cloudflared";

/** French helper text shown next to the generic callback URL field. */
export const TUNNEL_GUIDANCE: { recommended: string; alternative: string } = {
  recommended:
    "Recommandé (gratuit, sans compte) : installez cloudflared, puis lancez " +
    "`cloudflared tunnel --url http://localhost:<port>` (remplacez <port> par le " +
    "port local de Reqly). Utilisez l’URL HTTPS générée comme URL de callback.",
  alternative:
    "Alternative rapide : installez ngrok, puis lancez `ngrok http <port>`. " +
    "Copiez l’URL HTTPS « Forwarding » affichée dans le champ URL de callback ci-dessus.",
};

type ExecFile = (
  file: string,
  args: string[],
  cb: (error: Error | null, stdout?: string, stderr?: string) => void,
) => void;

/**
 * Best-effort detection of an installed free-tunnel CLI.
 *
 * @returns `"cloudflared"` if `cloudflared` is on PATH, `"ngrok"` if `ngrok`
 *          is on PATH (and cloudflared is not), otherwise `null`.
 *          Never throws — returns `null` in any browser/WebView environment.
 */
export async function detectTunnelCli(): Promise<TunnelCli | null> {
  let execFile: ExecFile | null = null;
  try {
    // `webpackIgnore` keeps this out of the browser bundle; at runtime in a
    // browser the import rejects and we fall through to `null`.
    const cp = await import(/* webpackIgnore: true */ "node:child_process");
    execFile = (cp as { execFile?: ExecFile }).execFile ?? null;
  } catch {
    return null;
  }

  if (typeof execFile !== "function") return null;

  const tool = process.platform === "win32" ? "where" : "which";

  const isOnPath = (bin: string): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      execFile!(tool, [bin], (error) => resolve(!error));
    });

  if (await isOnPath("cloudflared")) return "cloudflared";
  if (await isOnPath("ngrok")) return "ngrok";
  return null;
}
