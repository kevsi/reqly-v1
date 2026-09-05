/**
 * Export d'une collection Reqly vers le format OpenCollection (YAML).
 *
 * Spécification : https://docs.usebruno.com/opencollection-yaml/overview
 * (spec.opencollection.com) — `opencollection.yml` racine, `folder.yml`
 * par dossier, un `.yml` par requête (sections info/http/runtime).
 *
 * L'émetteur YAML est volontairement minimal (scalars, objets, tableaux,
 * blocs littéraux `|-`) et déterministe — les scalaires sont encodés en
 * style JSON, toujours valide en YAML, pour éviter toute ambiguïté.
 */

import type { Collection, RequestItem } from "@/lib/types";
import type { Assertion } from "@/lib/test-runner/types";
import { assertionsToTestsBlock } from "./assertions-to-tests";
import { folderPaths, slugify, type ExportFileMap } from "./bruno-export";

/** Émet un scalaire sur une ligne (style JSON : valide YAML sans surprise). */
function emitScalar(value: unknown): string {
  return JSON.stringify(value === undefined ? null : value);
}

/** Émet les lignes d'un bloc littéral `|-` (indentées sous l'indicateur). */
function emitBlockLiteral(text: string, pad: string, out: string[]): void {
  out.push(`${pad}|-`);
  for (const line of text.split(/\r?\n/)) {
    out.push(line.length ? `${pad}  ${line}` : "");
  }
}

function emitLines(
  value: unknown,
  indent: number,
  out: string[],
): void {
  const pad = "  ".repeat(indent);
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") {
    out.push(`${pad}${emitScalar(value)}`);
    return;
  }
  if (typeof value === "string") {
    if (value.includes("\n")) {
      emitBlockLiteral(value, pad, out);
      return;
    }
    out.push(`${pad}${emitScalar(value)}`);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isFlatScalar(item)) {
        emitLines(item, indent, out);
        out[out.length - 1] = `${pad}- ${out[out.length - 1].slice(pad.length)}`;
      } else {
        const inner: string[] = [];
        emitLines(item, indent + 1, inner);
        if (inner.length) {
          inner[0] = `${pad}- ${inner[0].slice("  ".repeat(indent + 1).length)}`;
        }
        out.push(...inner);
      }
    }
    return;
  }
  // Objet
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    if (typeof item === "string" && item.includes("\n")) {
      // L'indicateur de bloc fait partie de la ligne de la clé ; le
      // contenu est indenté plus profondément que la clé (validité YAML).
      out.push(`${pad}${key}: |-`);
      for (const line of item.split(/\r?\n/)) {
        out.push(line.length ? `${pad}  ${line}` : "");
      }
    } else if (isFlatScalar(item)) {
      emitLines(item, indent, out);
      out[out.length - 1] = `${pad}${key}: ${out[out.length - 1].slice(pad.length)}`;
    } else {
      out.push(`${pad}${key}:`);
      emitLines(item, indent + 1, out);
    }
  }
}

function isFlatScalar(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== "object") return true;
  return false;
}

export function emitYaml(value: Record<string, unknown>): string {
  const out: string[] = [];
  emitLines(value, 0, out);
  return out.join("\n") + "\n";
}

export function requestToOpenCollection(request: RequestItem, seq: number): string {
  const info: Record<string, unknown> = {
    name: request.name,
    type: "http",
    seq,
  };

  const http: Record<string, unknown> = {
    method: request.method,
    url: request.url,
  };

  const query = (request.queryParams ?? []).filter((p) => p.key.trim());
  if (query.length) {
    http.params = {
      query: query.map((p) => ({ key: p.key, value: p.value })),
    };
  }

  const headers = Object.entries(request.headers ?? {}).filter(([k]) => k.trim());
  if (headers.length) {
    http.headers = headers.map(([key, value]) => ({ key, value: String(value) }));
  }

  if (request.protocol === "graphql" && request.graphql) {
    http.body = {
      type: "graphql",
      query: request.graphql.query,
      ...(request.graphql.variables && request.graphql.variables.trim() !== "{}"
        ? { variables: request.graphql.variables }
        : {}),
    };
  } else if (request.body) {
    http.body = {
      type: request.bodyType ?? "json",
      data: request.body,
    };
  }

  if (request.authType && request.authType !== "none" && request.authToken) {
    if (request.authType === "bearer") {
      http.auth = { bearer: { token: request.authToken } };
    } else if (request.authType === "basic") {
      // Reqsly stocke base64(user:pass) — décodé pour le format standard.
      try {
        const decoded = atob(request.authToken);
        const idx = decoded.indexOf(":");
        http.auth = {
          basic: {
            username: idx === -1 ? decoded : decoded.slice(0, idx),
            password: idx === -1 ? "" : decoded.slice(idx + 1),
          },
        };
      } catch {
        http.auth = { apiKey: { key: request.authToken } };
      }
    }
  }

  const runtime: Record<string, unknown> = {};
  const scripts: Array<Record<string, string>> = [];
  if (request.preRequestScript?.trim()) {
    scripts.push({ type: "pre-request", code: request.preRequestScript });
  }
  if (request.postResponseScript?.trim()) {
    scripts.push({ type: "post-response", code: request.postResponseScript });
  }
  const tests = assertionsToTestsBlock(request.runnerAssertions as Assertion[] | undefined);
  if (tests) {
    scripts.push({ type: "tests", code: tests });
  }
  if (scripts.length) runtime.scripts = scripts;

  const doc: Record<string, unknown> = {
    info,
    http,
    ...(Object.keys(runtime).length ? { runtime } : {}),
  };
  return emitYaml(doc);
}

export function buildOpenCollectionFiles(collection: Collection): ExportFileMap {
  const files: ExportFileMap = new Map();

  files.set(
    "opencollection.yml",
    emitYaml({
      info: {
        name: collection.name,
        type: "collection",
        ...(collection.description ? { description: collection.description } : {}),
      },
    }),
  );

  const paths = folderPaths(collection.folders);
  const foldersWithRequests = new Set(
    collection.requests.map((r) => r.folderId ?? "").filter(Boolean),
  );
  for (const [id, path] of paths) {
    if (!foldersWithRequests.has(id)) {
      const folder = collection.folders?.find((f) => f.id === id);
      files.set(
        `${path}/folder.yml`,
        emitYaml({ info: { name: folder?.name ?? path, type: "folder" } }),
      );
    }
  }

  const usedNames = new Map<string, number>();
  collection.requests.forEach((request) => {
    const base = slugify(request.name);
    const count = (usedNames.get(base) ?? 0) + 1;
    usedNames.set(base, count);
    const filename = count > 1 ? `${base}-${count}` : base;
    const dir = request.folderId ? paths.get(request.folderId) : undefined;
    const path = dir ? `${dir}/${filename}.yml` : `${filename}.yml`;
    const seq = request.order ?? count;
    files.set(path, requestToOpenCollection(request, seq));
  });

  return files;
}
