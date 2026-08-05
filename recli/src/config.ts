import fs from "node:fs";
import path from "node:path";
import type { RecliConfig } from "./types.js";

const CONFIG_FILES = [".reclirc", ".reclirc.json", "recli.config.json", ".reclirc.yaml"];

export function loadConfig(searchDir?: string): RecliConfig {
  const startDir = searchDir || process.cwd();
  let dir = startDir;

  const root = path.parse(dir).root;

  while (true) {
    for (const cfgFile of CONFIG_FILES) {
      const cfgPath = path.join(dir, cfgFile);
      if (fs.existsSync(cfgPath)) {
        try {
          return parseConfigFile(cfgPath);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`Warning: Failed to parse config ${cfgPath}: ${msg}`);
          return {};
        }
      }
    }

    if (dir === root) break;
    dir = path.dirname(dir);
  }

  return {};
}

function parseConfigFile(filePath: string): RecliConfig {
  const ext = path.extname(filePath).toLowerCase();
  const content = fs.readFileSync(filePath, "utf8");

  if (ext === ".json" || (filePath.endsWith(".reclirc") && isJSON(content))) {
    return JSON.parse(content);
  }

  if (ext === ".yaml" || ext === ".yml") {
    return parseSimpleConfig(content, ":");
  }

  // .reclirc without extension - try JSON first, then key=value format
  if (isJSON(content)) {
    return JSON.parse(content);
  }

  return parseSimpleConfig(content, "=");
}

function isJSON(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

/**
 * Unified config parser — handles both key=value (dotenv-style) and key: value (YAML-style).
 * The only difference is the separator character.
 */
function parseSimpleConfig(content: string, separator: string): RecliConfig {
  const config: RecliConfig = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const sepIdx = trimmed.indexOf(separator);
    if (sepIdx === -1) continue;
    const key = trimmed.slice(0, sepIdx).trim();
    let value: string | boolean | number = trimmed.slice(sepIdx + 1).trim();

    if (value === "true") value = true;
    else if (value === "false") value = false;
    else if (/^\d+$/.test(value)) value = parseInt(value, 10);

    switch (key) {
      case "env":
        config.env = String(value);
        break;
      case "timeout":
        config.timeout = Number(value);
        break;
      case "parallel":
        config.parallel = value === true || value === "true";
        break;
      case "delay":
        config.delay = Number(value);
        break;
      case "iterations":
        config.iterations = Number(value);
        break;
      case "reporter":
        config.reporter = String(value);
        break;
      case "output":
        config.output = String(value);
        break;
      case "data":
        config.data = String(value);
        break;
      case "snapshot":
        config.snapshot = value === true || value === "true";
        break;
      case "dotenv":
        config.dotenv = String(value);
        break;
      case "bail":
        config.bail = value === true || value === "true";
        break;
      case "retries":
        config.retries = Number(value);
        break;
      case "retryOn":
        config.retryOn = String(value);
        break;
      case "retryDelay":
        config.retryDelay = Number(value);
        break;
    }
  }
  return config;
}
