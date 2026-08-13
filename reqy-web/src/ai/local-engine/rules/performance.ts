import type { Rule } from "@/src/ai/types";
import i18n from "@/src/i18n";

export const performanceRules: Rule[] = [
  {
    id: "performance.timeout.warning",
    category: "performance",
    severity: "warning",
    match: (ctx) => (ctx.response?.duration ?? 0) > 5000 && (ctx.response?.duration ?? 0) <= 10000,
    build: (ctx) => ({
      severity: "warning",
      category: "performance",
      title: i18n.t("ai.diag.performance.timeout.warning.title"),
      explanation: i18n.t("ai.diag.performance.timeout.warning.explanation", {
        ms: ctx.response?.duration,
      }),
      confidence: "probable",
    }),
  },
  {
    id: "performance.timeout.critical",
    category: "performance",
    severity: "error",
    match: (ctx) => (ctx.response?.duration ?? 0) > 10000,
    build: (ctx) => ({
      severity: "error",
      category: "performance",
      title: i18n.t("ai.diag.performance.timeout.critical.title"),
      explanation: i18n.t("ai.diag.performance.timeout.critical.explanation", {
        ms: ctx.response?.duration,
      }),
      confidence: "certain",
    }),
  },
  {
    id: "performance.429.with_retry_after",
    category: "performance",
    severity: "warning",
    match: (ctx) =>
      ctx.response?.status === 429 &&
      Object.keys(ctx.response.headers).some((k) => k.toLowerCase() === "retry-after"),
    build: (ctx) => {
      const ra = Object.entries(ctx.response!.headers).find(
        ([k]) => k.toLowerCase() === "retry-after",
      )?.[1];
      return {
        severity: "warning",
        category: "performance",
        title: i18n.t("ai.diag.performance.429.with_retry_after.title", { value: ra ?? "?" }),
        explanation: i18n.t("ai.diag.performance.429.with_retry_after.explanation", {
          value: ra ?? "?",
        }),
        confidence: "certain",
      };
    },
  },
  {
    id: "performance.429.generic",
    category: "performance",
    severity: "warning",
    match: (ctx) =>
      ctx.response?.status === 429 &&
      !Object.keys(ctx.response.headers).some((k) => k.toLowerCase() === "retry-after"),
    build: () => ({
      severity: "warning",
      category: "performance",
      title: i18n.t("ai.diag.performance.429.generic.title"),
      explanation: i18n.t("ai.diag.performance.429.generic.explanation"),
      confidence: "certain",
    }),
  },
  {
    id: "performance.body.large",
    category: "performance",
    severity: "info",
    match: (ctx) => (ctx.response?.size ?? 0) > 1024 * 1024,
    build: (ctx) => ({
      severity: "info",
      category: "performance",
      title: i18n.t("ai.diag.performance.body.large.title"),
      explanation: i18n.t("ai.diag.performance.body.large.explanation", {
        kb: Math.round((ctx.response?.size ?? 0) / 1024),
      }),
      confidence: "certain",
    }),
  },
];
