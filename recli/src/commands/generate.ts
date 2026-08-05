import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { generateTests } from "../generate-tests.js";

export function registerGenerate(program: Command): void {
  program
    .command("generate <spec>")
    .description("Generate edge-case test collection from an OpenAPI spec")
    .option("--output <path>", "Output file path")
    .option("--base-url <url>", "Override base URL (defaults to spec's servers[0])")
    .action(async (specFile: string, opts: { output?: string; baseUrl?: string }) => {
      const resolved = path.resolve(specFile);
      if (!fs.existsSync(resolved)) {
        process.stderr.write(`File not found: ${resolved}\n`);
        process.exit(1);
      }

      const spec = fs.readFileSync(resolved, "utf8");
      const bundle = generateTests(spec, opts.baseUrl);

      const outPath = opts.output || resolved.replace(/\.\w+$/, "") + "-tests.json";
      fs.writeFileSync(outPath, JSON.stringify(bundle, null, 2), "utf8");
      console.log(`Generated: ${outPath} (${bundle.collections[0].requests.length} requests)`);
    });
}
