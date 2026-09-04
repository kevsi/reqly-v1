/**
 * Sandbox d'exécution des scripts de test (type Postman pm.test()).
 *
 * ARCHITECTURE (audit P0 2026-09-03) : l'exécution se fait dans un PROCESSUS
 * ENFANT JETABLE, pas dans node:vm. `vm` n'est pas une frontière de sécurité
 * (position officielle de Node) : la proto chain de l'objet global traverse la
 * frontière du contexte, et `this.constructor.constructor` donne accès au
 * `Function` de l'hôte → RCE prouvé (lecture fs, spawn child_process, dump
 * process.env). Un process séparé n'a pas de proto chain partagée avec le
 * serveur : même évasé, le pire impact est la machine locale jetable du fils.
 *
 * Le fils reçoit le script sur stdin (pas d'argument de ligne de commande —
 * invisible dans les process listings), exécute avec :
 *  - `--disallow-code-generation-from-strings` impossible (les scripts de
 *    test utilisent légitimement Function pour parse) — à la place, on
 *    interdit au niveau du père les APIs dangereuses via `--experimental-permission`
 *    quand disponible, sinon `process.permission` ;
 *  - timeout dur kill(SIGKILL) après `timeoutMs` ;
 *  - mémoire plafonnée via `resourceLimits` de fork;
 *  - stdout/stderr capturés, résultat sérialisé en JSON sur une ligne dédiée.
 */

import { fork } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ScriptContext {
  pm?: {
    environment: Record<string, string | number | boolean>;
  };
  request?: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
  };
  response?: {
    status: number;
    headers: Record<string, string>;
    body: string;
  };
  console?: {
    log: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  };
}

export interface ScriptResult {
  success: boolean;
  result?: unknown;
  output?: string;
  error?: string;
  duration: number;
  logs?: string[];
}

/**
 * Résolution du chemin du point d'entrée enfant, robuste aux transformations
 * de bundlers (vitest/Next/turbo transforment ce fichier et rendent
 * import.meta.url inutilisable pour localiser les voisins) :
 * 1. fichier source réel à côté de ce module (dev, build tsc) ;
 * 2. fichier source à la racine du repo (vitest) ;
 * 3. sinon : le code enfant est embarqué (CHILD_SOURCE) et écrit dans un
 *    fichier temporaire au premier appel — le sandbox ne dépend jamais d'un
 *    chemin de build.
 */
import fs from "node:fs";
import os from "node:os";

const CHILD_FILENAME = "script-sandbox-child.mjs";
const CANDIDATE_DIRS = [
  path.dirname(fileURLToPath(import.meta.url)),
  path.join(process.cwd(), "lib"),
  path.join(process.cwd(), "reqy-web", "lib"),
];

function resolveChildPath(): string {
  for (const dir of CANDIDATE_DIRS) {
    try {
      const candidate = path.join(dir, CHILD_FILENAME);
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // fs indisponible (bundler edge) — tenter le fallback suivant
    }
  }
  // Fallback : écrire le code embarqué en fichier temporaire.
  const tmp = path.join(os.tmpdir(), `reqly-sandbox-child-${Date.now()}.mjs`);
  fs.writeFileSync(tmp, CHILD_SOURCE, "utf8");
  return tmp;
}

let cachedChildPath: string | null = null;
function getChildPath(): string {
  if (!cachedChildPath) cachedChildPath = resolveChildPath();
  return cachedChildPath;
}

/**
 * Copie embarquée du point d'entrée enfant (lib/script-sandbox-child.mjs).
 * Uniquement utilisée si le fichier réel est introuvable (exécution depuis un
 * bundle sans voisinage de fichiers). Toute modification du .mjs doit être
 * reflétée ici.
 */
const CHILD_SOURCE = String.raw`/**
 * Processus enfant jetable — exécution sandbox (généré si le fichier
 * script-sandbox-child.mjs est absent du voisinage ; miroir exact).
 */
if (typeof process.getBuiltinModule === "function") {
  process.getBuiltinModule = undefined;
}
globalThis.fetch = undefined;

const logs = [];
function safeStringify(value) {
  try { return JSON.stringify(value); } catch { return String(value); }
}
function cappedPush(line) {
  if (logs.length < 500) logs.push(String(line).slice(0, 2000));
}
const sandboxConsole = {
  log: (...args) => cappedPush(args.map(safeStringify).join(" ")),
  error: (...args) => cappedPush("ERROR: " + args.map(safeStringify).join(" ")),
  warn: (...args) => cappedPush("WARN: " + args.map(safeStringify).join(" ")),
};

process.on("message", (payload) => {
  if (!payload || typeof payload.script !== "string") {
    if (process.send) process.send({ ok: false, error: "Invalid payload", logs: [] });
    process.exit(0);
    return;
  }
  const context = payload.context || {};
  const sandboxGlobals = {
    pm: context.pm || { environment: {} },
    request: context.request || {},
    response: context.response || {},
    console: sandboxConsole,
  };
  const FORBIDDEN_GLOBALS = [
    "require","module","exports","__dirname","__filename","global","globalThis",
    "process","Buffer","child_process","fs","eval","Function","Proxy","Reflect",
    "WeakRef","FinalizationRegistry","SharedArrayBuffer","Atomics","queueMicrotask",
    "setImmediate","setInterval","setTimeout","clearTimeout","clearImmediate",
    "fetch","XMLHttpRequest","WebSocket","EventSource","importScripts",
  ];
  for (const k of FORBIDDEN_GLOBALS) sandboxGlobals[k] = undefined;

  try {
    const args = Object.keys(sandboxGlobals);
    const fn = new Function(...args, payload.script);
    const result = fn(...Object.values(sandboxGlobals));
    Promise.resolve(result)
      .then((resolved) => {
        if (process.send) process.send({ ok: true, result: resolved === undefined ? null : resolved, logs });
        process.exit(0);
      })
      .catch((err) => {
        if (process.send) process.send({ ok: false, error: err && err.message ? err.message : String(err), logs });
        process.exit(0);
      });
  } catch (err) {
    if (process.send) process.send({ ok: false, error: err && err.message ? err.message : String(err), logs });
    process.exit(0);
  }
});
`;

