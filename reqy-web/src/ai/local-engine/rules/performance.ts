import type { Rule, RequestContext } from "@/src/ai/types";

export const performanceRules: Rule[] = [
  {
    id: "performance.timeout.warning",
    category: "performance", severity: "warning",
    match: (ctx) => (ctx.response?.duration ?? 0) > 5000 && (ctx.response?.duration ?? 0) <= 10000,
    build: (ctx) => ({ severity: "warning", category: "performance", title: "Réponse lente (> 5s)", explanation: `La requête a pris ${ctx.response?.duration}ms.`, confidence: "probable" }),
  },
  {
    id: "performance.timeout.critical",
    category: "performance", severity: "error",
    match: (ctx) => (ctx.response?.duration ?? 0) > 10000,
    build: (ctx) => ({ severity: "error", category: "performance", title: "Réponse très lente (> 10s)", explanation: `La requête a pris ${ctx.response?.duration}ms.`, confidence: "certain" }),
  },
  {
    id: "performance.429.with_retry_after",
    category: "performance", severity: "warning",
    match: (ctx) => ctx.response?.status === 429 && Object.keys(ctx.response.headers).some((k) => k.toLowerCase() === "retry-after"),
    build: (ctx) => {
      const ra = Object.entries(ctx.response!.headers).find(([k]) => k.toLowerCase() === "retry-after")?.[1];
      return { severity: "warning", category: "performance", title: `Rate limit (retry après ${ra ?? "?"})`, explanation: `Le serveur demande d'attendre ${ra ?? "?"}s.`, confidence: "certain" };
    },
  },
  {
    id: "performance.429.generic",
    category: "performance", severity: "warning",
    match: (ctx) => ctx.response?.status === 429 && !Object.keys(ctx.response.headers).some((k) => k.toLowerCase() === "retry-after"),
    build: () => ({ severity: "warning", category: "performance", title: "Rate limit atteint", explanation: "Trop de requêtes. Réduisez la fréquence.", confidence: "certain" }),
  },
  {
    id: "performance.body.large",
    category: "performance", severity: "info",
    match: (ctx) => (ctx.response?.size ?? 0) > 1024 * 1024,
    build: (ctx) => ({ severity: "info", category: "performance", title: "Réponse volumineuse (> 1 Mo)", explanation: `Taille ${Math.round((ctx.response?.size ?? 0) / 1024)} Ko.`, confidence: "certain" }),
  },
];
