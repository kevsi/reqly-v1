"use client";

import { useState } from "react";
import {
  buildCallbackPayload,
  sendCallbackPayload,
  type MomoProvider,
  type MomoScenario,
} from "@/modules/mobile-money/templates";

const PROVIDERS: { value: MomoProvider; label: string }[] = [
  { value: "mtn-momo-collections", label: "MTN MoMo — Collections" },
  { value: "mtn-momo-disbursement", label: "MTN MoMo — Disbursement" },
  { value: "fedapay", label: "FedaPay" },
  { value: "kkiapay", label: "Kkiapay" },
];

const SCENARIOS: { value: MomoScenario; label: string }[] = [
  { value: "success", label: "Succès" },
  { value: "failure", label: "Échec" },
  { value: "timeout", label: "Timeout" },
];

export function CallbackSimulator() {
  const [provider, setProvider] = useState<MomoProvider>("mtn-momo-collections");
  const [scenario, setScenario] = useState<MomoScenario>("success");
  const [url, setUrl] = useState("");
  const [sending, setSending] = useState(false);
  const [sentPayload, setSentPayload] = useState<unknown>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    setError(null);
    if (!url.trim()) {
      setError("Veuillez saisir une URL de callback.");
      return;
    }
    const payload = buildCallbackPayload(provider, scenario);
    setSentPayload(payload);
    setSending(true);
    setStatus(null);
    try {
      const res = await sendCallbackPayload(url.trim(), payload);
      setStatus(res.status);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'envoi.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-background p-4">
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-foreground" htmlFor="momo-provider">
          Provider
        </label>
        <select
          id="momo-provider"
          data-testid="momo-provider"
          className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          value={provider}
          onChange={(e) => setProvider(e.target.value as MomoProvider)}
        >
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-foreground">Scénario</span>
        <div className="flex gap-2">
          {SCENARIOS.map((s) => (
            <button
              key={s.value}
              type="button"
              data-testid={`scenario-${s.value}`}
              onClick={() => setScenario(s.value)}
              className={
                "rounded-md border px-3 py-2 text-sm font-medium transition-colors " +
                (scenario === s.value
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-accent")
              }
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-foreground" htmlFor="momo-url">
          URL de callback
        </label>
        <input
          id="momo-url"
          data-testid="momo-url"
          type="url"
          inputMode="url"
          placeholder="https://votre-tunnel.example.com/callback"
          className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>

      <button
        type="button"
        data-testid="momo-send"
        onClick={handleSend}
        disabled={sending}
        className="self-start rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
      >
        {sending ? "Envoi…" : "Envoyer"}
      </button>

      {error && (
        <p className="text-sm text-destructive" data-testid="momo-error">
          {error}
        </p>
      )}

      {sentPayload !== null && (
        <details open className="rounded-md border border-border bg-muted/30 p-3">
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            Payload envoyé
          </summary>
          <pre className="mt-2 overflow-auto text-xs text-muted-foreground">
            {JSON.stringify(sentPayload, null, 2)}
          </pre>
        </details>
      )}

      {status !== null && (
        <p className="text-sm text-foreground" data-testid="momo-status">
          Statut HTTP : <span className="font-mono font-semibold">{status}</span>
        </p>
      )}
    </div>
  );
}
