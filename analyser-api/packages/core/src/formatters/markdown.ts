import type { AnalysisResult, ApiRoute } from "../types.ts";
import { diffRoutes } from "../helpers.ts";

function authCell(r: ApiRoute): string {
  if (!r.auth.required) return r.auth.confidence === "high" ? "✗" : "✗ (?)";
  const extra = r.auth.middleware?.length ? ` (${r.auth.middleware.join(", ")})` : "";
  return `✓${extra}`;
}

function bodyCell(r: ApiRoute): string {
  if (!r.body) return "—";
  const parts = [r.body.contentType];
  if (r.body.schemaName) parts.push(r.body.schemaName);
  return parts.filter(Boolean).join(" ");
}

export function toMarkdown(result: AnalysisResult): string {
  const lines: string[] = [];
  const { projectName } = result;

  lines.push(`# API Report — ${projectName}`);
  lines.push("");
  lines.push(`- **Languages:** ${result.languagesDetected.join(", ") || "none"}`);
  lines.push(`- **Frameworks:** ${result.frameworksDetected.join(", ") || "none"}`);
  lines.push(
    `- **Routes:** ${result.totalRoutes} (${result.routesWithAuth} with auth, ${result.routesWithoutAuth} without)`,
  );
  lines.push(`- **Scanned at:** ${result.scannedAt}`);
  if (result.warnings.length) {
    lines.push("");
    lines.push("**Warnings:**");
    for (const w of result.warnings) lines.push(`- ${w}`);
  }
  lines.push("");
  lines.push(`## Routes (${result.totalRoutes})`);
  lines.push("");
  lines.push("| Method | Path | Auth | Body | File |");
  lines.push("| ------ | ---- | ---- | ---- | ---- |");

  const byFile = new Map<string, ApiRoute[]>();
  for (const r of result.routes) {
    const arr = byFile.get(r.file) ?? [];
    arr.push(r);
    byFile.set(r.file, arr);
  }

  for (const [file, routes] of byFile) {
    for (const r of routes) {
      lines.push(
        `| ${r.method} | \`${r.path || "/"}\` | ${authCell(r)} | ${bodyCell(r)} | ${file.replace(/\\/g, "/")}:${r.line} |`,
      );
    }
  }

  lines.push("");
  lines.push("## Security");
  lines.push("");
  lines.push(
    `- Routes without auth: ${result.stats.withoutAuth} (high confidence: ${result.stats.confidence.high}, medium: ${result.stats.confidence.medium}, low: ${result.stats.confidence.low})`,
  );
  const exposed = result.routes.filter((r) => !r.auth.required);
  if (exposed.length) {
    lines.push("");
    lines.push("Exposed endpoints:");
    for (const r of exposed) {
      lines.push(
        `- \`${r.method} ${r.path || "/"}\` (${r.framework}, confidence ${r.auth.confidence})`,
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}

/** Markdown summary of the difference between two scans. */
export function toMarkdownDiff(prevRoutes: ApiRoute[], curRoutes: ApiRoute[]): string {
  const { added, removed, changed } = diffRoutes(prevRoutes, curRoutes);
  const lines: string[] = [`# Route Diff`, ""];
  lines.push(`- **Added:** ${added.length}`);
  lines.push(`- **Removed:** ${removed.length}`);
  lines.push(`- **Changed:** ${changed.length}`);
  for (const [title, set] of [
    ["## Added", added],
    ["## Removed", removed],
    ["## Changed", changed],
  ] as const) {
    if (!set.length) continue;
    lines.push("", title, "");
    lines.push("| Method | Path | Auth | File |", "| ------ | ---- | ---- | ---- |");
    for (const r of set) {
      lines.push(
        `| ${r.method} | \`${r.path || "/"}\` | ${authCell(r)} | ${r.file.replace(/\\/g, "/")}:${r.line} |`,
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}
