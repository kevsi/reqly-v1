import { parseSpec } from "./contract.js";

export interface SpecDiff {
  added: Array<{ path: string; method: string }>;
  removed: Array<{ path: string; method: string }>;
  changed: Array<{ path: string; method: string; changes: string[] }>;
}

function listEndpoints(spec: string): Array<{ path: string; method: string }> {
  const doc = parseSpec(spec);
  if (!doc.paths) return [];
  const out: Array<{ path: string; method: string }> = [];
  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const method of Object.keys(methods)) {
      if (["get", "post", "put", "patch", "delete"].includes(method)) {
        out.push({ path, method: method.toLowerCase() });
      }
    }
  }
  return out;
}

function endpointKey(e: { path: string; method: string }): string {
  return `${e.method.toUpperCase()} ${e.path}`;
}

export function diffSpecs(specA: string, specB: string): SpecDiff {
  const a = listEndpoints(specA);
  const b = listEndpoints(specB);
  const aKeys = new Set(a.map(endpointKey));
  const bKeys = new Set(b.map(endpointKey));

  const added = b.filter((e) => !aKeys.has(endpointKey(e)));
  const removed = a.filter((e) => !bKeys.has(endpointKey(e)));
  const common = a.filter((e) => bKeys.has(endpointKey(e)));

  const changed: SpecDiff["changed"] = [];
  for (const e of common) {
    const docA = parseSpec(specA);
    const docB = parseSpec(specB);
    const opA = docA.paths?.[e.path]?.[e.method];
    const opB = docB.paths?.[e.path]?.[e.method];
    const changes: string[] = [];

    if ((opA?.summary ?? "") !== (opB?.summary ?? "")) changes.push("summary changed");
    if ((opA?.operationId ?? "") !== (opB?.operationId ?? "")) changes.push("operationId changed");

    const aParams = JSON.stringify(
      opA?.parameters?.map((p) => ({ name: p.name, in: p.in, required: p.required })),
    );
    const bParams = JSON.stringify(
      opB?.parameters?.map((p) => ({ name: p.name, in: p.in, required: p.required })),
    );
    if (aParams !== bParams) changes.push("parameters changed");

    const aHasBody = !!opA?.requestBody;
    const bHasBody = !!opB?.requestBody;
    if (aHasBody !== bHasBody) changes.push("request body added/removed");

    const aSchemas = JSON.stringify(opA?.responses);
    const bSchemas = JSON.stringify(opB?.responses);
    if (aSchemas !== bSchemas) changes.push("response schemas changed");

    if (changes.length > 0) {
      changed.push({ path: e.path, method: e.method, changes });
    }
  }

  return { added, removed, changed };
}
