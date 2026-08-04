import type { RunResult } from "./types.js";
import fs from "node:fs";
import chalk from "chalk";

/** Pattern-based detection of sensitive values (tokens, secrets, passwords, etc.) */
const SENSITIVE_PATTERN =
  /(token|secret|password|auth|apikey|api_key|session|jwt|bearer|ssn|credit|card)/i;

/** Redact sensitive information from a value (unknown-safe: objects are JSON-stringified). */
function redactSensitive(value: unknown): string {
  if (value === undefined || value === null) return "";
  const s = typeof value === "string" ? value : JSON.stringify(value);
  if (!s || s.length < 8) return s;
  if (SENSITIVE_PATTERN.test(s)) {
    return s.slice(0, 4) + "****" + s.slice(-4);
  }
  return s;
}

/** Redact sensitive keys from a record */
function redactRecord(record: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    result[k] = SENSITIVE_PATTERN.test(k) ? redactSensitive(v) : v;
  }
  return result;
}

export function reportCLI(results: RunResult[]): void {
  const methodWidth = Math.max(6, ...results.map((r) => r.method.length));
  const statusWidth = Math.max(3, ...results.map((r) => String(r.status).length));

  for (const result of results) {
    const icon = result.passed ? chalk.green("✓") : chalk.red("✗");
    const method = chalk.bold(String(result.method).padEnd(methodWidth));
    const status = String(result.status || "---").padStart(statusWidth);
    const coloredStatus = result.passed ? chalk.green(status) : chalk.red(status);
    const time = chalk.gray(`${result.durationMs}ms`);

    if (result.error) {
      console.log(
        `${icon} ${method} ${result.url}    ${coloredStatus}   ${time}  ${chalk.red(result.error)}`,
      );
    } else {
      console.log(`${icon} ${method} ${result.url}    ${coloredStatus}   ${time}`);
    }

    if (result.assertions && result.assertions.length > 0) {
      for (const a of result.assertions) {
        const aIcon = a.passed ? chalk.green("  ✓") : chalk.red("  ✗");
        if (a.passed) {
          console.log(`${aIcon} ${a.name ?? ""}`);
        } else {
          console.log(
            `${aIcon} ${a.name ?? ""}  ${chalk.red(`(expected: ${redactSensitive(a.expected)}, got: ${redactSensitive(a.actual)})`)}`,
          );
        }
      }
    }

    if (result.snapshotChanged) {
      console.log(chalk.yellow(`  \u25A0 snapshot changed`));
    }

    if (result.capturedVars && Object.keys(result.capturedVars).length > 0) {
      const redacted = redactRecord(result.capturedVars);
      for (const [k, v] of Object.entries(redacted)) {
        console.log(chalk.dim(`  \u2192 captured {{${k}}} = ${v}`));
      }
    }
  }
}

export function reportJSON(results: RunResult[]): string {
  // Redact sensitive data in JSON output
  const safe = results.map((r) => ({
    ...r,
    capturedVars: r.capturedVars ? redactRecord(r.capturedVars) : undefined,
  }));
  return safe.map((r) => JSON.stringify(r)).join("\n");
}

