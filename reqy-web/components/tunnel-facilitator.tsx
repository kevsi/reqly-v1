"use client";

import { useState } from "react";
import { detectTunnelCli, TUNNEL_GUIDANCE } from "@/lib/tunnel/detect";

/**
 * GENERIC callback-URL facilitator — no tunnel provider is hard-coded.
 *
 * Reqly never hosts a relay. The user runs their own free tunnel (Cloudflare
 * Tunnel or ngrok) and pastes the resulting URL here. This component only:
 *   - shows copy-paste guidance for the two free options,
 *   - lets the user verify the URL is reachable (GET),
 *   - offers a convenience link to webhook.site (no API key, no hosting).
 */
export function TunnelFacilitator() {
  const [url, setUrl] = useState("");
  const [detected, setDetected] = useState<TunnelCliLabel | null>(null);
  const [checking, setChecking] = useState(false);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDetect() {
    setError(null);
    try {
      const cli = await detectTunnelCli();
      setDetected(cli);
    } catch {
      setDetected(null);
    }
  }

  async function handleCheck() {
    setError(null);
    setReachable(null);
    if (!url.trim()) {
      setError("Veuillez saisir une URL de callback.");
      return;
    }
    setChecking(true);
    try {
      const res = await fetch(url.trim(), { method: "GET" });
      setReachable(res.ok || res.status < 500);
    } catch {
      setReachable(false);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-background p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">
          Recevoir un vrai callback (tunnel gratuit)
        </h2>
        <p className="text-sm text-muted-foreground">
          Reqly n’héberge aucun relais. Lancez votre propre tunnel gratuit et collez l’URL générée
          ci-dessous pour recevoir un callback externe sur votre machine.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-foreground" htmlFor="callback-url">
          URL de callback
        </label>
        <input
          id="callback-url"
          data-testid="callback-url"
          type="url"
          inputMode="url"
          placeholder="https://<votre-tunnel>.trycloudflare.com/callback"
          className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          data-testid="tunnel-detect"
          onClick={handleDetect}
          className="self-start rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
        >
          Détecter un tunnel installé
        </button>
        <button
          type="button"
          data-testid="tunnel-check"
          onClick={handleCheck}
          disabled={checking}
          className="self-start rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {checking ? "Vérification…" : "Vérifier"}
        </button>
        <button
          type="button"
          data-testid="tunnel-webhook-site"
          onClick={() => window.open("https://webhook.site", "_blank", "noopener,noreferrer")}
          className="self-start rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
        >
          Ouvrir webhook.site
        </button>
      </div>

      {detected && (
        <p className="text-sm text-foreground" data-testid="tunnel-detected">
          Tunnel détecté : <span className="font-mono font-semibold">{detected}</span>
        </p>
      )}

      {reachable === true && (
        <p className="text-sm text-success" data-testid="tunnel-reachable">
          ✓ URL accessible
        </p>
      )}
      {reachable === false && (
        <p className="text-sm text-destructive" data-testid="tunnel-unreachable">
          ✗ URL inaccessible (vérifiez le tunnel et le chemin)
        </p>
      )}

      {error && (
        <p className="text-sm text-destructive" data-testid="tunnel-error">
          {error}
        </p>
      )}

      <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Recommandé :</p>
        <p className="mt-1">{TUNNEL_GUIDANCE.recommended}</p>
        <p className="mt-2 font-medium text-foreground">Alternative :</p>
        <p className="mt-1">{TUNNEL_GUIDANCE.alternative}</p>
      </div>
    </div>
  );
}

type TunnelCliLabel = "ngrok" | "cloudflared";
