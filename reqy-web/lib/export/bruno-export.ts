/**
 * Export d'une collection Reqly vers le format Bruno (`.bru`).
 *
 * Génère une map chemin relatif → contenu de fichier : `bruno.json` à la
 * racine, un `.bru` par requête, les dossiers = sous-répertoires (les
 * dossiers vides produisent un `folder.bru` minimal pour préserver
 * l'arborescence).
 *
 * Référence format : https://docs.usebruno.com/bru-lang/overview
 */

import type { Collection, CollectionFolder, RequestItem } from "@/lib/types";
import type { Assertion } from "@/lib/test-runner/types";
import { assertionsToTestsBlock } from "./assertions-to-tests";

export type ExportFileMap = Map<string, string>;

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
}

function bruValue(value: string): string {
  // Bruno tolère les valeurs brutes sur une ligne ; on neutralise les
  // retours à la ligne pour ne pas casser le bloc.
  return value.replace(/\r?\n/g, "\\n");
}

function methodBlock(request: RequestItem): string {
  const lines: string[] = [`${request.method.toLowerCase()} {`];
  lines.push(`  url: ${bruValue(request.url)}`);
  lines.push(`  body: ${request.bodyType === "json" || (request.body && request.bodyType === undefined) ? "json" : request.bodyType ?? "none"}`);
  lines.push(`  auth: ${request.authType && request.authType !== "none" ? request.authType : "none"}`);
  lines.push("}");
  return lines.join("\n");
}

function headersBlock(request: RequestItem): string | null {
  const entries = Object.entries(request.headers ?? {}).filter(([k]) => k.trim());
  if (entries.length === 0) return null;
  const lines = ["headers {"];
  for (const [key, value] of entries) {
    lines.push(`  ${key}: ${bruValue(String(value))}`);
  }
  lines.push("}");
  return lines.join("\n");
}

function queryParamsBlock(request: RequestItem): string | null {
  const entries = (request.queryParams ?? []).filter((p) => p.key.trim());
  if (entries.length === 0) return null;
  const lines = ["params:query {"];
  for (const param of entries) {
    lines.push(`  ${param.key}: ${bruValue(param.value)}`);
  }
  lines.push("}");
  return lines.join("\n");
}

function bodyBlock(request: RequestItem): string | null {
  if (!request.body) return null;
  const lines: string[] = [];
  if (request.protocol === "graphql" && request.graphql) {
    lines.push("body:graphql {");
    lines.push(indentBlock(request.graphql.query));
    lines.push("}");
    if (request.graphql.variables && request.graphql.variables.trim() !== "{}") {
      lines.push("body:graphql:vars {");
      lines.push(indentBlock(request.graphql.variables));
      lines.push("}");
    }
    return lines.join("\n");
  }
  switch (request.bodyType) {
    case "json":
      lines.push("body:json {");
      lines.push(indentBlock(request.body));
      lines.push("}");
      break;
    case "x-www-form": {
      lines.push("body:form {");
      try {
        const parsed = JSON.parse(request.body) as Record<string, unknown>;
        for (const [key, value] of Object.entries(parsed)) {
          lines.push(`  ${key}: ${bruValue(String(value))}`);
        }
      } catch {
        lines.push(indentBlock(request.body));
      }
      lines.push("}");
      break;
    }
    case "form-data":
      lines.push("body:multipartForm {");
      lines.push(indentBlock(request.body));
      lines.push("}");
      break;
    default:
      lines.push("body:text {");
      lines.push(indentBlock(request.body));
      lines.push("}");
  }
  return lines.join("\n");
}

function indentBlock(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => `  ${line}`)
    .join("\n");
}