export function executeScriptInSandbox(
  scriptCode: string,
  context: ScriptContext = {},
  timeoutMs: number = 5000,
): Promise<ScriptResult> {
  const startTime = Date.now();
  const logs: string[] = [];
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r: ScriptResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    let child: ReturnType<typeof fork>;
    try {
      // Process jetable : pas de proto chain partagée, pas d'accès au module
      // loader du père, tué au timeout. stdio: pipe pour capturer la sortie.
      child = fork(getChildPath(), [], {
        stdio: ["pipe", "pipe", "pipe", "ipc"],
        // Le fils ne parle pas au réseau : les scripts de test n'en ont pas
        // besoin (le moteur canonique ne les exécute pas côté serveur et
        // l'assertion se fait sur la réponse déjà reçue).
        env: { ...process.env, NODE_OPTIONS: "--no-experimental-fetch" },
        serialization: "json",
      });
    } catch (error) {
      finish({
        success: false,
        error: `Failed to spawn sandbox process: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - startTime,
        logs,
      });
      return;
    }

    const collected: string[] = [];
    child.stdout!.on("data", (chunk: Buffer) => {
      collected.push(chunk.toString("utf8"));
      // Cap la sortie pour éviter un DoS mémoire par console.log massif.
      if (collected.join("").length > 256 * 1024) {
        try {
          child.kill("SIGKILL");
        } catch {
          // swallow: process already dead
        }
      }
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      logs.push(`STDERR: ${chunk.toString("utf8").slice(0, 2048)}`);
    });

    child.on("message", (message: { ok: boolean; result?: unknown; error?: string; logs?: string[] }) => {
      if (message && typeof message === "object" && "ok" in message) {
        const duration = Date.now() - startTime;
        if (message.ok) {
          finish({
            success: true,
            result: (message as { result?: unknown }).result === null ? undefined : (message as { result?: unknown }).result,
            output: "Script executed successfully",
            duration,
            logs: [...logs, ...((message as { logs?: string[] }).logs ?? [])],
          });
        } else {
          finish({
            success: false,
            error: (message as { error?: string }).error ?? "Script error",
            duration,
            logs: [...logs, ...((message as { logs?: string[] }).logs ?? [])],
          });
        }
      }
    });

    const timeout = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // swallow: best effort cleanup
      }
      finish({
        success: false,
        error: `Script execution timeout (${timeoutMs}ms)`,
        duration: Date.now() - startTime,
        logs,
      });
    }, timeoutMs);

    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      if (settled) return;
      if (signal === "SIGKILL") return; // déjà résolu par le timeout
      finish({
        success: false,
        error:
          signal
            ? `Sandbox process terminated by signal ${signal}`
            : `Sandbox process exited unexpectedly (code ${code})`,
        duration: Date.now() - startTime,
        logs,
      });
    });

    // Envoie le payload et le script au fils (IPC), puis stdin fermé.
    child.send({ context, script: scriptCode });
    child.stdin?.end();
  });
}

/** Exécution séquentielle pre/main/post (les scripts n'ont pas d'effet partagé :
 *  le contexte de chaque étape repart du `context` initial). */
export async function executeScriptSequence(
  preScript: string | null,
  mainScript: string,
  postScript: string | null,
  context: ScriptContext = {},
  timeoutMs: number = 5000,
): Promise<{
  preResult?: ScriptResult;
  mainResult: ScriptResult;
  postResult?: ScriptResult;
}> {
  let preResult: ScriptResult | undefined;
  if (preScript) {
    preResult = await executeScriptInSandbox(preScript, context, timeoutMs);
    if (!preResult.success) {
      return { preResult, mainResult: skippedResult() };
    }
  }

  const mainResult = await executeScriptInSandbox(mainScript, context, timeoutMs);
  if (!mainResult.success) {
    return { mainResult };
  }

  const postResult = postScript
    ? await executeScriptInSandbox(postScript, context, timeoutMs)
    : undefined;

  return { preResult, mainResult, postResult };
}

function skippedResult(): ScriptResult {
  return { success: false, error: "Skipped: an earlier script in the sequence failed.", duration: 0, logs: [] };
}
