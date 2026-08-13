import type { Rule, RequestContext } from "@/src/ai/types";
import i18n from "@/src/i18n";

function errorCode(ctx: RequestContext): string | undefined {
  return ctx.error?.code;
}

export const sslRules: Rule[] = [
  {
    id: "ssl.network.econnrefused",
    category: "ssl",
    severity: "error",
    match: (ctx) => errorCode(ctx) === "ECONNREFUSED",
    build: () => ({
      severity: "error",
      category: "ssl",
      title: i18n.t("ai.diag.ssl.network.econnrefused.title"),
      explanation: i18n.t("ai.diag.ssl.network.econnrefused.explanation"),
      confidence: "certain",
    }),
  },
  {
    id: "ssl.dns.enotfound",
    category: "ssl",
    severity: "error",
    match: (ctx) => errorCode(ctx) === "ENOTFOUND",
    build: () => ({
      severity: "error",
      category: "ssl",
      title: i18n.t("ai.diag.ssl.dns.enotfound.title"),
      explanation: i18n.t("ai.diag.ssl.dns.enotfound.explanation"),
      confidence: "certain",
    }),
  },
  {
    id: "ssl.timeout.etimedout",
    category: "ssl",
    severity: "error",
    match: (ctx) => errorCode(ctx) === "ETIMEDOUT",
    build: () => ({
      severity: "error",
      category: "ssl",
      title: i18n.t("ai.diag.ssl.timeout.etimedout.title"),
      explanation: i18n.t("ai.diag.ssl.timeout.etimedout.explanation"),
      confidence: "certain",
    }),
  },
  {
    id: "ssl.cert.expired",
    category: "ssl",
    severity: "error",
    match: (ctx) => errorCode(ctx) === "CERT_HAS_EXPIRED",
    build: () => ({
      severity: "error",
      category: "ssl",
      title: i18n.t("ai.diag.ssl.cert.expired.title"),
      explanation: i18n.t("ai.diag.ssl.cert.expired.explanation"),
      confidence: "certain",
    }),
  },
  {
    id: "ssl.cert.invalid",
    category: "ssl",
    severity: "error",
    match: (ctx) =>
      errorCode(ctx) === "CERT_INVALID" ||
      errorCode(ctx) === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
      errorCode(ctx) === "SELF_SIGNED_CERT_IN_CHAIN" ||
      errorCode(ctx) === "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    build: () => ({
      severity: "error",
      category: "ssl",
      title: i18n.t("ai.diag.ssl.cert.invalid.title"),
      explanation: i18n.t("ai.diag.ssl.cert.invalid.explanation"),
      confidence: "certain",
    }),
  },
];
