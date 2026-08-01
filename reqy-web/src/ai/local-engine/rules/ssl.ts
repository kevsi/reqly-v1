import type { Rule, RequestContext } from "@/src/ai/types";

function errorCode(ctx: RequestContext): string | undefined {
  return ctx.error?.code;
}

export const sslRules: Rule[] = [
  { id: "ssl.network.econnrefused", category: "ssl", severity: "error", match: (ctx) => errorCode(ctx) === "ECONNREFUSED", build: () => ({ severity: "error", category: "ssl", title: "Connexion refusée", explanation: "Le serveur cible refuse la connexion.", confidence: "certain" }) },
  { id: "ssl.dns.enotfound", category: "ssl", severity: "error", match: (ctx) => errorCode(ctx) === "ENOTFOUND", build: () => ({ severity: "error", category: "ssl", title: "DNS non résolu", explanation: "Le nom de domaine n'a pas pu être résolu.", confidence: "certain" }) },
  { id: "ssl.timeout.etimedout", category: "ssl", severity: "error", match: (ctx) => errorCode(ctx) === "ETIMEDOUT", build: () => ({ severity: "error", category: "ssl", title: "Timeout réseau", explanation: "La connexion a expiré.", confidence: "certain" }) },
  { id: "ssl.cert.expired", category: "ssl", severity: "error", match: (ctx) => errorCode(ctx) === "CERT_HAS_EXPIRED", build: () => ({ severity: "error", category: "ssl", title: "Certificat SSL expiré", explanation: "Le certificat SSL du serveur a expiré.", confidence: "certain" }) },
  { id: "ssl.cert.invalid", category: "ssl", severity: "error", match: (ctx) => errorCode(ctx) === "CERT_INVALID" || errorCode(ctx) === "DEPTH_ZERO_SELF_SIGNED_CERT" || errorCode(ctx) === "SELF_SIGNED_CERT_IN_CHAIN" || errorCode(ctx) === "UNABLE_TO_VERIFY_LEAF_SIGNATURE", build: () => ({ severity: "error", category: "ssl", title: "Certificat SSL invalide", explanation: "Certificat auto-signé ou non reconnu.", confidence: "certain" }) },
];
