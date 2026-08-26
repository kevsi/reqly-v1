#!/usr/bin/env node
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { analyze, toJson, toMarkdown, toMarkdownDiff, toOpenApi, toReqly } from "@analyser/core";
import { detectorJs } from "@analyser/detector-js";
import { detectorRust } from "@analyser/detector-rust";
import { detectorPython } from "@analyser/detector-python";
import { detectorGo } from "@analyser/detector-go";
import { detectorPhp } from "@analyser/detector-php";

const program = new Command();

const VALID_FORMATS = new Set(["json", "md", "markdown", "reqly", "openapi"]);
const VALID_LANGS = new Set(["javascript", "typescript", "js", "ts", "rust", "python", "go", "php"]);

const LANG_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "javascript",
  typescript: "javascript",
};

function normalizeLang(lang: string): string {
  return LANG_ALIASES[lang] ?? lang;
}

program
  .name("analyser")
  .description("Scan a backend codebase and extract API routes via ast-grep.")
  .version("0.1.0");

program
  .command("scan")
  .description("Scan a directory and output the extracted API routes.")
  .argument("<path>", "directory to scan")
  .option("-f, --format <fmt>", "output format: json, md, markdown, reqly, openapi", "json")
  .option("-o, --out <file>", "write output to file instead of stdout")
  .option(
    "-l, --lang <lang>",
    "restrict to one language (javascript, typescript/js/ts, rust, python, go, php)",
  )
  .option("-d, --diff <file>", "compare with a previous scan (json) and print a diff")
  .action(
    async (
      target: string,
      opts: { format: string; out?: string; lang?: string; diff?: string },
    ) => {
      if (!VALID_FORMATS.has(opts.format)) {
        console.error(`Unknown format "${opts.format}". Use json, md, reqly or openapi.`);
        process.exit(1);
      }
      if (opts.lang && !VALID_LANGS.has(opts.lang)) {
        console.error(`Unknown language "${opts.lang}". Use javascript, typescript, js, ts, rust, python, go or php.`);
        process.exit(1);
      }
      const rootPath = path.resolve(target);
      const detectors = [detectorJs, detectorRust, detectorPython, detectorGo, detectorPhp];
      const normalizedLang = opts.lang ? normalizeLang(opts.lang) : undefined;
      const result = await analyze({
        rootPath,
        detectors,
        langs: normalizedLang ? [normalizedLang] : undefined,
      });

      let out: string;
      switch (opts.format) {
        case "md":
        case "markdown":
          out = toMarkdown(result);
          break;
        case "reqly":
          out = JSON.stringify(toReqly(result), null, 2);
          break;
        case "openapi":
          out = JSON.stringify(toOpenApi(result), null, 2);
          break;
        default:
          out = toJson(result);
      }

      if (opts.diff) {
        const prev = JSON.parse(await fs.readFile(path.resolve(opts.diff), "utf8"));
        const prevRoutes = Array.isArray(prev) ? prev : prev.routes;
        out = toMarkdownDiff(prevRoutes, result.routes);
      }

      if (opts.out) {
        await fs.writeFile(path.resolve(opts.out), out, "utf8");
        console.error(`Wrote ${result.routes.length} routes to ${opts.out}`);
      } else {
        process.stdout.write(out + "\n");
      }
    },
  );

program.parseAsync(process.argv).catch((err) => {
  console.error(`Scan failed: ${String(err instanceof Error ? err.message : err)}`);
  process.exit(1);
});
