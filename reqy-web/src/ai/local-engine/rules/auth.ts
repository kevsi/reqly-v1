/**
 * Auth rules — 401 (missing / expired / invalid token, bad credentials)
 * and 403 (scope, role, admin).
 */
import type { Rule, RequestContext } from "@/src/ai/types";

function hasAuthHeader(ctx: RequestContext): boolean {
  return Object.keys(ctx.request.headers).some(
    (k) => k.toLowerCase() === "authorization"
  );
}

function isBearer(ctx: RequestContext): boolean {
  const auth = Object.entries(ctx.request.headers).find(
    ([k]) => k.toLowerCase() === "authorization"
  )?.[1];
  return !!auth && /^Bearer\s+/i.test(auth);
}

function responseBodyString(ctx: RequestContext): string {
  const body = ctx.response?.body;
  if (typeof body === "string") return body.toLowerCase();
  if (body && typeof body === "object") return JSON.stringify(body).toLowerCase();
  return "";
}

function responseHeadersString(ctx: RequestContext): string {
  return JSON.stringify(ctx.response?.headers ?? {}).toLowerCase();
}

function isStatus(ctx: RequestContext, status: number): boolean {
  return ctx.response?.status === status;
}

export const authRules: Rule[] = [
  {
    id: "auth.401.bearer.missing",
    category: "auth",
    severity: "error",
    match: (ctx) => isStatus(ctx, 401) && !hasAuthHeader(ctx),
    build: () => ({
      severity: "error",
      category: "auth",
      title: "Token Bearer manquant",
      explanation: "La requête ne contient pas de header Authorization. L'endpoint requiert une authentification.",
      fix: {
        type: "header",
        description: "Ajouter le header Authorization: Bearer <token>",
        patch: { headers: { authorization: "Bearer {{token}}" } },
        applyFix: () => ({ headers: { authorization: "Bearer {{token}}" } }),
      },
      confidence: "certain",
      references: [{ label: "MDN — Authorization", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Authorization" }],
    }),
  },
  {
    id: "auth.401.bearer.expired",
    category: "auth",
    severity: "error",
    match: (ctx) =>
      isStatus(ctx, 401) &&
      isBearer(ctx) &&
      (responseBodyString(ctx).includes("expired") ||
        responseHeadersString(ctx).includes("expired")),
    build: () => ({
      severity: "error",
      category: "auth",
      title: "Token Bearer expiré",
      explanation: "Le serveur signale que le token a expiré. Régénérez-le via un refresh ou un nouveau login.",
      fix: {
        type: "auth",
        description: "Régénérer le token (refresh token ou re-login)",
        patch: {},
        applyFix: () => ({}),
      },
      confidence: "certain",
      references: [{ label: "RFC 6750 — Bearer Token Usage", url: "https://datatracker.ietf.org/doc/html/rfc6750" }],
    }),
  },
  {
    id: "auth.401.bearer.invalid",
    category: "auth",
    severity: "error",
    match: (ctx) =>
      isStatus(ctx, 401) &&
      isBearer(ctx) &&
      !responseBodyString(ctx).includes("expired") &&
      !responseHeadersString(ctx).includes("expired") &&
      (responseBodyString(ctx).includes("invalid") ||
        responseHeadersString(ctx).includes("invalid_token") ||
        responseHeadersString(ctx).includes("invalid")),
    build: () => ({
      severity: "error",
      category: "auth",
      title: "Token Bearer invalide",
      explanation: "Le serveur rejette le token (signature invalide, format incorrect, ou audience non autorisée).",
      fix: {
        type: "auth",
        description: "Vérifier la validité du token (jwt.io)",
        patch: {},
        applyFix: () => ({}),
      },
      confidence: "probable",
    }),
  },
  {
    id: "auth.401.basic.bad_credentials",
    category: "auth",
    severity: "error",
    match: (ctx) => isStatus(ctx, 401) && ctx.request.authType === "basic",
    build: () => ({
      severity: "error",
      category: "auth",
      title: "Identifiants Basic incorrects",
      explanation: "L'authentification Basic a échoué. Vérifiez le nom d'utilisateur et le mot de passe.",
      fix: {
        type: "auth",
        description: "Vérifier les identifiants encodés en base64",
        patch: {},
        applyFix: () => ({}),
      },
      confidence: "certain",
    }),
  },
  {
    id: "auth.403.scope",
    category: "auth",
    severity: "error",
    match: (ctx) =>
      isStatus(ctx, 403) &&
      (responseBodyString(ctx).includes("scope") || responseBodyString(ctx).includes("insufficient")),
    build: () => ({
      severity: "error",
      category: "auth",
      title: "Scope insuffisant",
      explanation: "Le token est valide mais ne dispose pas des permissions (scopes) nécessaires.",
      fix: {
        type: "auth",
        description: "Demander un token avec les scopes requis",
        patch: {},
        applyFix: () => ({}),
      },
      confidence: "probable",
      references: [{ label: "RFC 6749 — OAuth 2.0", url: "https://datatracker.ietf.org/doc/html/rfc6749" }],
    }),
  },
  {
    id: "auth.403.admin",
    category: "auth",
    severity: "error",
    match: (ctx) => isStatus(ctx, 403) && /\/admin\//i.test(ctx.request.url),
    build: () => ({
      severity: "error",
      category: "auth",
      title: "Permissions admin requises",
      explanation: "L'endpoint /admin/ nécessite un rôle administrateur.",
      fix: {
        type: "auth",
        description: "Utiliser un compte avec rôle admin",
        patch: {},
        applyFix: () => ({}),
      },
      confidence: "certain",
    }),
  },
];
