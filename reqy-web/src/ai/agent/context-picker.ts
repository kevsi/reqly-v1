import type { ContextAttachment } from "./types";
import { requestStore } from "@/hooks/use-request-store";
import type { RequestItem } from "@/lib/types";

export function searchContextTargets(query: string): ContextAttachment[] {
  const store = requestStore.getState();
  const q = query.toLowerCase();
  const out: ContextAttachment[] = [];

  for (const c of store.collections) {
    if (c.name.toLowerCase().includes(q)) {
      out.push({ id: `collection:${c.id}`, type: "collection", refId: c.id, label: c.name, detail: "Collection" });
    }
  }
  for (const c of store.collections) {
    for (const r of c.requests ?? []) {
      if (r.name.toLowerCase().includes(q)) {
        out.push({ id: `request:${r.id}`, type: "request", refId: r.id, label: r.name, detail: `${r.method} ${r.url ?? ""}` });
      }
    }
  }
  for (const e of store.environments) {
    if (e.name.toLowerCase().includes(q)) {
      out.push({ id: `environment:${e.id}`, type: "environment", refId: e.id, label: e.name, detail: "Environnement" });
    }
  }
  return out.slice(0, 12);
}

function maskEnvValue(v: string): string {
  return /^[A-Z0-9_.-]{6,}$/i.test(v) ? "••••••" : v;
}

/** Masque les valeurs de champs dont le nom évoque un secret (clé, token…). */
const SENSITIVE_FIELD_RE = /(secret|key|token|password|auth|cookie)/i;

function maskFieldValue(key: string, value: string): string {
  return SENSITIVE_FIELD_RE.test(key) ? "••••••" : value;
}

/**
 * Copie une requête en masquant tout ce qui pourrait exposer un secret au LLM :
 * `authToken`, headers sensibles (Authorization, X-API-Key, Cookie…) et
 * queryParams sensibles. Les autres champs sont conservés tels quels.
 */
function sanitizeRequestForSnippet(r: RequestItem): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...r };
  if (r.authToken) copy.authToken = "••••••";
  if (r.headers && typeof r.headers === "object") {
    copy.headers = Object.fromEntries(
      Object.entries(r.headers).map(([k, v]) => [k, maskFieldValue(k, v)]),
    );
  }
  if (Array.isArray(r.queryParams)) {
    copy.queryParams = r.queryParams.map((p) => ({
      ...p,
      value: maskFieldValue(p.key, p.value),
    }));
  }
  return copy;
}

export function resolveAttachmentSnippet(a: ContextAttachment): string {
  const store = requestStore.getState();
  switch (a.type) {
    case "collection": {
      const c = store.collections.find((x) => x.id === a.refId);
      if (!c) return "";
      const reqs = (c.requests ?? []).map((r) => `- ${r.method} ${r.name} ${r.url ?? ""}`).join("\n");
      return `# Collection: ${c.name}\n${reqs}`;
    }
    case "request": {
      for (const c of store.collections) {
        const r = (c.requests ?? []).find((x) => x.id === a.refId);
        if (r) return JSON.stringify(sanitizeRequestForSnippet(r), null, 2);
      }
      return "";
    }
    case "environment": {
      const e = store.environments.find((x) => x.id === a.refId);
      if (!e) return "";
      const vars = e.variables
        .map((v) => `${v.enabled === false ? "(disabled) " : ""}${v.key}=${maskEnvValue(String(v.value))}`)
        .join("\n");
      return `# Environment: ${e.name}\n${vars}`;
    }
    case "response": {
      const body = store.lastResponse?.body;
      if (typeof body === "string") return body.slice(0, 4000);
      return body ? JSON.stringify(body, null, 2) : "";
    }
    default:
      return "";
  }
}

export function attachmentsToPrompt(attachments: ContextAttachment[]): string {
  if (attachments.length === 0) return "";
  const blocks = attachments.map((a) => resolveAttachmentSnippet(a)).filter(Boolean);
  return `## Contexte attaché\n${blocks.join("\n\n")}`;
}
