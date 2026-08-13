import type { Rule, RequestContext } from "@/src/ai/types";
import i18n from "@/src/i18n";

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
    category: "format",
    severity: "error",
    match: (ctx) =>
      statusIs(ctx, 415) &&
      ["POST", "PUT", "PATCH"].includes(ctx.request.method) &&
      !hasContentType(ctx),
    build: () => ({
      severity: "error",
      category: "format",
      title: i18n.t("ai.diag.format.415.missing_content_type.title"),
      explanation: i18n.t("ai.diag.format.415.missing_content_type.explanation"),
      fix: {
        type: "header",
        description: i18n.t("ai.diag.format.415.missing_content_type.fix"),
        patch: { headers: { "content-type": "application/json" } },
        applyFix: () => ({ headers: { "content-type": "application/json" } }),
      },
      confidence: "certain",
      references: [
        {
          label: "MDN — Content-Type",
          url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Type",
        },
      ],
    }),
  },
  {
    id: "format.415.wrong_content_type",
    category: "format",
    severity: "error",
    match: (ctx) =>
      statusIs(ctx, 415) &&
      ["POST", "PUT", "PATCH"].includes(ctx.request.method) &&
      hasContentType(ctx),
    build: () => ({
      severity: "error",
      category: "format",
      title: i18n.t("ai.diag.format.415.wrong_content_type.title"),
      explanation: i18n.t("ai.diag.format.415.wrong_content_type.explanation"),
      fix: {
        type: "header",
        description: i18n.t("ai.diag.format.415.wrong_content_type.fix"),
        patch: { headers: { "content-type": "application/json" } },
        applyFix: () => ({ headers: { "content-type": "application/json" } }),
      },
      confidence: "probable",
    }),
  },
  {
    id: "format.400.missing_content_type",
    category: "format",
    severity: "warning",
    match: (ctx) =>
      statusIs(ctx, 400) &&
      ["POST", "PUT", "PATCH"].includes(ctx.request.method) &&
      !hasContentType(ctx) &&
      hasBody(ctx),
    build: () => ({
      severity: "warning",
      category: "format",
      title: i18n.t("ai.diag.format.400.missing_content_type.title"),
      explanation: i18n.t("ai.diag.format.400.missing_content_type.explanation"),
      fix: {
        type: "header",
        description: i18n.t("ai.diag.format.400.missing_content_type.fix"),
        patch: { headers: { "content-type": "application/json" } },
        applyFix: () => ({ headers: { "content-type": "application/json" } }),
      },
      confidence: "probable",
    }),
  },
  {
    id: "format.400.malformed_json",
    category: "format",
    severity: "error",
    match: (ctx) =>
      statusIs(ctx, 400) &&
      bodyString(ctx).match(/json|parse|unexpected|token|invalid json/i) !== null,
    build: () => ({
      severity: "error",
      category: "format",
      title: i18n.t("ai.diag.format.400.malformed_json.title"),
      explanation: i18n.t("ai.diag.format.400.malformed_json.explanation"),
      confidence: "certain",
    }),
  },
  {
    id: "format.404.not_found",
    category: "format",
    severity: "info",
    match: (ctx) => statusIs(ctx, 404),
    build: () => ({
      severity: "info",
      category: "format",
      title: i18n.t("ai.diag.format.404.not_found.title"),
      explanation: i18n.t("ai.diag.format.404.not_found.explanation"),
      confidence: "certain",
      references: [
        {
          label: "RFC 9110 — 404 Not Found",
          url: "https://www.rfc-editor.org/rfc/rfc9110#status.404",
        },
      ],
    }),
  },
  {
    id: "format.422.validation",
    category: "format",
    severity: "error",
    match: (ctx) =>
      statusIs(ctx, 422) ||
      bodyString(ctx).includes('"errors"') ||
      bodyString(ctx).includes('"validation"'),
    build: () => ({
      severity: "error",
      category: "format",
      title: i18n.t("ai.diag.format.422.validation.title"),
      explanation: i18n.t("ai.diag.format.422.validation.explanation"),
      confidence: "certain",
      references: [
        {
          label: "RFC 4918 — WebDAV (définit 422)",
          url: "https://datatracker.ietf.org/doc/html/rfc4918",
        },
      ],
    }),
  },
  {
    id: "format.413.payload_too_large",
    category: "format",
    severity: "error",
    match: (ctx) => statusIs(ctx, 413),
    build: () => ({
      severity: "error",
      category: "format",
      title: i18n.t("ai.diag.format.413.payload_too_large.title"),
      explanation: i18n.t("ai.diag.format.413.payload_too_large.explanation"),
      fix: {
        type: "body",
        description: i18n.t("ai.diag.format.413.payload_too_large.fix"),
        patch: {},
        applyFix: () => ({}),
      },
      confidence: "certain",
    }),
  },
];
