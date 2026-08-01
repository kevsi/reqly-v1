import type { Rule, RequestContext } from "@/src/ai/types";

function bodyMessage(ctx: RequestContext): string | null {
  const body = ctx.response?.body;
  if (!body) return null;
  if (typeof body === "string") return body;
  if (typeof body === "object") {
    const b = body as Record<string, unknown>;
    return (typeof b.message === "string" ? b.message : null) || (typeof b.error === "string" ? b.error : null) || null;
  }
  return null;
}

export const serverRules: Rule[] = [
  { id: "server.500", category: "server", severity: "error", match: (ctx) => ctx.response?.status === 500, build: (ctx) => { const msg = bodyMessage(ctx); return { severity: "error", category: "server", title: "Erreur serveur (500)", explanation: msg ? `Le serveur a renvoyé une erreur 500 : ${msg}.` : "Le serveur a renvoyé une erreur 500.", confidence: "certain" }; } },
  { id: "server.502", category: "server", severity: "error", match: (ctx) => ctx.response?.status === 502, build: () => ({ severity: "error", category: "server", title: "Bad Gateway (502)", explanation: "Le proxy ou load balancer en amont n'a pas reçu de réponse valide.", confidence: "certain" }) },
  { id: "server.503", category: "server", severity: "error", match: (ctx) => ctx.response?.status === 503, build: () => ({ severity: "error", category: "server", title: "Service indisponible (503)", explanation: "Le serveur est en maintenance ou surchargé.", confidence: "certain" }) },
  { id: "server.504", category: "server", severity: "error", match: (ctx) => ctx.response?.status === 504, build: () => ({ severity: "error", category: "server", title: "Gateway Timeout (504)", explanation: "Le serveur upstream n'a pas répondu dans le délai imparti.", confidence: "certain" }) },
];
