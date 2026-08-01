"use client";

/**
 * Native desktop OAuth flow for GitHub / GitLab.
 *
 * Replaces the legacy web redirect (`/api/github-auth/start` etc.) inside the
 * Tauri app, where the static export has no Next.js API routes. Flow:
 *  1. start a temporary localhost server (`tauri-plugin-oauth`);
 *  2. fetch the public `client_id` from Rust (`get_oauth_client_id`);
 *  3. open the provider's authorize URL in the system browser;
 *  4. capture the redirect, verify `state`, extract the one-time `code`;
 *  5. exchange the code for an access token in Rust (`exchange_oauth_code`);
 *  6. store the token encrypted (`secure-storage`) and update the store.
 *
 * The `client_secret` never crosses the IPC boundary — it is read from the
 * process environment in Rust only.
 */

import { useCallback } from "react";
import { start, cancel, onUrl } from "@fabianlars/tauri-plugin-oauth";
import { invoke } from "@tauri-apps/api/core";
import { secureKeys } from "@/lib/secure-storage";
import { isTauriAvailable } from "@/lib/tauri";
import {
  useToolConnections,
  OAUTH_TOKEN_KEYS,
  type ToolId,
} from "@/hooks/use-tool-connections";

interface ProviderConfig {
  authorizeUrl: string;
  scope: string;
}

const PROVIDERS: Record<ToolId, ProviderConfig> = {
  github: {
    authorizeUrl: "https://github.com/login/oauth/authorize",
    scope: "repo read:user",
  },
  gitlab: {
    authorizeUrl: "https://gitlab.com/oauth/authorize",
    scope: "read_api read_user read_repository",
  },
};

/** Give the user time to complete the browser authorization. */
const CONNECT_TIMEOUT_MS = 5 * 60_000;

/**
 * Preferred localhost ports for the OAuth callback server. GitLab requires an
 * EXACT match between the registered redirect URI and the one used in the
 * authorize request (no "any loopback port" rule like GitHub), so every port
 * in this list must be registered as a redirect URI in the GitLab OAuth app.
 * The server picks the first free port in this list.
 */
const OAUTH_CALLBACK_PORTS = [8123, 8124, 8125, 8126];

/**
 * Branded page served by the localhost OAuth server once the provider
 * redirects back. Replaces the plugin's plain "Please return to the app.".
 */
const OAUTH_DONE_PAGE = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Reqly</title>
  </head>
  <body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(1200px 600px at 50% -10%, #123f33, #0b1513 60%, #070d0c);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#e8f3ef">
    <div style="max-width:420px;padding:48px 32px;text-align:center">
      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" style="display:block;margin:0 auto 20px">
        <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" fill="#35d9a3" />
      </svg>
      <h1 style="margin:0 0 8px;font-size:22px;font-weight:650;letter-spacing:-0.01em">Connexion réussie</h1>
      <p style="margin:0 0 24px;font-size:14px;line-height:1.5;color:#9fb8b0">Votre compte a été connecté à Reqly.<br />Vous pouvez retourner à l'application.</p>
      <span style="display:inline-flex;align-items:center;gap:8px;font-size:13px;color:#35d9a3">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
        Reqly
      </span>
    </div>
  </body>
</html>`;

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function useOAuthConnect(tool: ToolId) {
  const setStatus = useToolConnections((s) => s.setStatus);

  const connect = useCallback(async (): Promise<void> => {
    const cfg = PROVIDERS[tool];
    const port = await start({ ports: OAUTH_CALLBACK_PORTS, response: OAUTH_DONE_PAGE });

    const redirectUri = `http://127.0.0.1:${port}`;
    const state = crypto.randomUUID();

    let clientId: string;
    try {
      clientId = await invoke<string>("get_oauth_client_id", { provider: tool });
    } catch (err) {
      await cancel(port).catch(() => {});
      throw new Error(`Client OAuth non configuré (${tool}): ${describeError(err)}`, {
        cause: err,
      });
    }

    const authUrl = new URL(cfg.authorizeUrl);
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", cfg.scope);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("response_type", "code");

    // Register the redirect listener BEFORE opening the browser so the code is
    // captured no matter how fast the provider bounces back.
    const received = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Délai d'attente de l'autorisation dépassé")),
        CONNECT_TIMEOUT_MS,
      );
      onUrl((callbackUrl) => {
        let url: URL;
        try {
          url = new URL(callbackUrl);
        } catch {
          reject(new Error("Callback OAuth invalide"));
          return;
        }
        if (url.searchParams.get("state") !== state) {
          reject(new Error("État OAuth invalide"));
          return;
        }
        const code = url.searchParams.get("code");
        if (!code) {
          reject(
            new Error(
              url.searchParams.get("error_description") ??
                url.searchParams.get("error") ??
                "Autorisation refusée",
            ),
          );
          return;
        }
        clearTimeout(timeout);
        resolve(code);
      }).catch(reject);
    });

    try {
      await invoke("open_external", { url: authUrl.toString() });
    } catch (err) {
      await cancel(port).catch(() => {});
      throw new Error(`Impossible d'ouvrir le navigateur: ${describeError(err)}`, {
        cause: err,
      });
    }

    let code: string;
    try {
      code = await received;
    } finally {
      await cancel(port).catch(() => {});
    }

    try {
      const token = await invoke<string>("exchange_oauth_code", {
        provider: tool,
        code,
        redirectUri,
      });
      secureKeys.set(OAUTH_TOKEN_KEYS[tool], token);
      setStatus(tool, "connected");
    } catch (err) {
      throw new Error(`Échange du code OAuth échoué: ${describeError(err)}`, {
        cause: err,
      });
    }
  }, [tool, setStatus]);

  const disconnect = useCallback(async (): Promise<void> => {
    secureKeys.delete(OAUTH_TOKEN_KEYS[tool]);
    setStatus(tool, "disconnected");
  }, [tool, setStatus]);

  return { connect, disconnect, isAvailable: isTauriAvailable() };
}