function authBlock(request: RequestItem): string | null {
  if (!request.authType || request.authType === "none" || !request.authToken) return null;
  if (request.authType === "bearer") {
    return [
      "auth {",
      "  mode: bearer",
      "  bearer {",
      `    token: ${bruValue(request.authToken)}`,
      "  }",
      "}",
    ].join("\n");
  }
  if (request.authType === "basic") {
    // authToken = base64(username:password) dans Reqly — décodé si possible.
    try {
      const decoded = atob(request.authToken);
      const idx = decoded.indexOf(":");
      const username = idx === -1 ? decoded : decoded.slice(0, idx);
      const password = idx === -1 ? "" : decoded.slice(idx + 1);
      return [
        "auth {",
        "  mode: basic",
        "  basic {",
        `    username: ${bruValue(username)}`,
        `    password: ${bruValue(password)}`,
        "  }",
        "}",
      ].join("\n");
    } catch {
      // Pas du base64 : garder l'en-tête Authorization tel quel.
    }
  }
  return null;
}

function scriptBlocks(request: RequestItem): string | null {
  const blocks: string[] = [];
  if (request.preRequestScript?.trim()) {
    blocks.push(`script:pre-request {\n${indentBlock(request.preRequestScript)}\n}`);
  }
  if (request.postResponseScript?.trim()) {
    blocks.push(`script:post-response {\n${indentBlock(request.postResponseScript)}\n}`);
  }
  return blocks.length ? blocks.join("\n\n") : null;
}

function testsBlock(request: RequestItem): string | null {
  const code = assertionsToTestsBlock(request.runnerAssertions as Assertion[] | undefined);
  if (!code) return null;
  return `tests {\n${indentBlock(code)}\n}`;
}

export function requestToBru(request: RequestItem, seq: number): string {
  const blocks: string[] = [
    ["meta {", `  name: ${request.name.replace(/\r?\n/g, " ")}`, `  type: http`, `  seq: ${seq}`, "}"].join("\n"),
    methodBlock(request),
  ];
  for (const block of [
    headersBlock(request),
    authBlock(request),
    queryParamsBlock(request),
    bodyBlock(request),
    scriptBlocks(request),
    testsBlock(request),
  ]) {
    if (block) blocks.push(block);
  }
  return blocks.join("\n\n") + "\n";
}

/** Chemin de dossier pour chaque folderId (récursif, parentId → chemin). */
export function folderPaths(folders: CollectionFolder[] | undefined): Map<string, string> {
  const paths = new Map<string, string>();
  for (const folder of folders ?? []) {
    const parent = folder.parentId ? paths.get(folder.parentId) : undefined;
    paths.set(folder.id, parent ? `${parent}/${slugify(folder.name)}` : slugify(folder.name));
  }
  return paths;
}

export function buildBrunoFiles(collection: Collection): ExportFileMap {
  const files: ExportFileMap = new Map();
  files.set(
    "bruno.json",
    `${JSON.stringify(
      {
        version: "1",
        name: collection.name,
        type: "collection",
        ignore: ["node_modules", ".git"],
      },
      null,
      2,
    )}\n`,
  );

  const paths = folderPaths(collection.folders);
  // Les dossiers vides sont matérialisés par un folder.bru minimal.
  const foldersWithRequests = new Set(
    collection.requests.map((r) => r.folderId ?? "").filter(Boolean),
  );
  for (const [id, path] of paths) {
    if (!foldersWithRequests.has(id)) {
      const folder = collection.folders?.find((f) => f.id === id);
      files.set(
        `${path}/folder.bru`,
        ["meta {", `  name: ${folder?.name ?? path}`, "  type: folder", "}"].join("\n") + "\n",
      );
    }
  }

  const usedNames = new Map<string, number>();
  for (const request of collection.requests) {
    const seq = request.order ?? usedNames.size + 1;
    const base = slugify(request.name);
    const count = (usedNames.get(base) ?? 0) + 1;
    usedNames.set(base, count);
    const filename = count > 1 ? `${base}-${count}` : base;
    const dir = request.folderId ? paths.get(request.folderId) : undefined;
    const path = dir ? `${dir}/${filename}.bru` : `${filename}.bru`;
    files.set(path, requestToBru(request, seq));
  }

  return files;
}