export function buildJUnit(results: RunResult[]): string {
  const total = results.length;
  const failures = results.filter((r) => !r.passed).length;
  const totalTime = results.reduce((s, r) => s + r.durationMs, 0);

  let testcases = "";
  for (const r of results) {
    const className = r.name.replace(/[^a-zA-Z0-9]/g, "_");
    testcases += `    <testcase name="${escapeXml(r.name)}" classname="${escapeXml(className)}" time="${(r.durationMs / 1000).toFixed(3)}">\n`;
    if (!r.passed) {
      if (r.assertions) {
        const failedAssertions = r.assertions.filter((a) => !a.passed);
        for (const a of failedAssertions) {
          testcases += `      <failure message="${escapeXml(a.name ?? "")}" type="AssertionError">\n`;
          testcases += `        Expected: ${escapeXml(redactSensitive(a.expected))}\n`;
          testcases += `        Actual:   ${escapeXml(redactSensitive(a.actual))}\n`;
          testcases += `      </failure>\n`;
        }
      }
      if (!r.assertions || r.assertions.every((a) => a.passed)) {
        const msg = escapeXml(r.error || `Expected status < 400, got ${r.status}`);
        testcases += `      <failure message="${msg}" type="RequestError"/>\n`;
      }
    }
    testcases += `    </testcase>\n`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="recli" tests="${total}" failures="${failures}" errors="0" time="${(totalTime / 1000).toFixed(3)}">
${testcases}</testsuite>`;
}

export function buildHTML(results: RunResult[]): string {
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;
  const totalTime = results.reduce((s, r) => s + r.durationMs, 0);
  const avgTime = total > 0 ? (totalTime / total).toFixed(0) : "0";

  let rows = "";
  for (const r of results) {
    const statusClass = r.passed ? "pass" : "fail";

    let assertionsHtml = "";
    if (r.assertions?.length) {
      for (const a of r.assertions) {
        assertionsHtml += `<div class="assertion ${a.passed ? "a-pass" : "a-fail"}">
  <span class="a-icon">${a.passed ? "\u2713" : "\u2717"}</span>
  <span class="a-name">${escapeHtml(a.name ?? "")}</span>${a.passed ? "" : `<span class="a-detail">expected ${escapeHtml(redactSensitive(a.expected))}, got ${escapeHtml(redactSensitive(a.actual))}</span>`}
</div>`;
      }
    }

    let capturesHtml = "";
    if (r.capturedVars) {
      const redacted = redactRecord(r.capturedVars);
      for (const [k, v] of Object.entries(redacted)) {
        capturesHtml += `<div class="capture"><span class="c-key">{{${escapeHtml(k)}}}</span> = <span class="c-val">${escapeHtml(v)}</span></div>`;
      }
    }

    const bodyPreview = r.body
      ? `<details class="body-preview"><summary>Response Body (${r.size} bytes)</summary><pre>${escapeHtml(r.body.slice(0, 2000))}${r.body.length > 2000 ? "..." : ""}</pre></details>`
      : "";

    const errorHtml = r.error ? `<div class="error">${escapeHtml(r.error)}</div>` : "";

    rows += `<tr class="${statusClass}">
  <td><span class="status-badge ${statusClass}">${r.passed ? "PASS" : "FAIL"}</span></td>
  <td><span class="method method-${r.method.toLowerCase()}">${r.method}</span></td>
  <td class="url-cell" title="${escapeHtml(r.url)}">${escapeHtml(r.url)}</td>
  <td>${r.status || "---"}</td>
  <td>${r.durationMs}ms</td>
  <td>${assertionsHtml}${capturesHtml}${errorHtml}${bodyPreview}</td>
</tr>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Recli Test Report</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0d1117;color:#c9d1d9;padding:24px}
h1{font-size:24px;margin-bottom:8px;color:#f0f6fc}
.summary{display:flex;gap:24px;margin-bottom:24px;padding:16px 20px;background:#161b22;border-radius:8px;border:1px solid #30363d}
.summary-item{text-align:center}
.summary-item .num{font-size:28px;font-weight:700}
.summary-item .label{font-size:12px;color:#8b949e;text-transform:uppercase;letter-spacing:.5px}
.summary-item .num.pass{color:#3fb950}
.summary-item .num.fail{color:#f85149}
.summary-item .num.total{color:#58a6ff}
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:10px 12px;font-size:12px;text-transform:uppercase;color:#8b949e;border-bottom:1px solid #30363d}
td{padding:10px 12px;border-bottom:1px solid #21262d;font-size:14px;vertical-align:top}
tr:hover{background:#161b22}
tr.fail{background:#2d1215}
.status-badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600}
.status-badge.pass{background:#1b3a22;color:#3fb950}
.status-badge.fail{background:#3d1418;color:#f85149}
.method{font-weight:600;font-family:'SFMono-Regular',Consolas,monospace;font-size:12px}
.method-get{color:#58a6ff}
.method-post{color:#3fb950}
.method-put{color:#d29922}
.method-patch{color:#d29922}
.method-delete{color:#f85149}
.url-cell{max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:'SFMono-Regular',Consolas,monospace;font-size:12px;color:#8b949e}
.assertion{margin:2px 0;font-size:12px}
.a-pass{color:#3fb950}
.a-fail{color:#f85149}
.a-icon{margin-right:4px}
.a-detail{color:#8b949e;margin-left:8px;font-size:11px}
.capture{font-size:11px;color:#d2a8ff;margin:2px 0}
.error{color:#f85149;font-size:12px;margin:4px 0}
.body-preview{margin:4px 0}
.body-preview summary{cursor:pointer;font-size:12px;color:#8b949e;margin-bottom:2px}
.body-preview pre{margin-top:4px;padding:8px;background:#0d1117;border:1px solid #30363d;border-radius:4px;font-size:11px;max-height:200px;overflow:auto;white-space:pre-wrap;word-break:break-all}
</style>
</head>
<body>
<h1>Recli Test Report</h1>
<div class="summary">
  <div class="summary-item"><div class="num total">${total}</div><div class="label">Total</div></div>
  <div class="summary-item"><div class="num pass">${passed}</div><div class="label">Passed</div></div>
  <div class="summary-item"><div class="num fail">${failed}</div><div class="label">Failed</div></div>
  <div class="summary-item"><div class="num">${totalTime}ms</div><div class="label">Total Time</div></div>
  <div class="summary-item"><div class="num">${avgTime}ms</div><div class="label">Avg/Request</div></div>
</div>
<table>
<thead><tr><th>Status</th><th>Method</th><th>URL</th><th>Code</th><th>Time</th><th>Details</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<p style="margin-top:16px;font-size:11px;color:#484f58;">Generated by Recli at ${new Date().toISOString()}</p>
</body>
</html>`;
}

export function writeReport(content: string, outputPath: string): void {
  const dir = pathDir(outputPath);
  if (dir) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, content, "utf8");
  console.log(chalk.green(`Report written to ${outputPath}`));
}

function pathDir(p: string): string {
  const normalized = p.replace(/\\/g, "/");
  const lastSep = normalized.lastIndexOf("/");
  return lastSep === -1 ? "" : p.slice(0, lastSep);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function printSummary(results: RunResult[], json: boolean): void {
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  const totalTime = results.reduce((sum, r) => sum + r.durationMs, 0);

  if (!json) {
    const totalSeconds = (totalTime / 1000).toFixed(1);
    const passedStr = chalk.green(`${passed} passed`);
    const failedStr = failed > 0 ? chalk.red(`, ${failed} failed`) : "";
    const skipped = results.filter((r) => r.status === 0 && !r.error).length;
    const skippedStr = skipped > 0 ? chalk.gray(`, ${skipped} skipped`) : "";
    console.log(`\n${passedStr}${failedStr}${skippedStr} in ${totalSeconds}s`);
  }
}

export function printError(msg: string): void {
  console.error(chalk.red(msg));
}
