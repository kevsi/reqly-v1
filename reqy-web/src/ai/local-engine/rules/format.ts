import type { Rule, RequestContext } from "@/src/ai/types";

function hasContentType(ctx: RequestContext): boolean {
  return Object.keys(ctx.request.headers).some((k) => k.toLowerCase() === "content-type");
}
function hasBody(ctx: RequestContext): boolean {
  return ctx.request.body !== null && ctx.request.body !== undefined;
}
function statusIs(ctx: RequestContext, status: number): boolean {
  return ctx.response?.status === status;
}
function bodyString(ctx: RequestContext): string {
  const body = ctx.response?.body;
  if (typeof body === "string") return body.toLowerCase();
  if (body && typeof body === "object") return JSON.stringify(body).toLowerCase();
  return "";
}

export const formatRules: Rule[] = [
  {
    id: "format.415.missing_content_type",
    category: "format", severity: "error",
    match: (ctx) => statusIs(ctx, 415) && ["POST", "PUT", "PATCH"].includes(ctx.request.method) && !hasContentType(ctx),
    build: () => ({
      severity: "error", category: "format", title: "Content-Type manquant",
      explanation: "Le serveur refuse la requête car le header Content-Type est absent. Pour un body JSON : Content-Type: application/json.",
      fix: { type: "header", description: "Ajouter Content-Type: application/json", patch: { headers: { "content-type": "application/json" } }, applyFix: () => ({ headers: { "content-type": "application/json" } }) },
      confidence: "certain",
      references: [{ label: "MDN — Content-Type", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Type" }],
    }),
  },
  {
    id: "format.415.wrong_content_type",
    category: "format", severity: "error",
    match: (ctx) => statusIs(ctx, 415) && ["POST", "PUT", "PATCH"].includes(ctx.request.method) && hasContentType(ctx),
    build: () => ({
      severity: "error", category: "format", title: "Content-Type non supporté",
      explanation: "Le serveur ne supporte pas le Content-Type envoyé. Vérifiez le format attendu (JSON, XML, form-data…).",
      fix: { type: "header", description: "Changer le Content-Type selon la doc de l'API", patch: { headers: { "content-type": "application/json" } }, applyFix: () => ({ headers: { "content-type": "application/json" } }) },
      confidence: "probable",
    }),
  },
  {
    id: "format.400.missing_content_type",
    category: "format", severity: "warning",
    match: (ctx) => statusIs(ctx, 400) && ["POST", "PUT", "PATCH"].includes(ctx.request.method) && !hasContentType(ctx) && hasBody(ctx),
    build: () => ({
      severity: "warning", category: "format", title: "Content-Type absent sur requête avec body",
      explanation: "Le serveur peut ne pas avoir parsé le body sans Content-Type. Ajoutez-le.",
      fix: { type: "header", description: "Ajouter Content-Type: application/json", patch: { headers: { "content-type": "application/json" } }, applyFix: () => ({ headers: { "content-type": "application/json" } }) },
      confidence: "probable",
    }),
  },
  {
    id: "format.400.malformed_json",
    category: "format", severity: "error",
    match: (ctx) => statusIs(ctx, 400) && bodyString(ctx).match(/json|parse|unexpected|token|invalid json/i) !== null,
    build: () => ({
      severity: "error", category: "format", title: "JSON malformé",
      explanation: "Le serveur signale une erreur de parsing JSON. Vérifiez la syntaxe (virgules, guillemets, accolades).",
      confidence: "certain",
    }),
  },
  {
    id: "format.404.not_found",
    category: "format", severity: "info",
    match: (ctx) => statusIs(ctx, 404),
    build: () => ({
      severity: "info", category: "format", title: "Ressource introuvable (404)",
      explanation: "L'endpoint ou la ressource demandée n'existe pas. Vérifiez l'URL, les paramètres de path, ou si la ressource a été supprimée.",
      confidence: "certain",
      references: [{ label: "RFC 9110 — 404 Not Found", url: "https://www.rfc-editor.org/rfc/rfc9110#status.404" }],
    }),
  },
  {
    id: "format.422.validation",
    category: "format", severity: "error",
    match: (ctx) => statusIs(ctx, 422) || bodyString(ctx).includes('"errors"') || bodyString(ctx).includes('"validation"'),
    build: () => ({
      severity: "error", category: "format", title: "Validation échouée",
      explanation: "Le serveur a rejeté les données car un ou plusieurs champs ne respectent pas les contraintes.",
      confidence: "certain",
      references: [{ label: "RFC 4918 — WebDAV (définit 422)", url: "https://datatracker.ietf.org/doc/html/rfc4918" }],
    }),
  },
  {
    id: "format.413.payload_too_large",
    category: "format", severity: "error",
    match: (ctx) => statusIs(ctx, 413),
    build: () => ({
      severity: "error", category: "format", title: "Payload trop volumineux",
      explanation: "Le body dépasse la taille maximale acceptée par le serveur. Réduisez la taille ou utilisez un upload en plusieurs parties.",
      fix: { type: "body", description: "Réduire la taille du payload (pagination, sous-ressources)", patch: {}, applyFix: () => ({}) },
      confidence: "certain",
    }),
  },
];
