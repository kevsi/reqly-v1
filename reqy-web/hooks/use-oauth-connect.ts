"use client";

/**
 * Native desktop OAuth flow for GitHub / GitLab (RFC 8628 device flow).
 *
 * Replaces the legacy localhost-redirect flow (which required a
 * `client_secret` in the binary) with the OAuth Device Authorization Grant:
 *  1. `start_device_flow` asks the provider for a `device_code` and a
 *     human-friendly `user_code` + verification URI (only the public
 *     `client_id` is sent — no secret).
 *  2. The UI shows the user the code and opens the verification URI in the
 *     system browser.
 *  3. `poll_device_token` is called repeatedly (honoring the provider's
 *     `interval`) until the user authorizes, then returns the access token.
 *  4. The token is stored encrypted (`secure-storage`) and the store updated.
 *
 * There is no `client_secret` anywhere: device flow uses the public
 * `client_id` only, which is safe to embed in a desktop binary.
 */

import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { secureKeys } from "@/lib/secure-storage";
import { isTauriAvailable } from "@/lib/tauri";
import {
  useToolConnections,
  OAUTH_TOKEN_KEYS,
  type ToolId,
} from "@/hooks/use-tool-connections";

/** Response of the provider's device-authorization endpoint (RFC 8628 step 1). */
export interface DeviceFlowInit {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

/** Give the user time to complete the browser authorization. */
const CONNECT_TIMEOUT_MS = 5 * 60_000;

/** Poll the provider until a token arrives or the flow errors/times out. */
async function pollForToken(
  tool: ToolId,
  init: DeviceFlowInit,
  signal: AbortSignal,
): Promise<string> {
  const started = Date.now();
  const interval = Math.max(init.interval, 1);
  for (;;) {
    if (signal.aborted) {
      throw new Error("Connexion annulée");
    }
    if (Date.now() - started > CONNECT_TIMEOUT_MS) {
      throw new Error("Délai d'attente de l'autorisation dépassé");
    }
    const token = await invoke<string | null>("poll_device_token_cmd", {
      provider: tool,
      deviceCode: init.device_code,
      interval,
    });
    if (token) return token;
    await new Promise((r) => setTimeout(r, interval * 1000));
  }
}

export function useOAuthConnect(tool: ToolId) {
  const setStatus = useToolConnections((s) => s.setStatus);

  /**
   * Start the device flow. Returns the device code + user code so callers can
   * display them while polling; the caller is responsible for showing the code
   * and (typically) opening `verification_uri` in the browser.
   */
  const start = useCallback(async (): Promise<DeviceFlowInit> => {
    const init = await invoke<DeviceFlowInit>("start_device_flow_cmd", {
      provider: tool,
    });
    return init;
  }, [tool]);

  /**
   * Wait for the user to authorize and return the access token. Call after
   * `start()` (and after the UI has shown the user_code + opened the browser).
   */
  const waitForToken = useCallback(
    async (init: DeviceFlowInit, signal?: AbortSignal): Promise<string> => {
      const token = await pollForToken(tool, init, signal ?? new AbortController().signal);
      secureKeys.set(OAUTH_TOKEN_KEYS[tool], token);
      setStatus(tool, "connected");
      return token;
    },
    [tool, setStatus],
  );

  /** Convenience: start + open browser + wait in one call (returns token). */
  const connect = useCallback(async (): Promise<DeviceFlowInit & { token: string }> => {
    const init = await start();
    await invoke("open_external", { url: init.verification_uri_complete ?? init.verification_uri });
    const token = await waitForToken(init);
    return { ...init, token };
  }, [start, waitForToken]);

  const disconnect = useCallback(async (): Promise<void> => {
    secureKeys.delete(OAUTH_TOKEN_KEYS[tool]);
    setStatus(tool, "disconnected");
  }, [tool, setStatus]);

  return { start, waitForToken, connect, disconnect, isAvailable: isTauriAvailable() };
}
