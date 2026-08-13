import type { Rule, RequestContext } from "@/src/ai/types";
import i18n from "@/src/i18n";

function bodyMessage(ctx: RequestContext): string | null {
  const body = ctx.response?.body;
  if (!body) return null;
  if (typeof body === "string") return body;
  if (typeof body === "object") {
    const b = body as Record<string, unknown>;
    return (
      (typeof b.message === "string" ? b.message : null) ||
      (typeof b.error === "string" ? b.error : null) ||
      null
    );
  }
  return null;
}

export const serverRules: Rule[] = [
  {
    id: "server.500",
    category: "server",
    severity: "error",
    match: (ctx) => ctx.response?.status === 500,
    build: (ctx) => {
      const msg = bodyMessage(ctx);
      return {
        severity: "error",
        category: "server",
        title: i18n.t("ai.diag.server.500.title"),
        explanation: msg
          ? i18n.t("ai.diag.server.500.explanationWithMsg", { msg })
          : i18n.t("ai.diag.server.500.explanation"),
        confidence: "certain",
      };
    },
  },
  {
    id: "server.502",
    category: "server",
    severity: "error",
    match: (ctx) => ctx.response?.status === 502,
    build: () => ({
      severity: "error",
      category: "server",
      title: i18n.t("ai.diag.server.502.title"),
      explanation: i18n.t("ai.diag.server.502.explanation"),
      confidence: "certain",
    }),
  },
  {
    id: "server.503",
    category: "server",
    severity: "error",
    match: (ctx) => ctx.response?.status === 503,
    build: () => ({
      severity: "error",
      category: "server",
      title: i18n.t("ai.diag.server.503.title"),
      explanation: i18n.t("ai.diag.server.503.explanation"),
      confidence: "certain",
    }),
  },
  {
    id: "server.504",
    category: "server",
    severity: "error",
    match: (ctx) => ctx.response?.status === 504,
    build: () => ({
      severity: "error",
      category: "server",
      title: i18n.t("ai.diag.server.504.title"),
      explanation: i18n.t("ai.diag.server.504.explanation"),
      confidence: "certain",
    }),
  },
];
