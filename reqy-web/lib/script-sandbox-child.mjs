/**
 * Processus enfant jetable — point d'entrée de l'exécution sandbox
 * (lib/script-sandbox.ts). Ce process est tué après chaque exécution.
 *
 * Politique d'exécution :
 *  - le code utilisateur tourne DANS CE PROCESS, séparé du serveur : aucune
 *    proto chain, aucun module loader partagé. Même une évasion totale ne
 *    touche qu'un process jetable sans données du serveur (les seules données
 *    transmises sont `context` — request/response déjà reçues) ;
 *  - `process.getBuiltinModule` est neutralisé : c'est le vecteur post-évasion
 *    vers fs/child_process/http prouvé par l'audit P0 ;
 *  - fetch retiré du fils (les scripts de test n'en ont pas besoin) ;
 *  - résultat sérialisé en JSON via IPC, logs renvoyés au père.
 */

// ── Neutralisation du vecteur d'évasion prouvé (avant tout code user) ──
if (typeof process.getBuiltinModule === "function") {
  process.getBuiltinModule = undefined;
}
globalThis.fetch = undefined;

// node:vm est importé AVANT la neutralisation (les imports statiques sont
// hoistés de toute façon) : il sert à l'évaluation dans CE process jetable
// (sémantique "dernière expression" du contrat historique). La frontière de
// sécurité reste le process lui-même, tué par le père au timeout.
import vm from "node:vm";

// Safe console : capturé et renvoyé via IPC au lieu d'un flux non borné.
const logs = [];
function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
    // Intrinsèques pour les scripts d'assertion légitimes (Math.max,
    // JSON.stringify…). Leur provenance hôte est SANS DANGER ici : la
    // frontière est le process jetable, l'IPC ne transporte que le résultat
    // sérialisé — un objet hôte leaké ne traverse pas le canal.
    Math, JSON, Date, RegExp, Error, TypeError, RangeError, SyntaxError,
    Promise, Set, Map, WeakMap, Symbol, isNaN, isFinite, parseInt, parseFloat,
    encodeURIComponent, decodeURIComponent, encodeURI, decodeURI,
  };
  // Même politique FORBIDDEN_GLOBALS que l'ancien sandbox vm : chaque global
  // masqué est passé en paramètre du wrapper, shadowing la vraie binding du
  // process jetable. (globalThis.constructor.constructor reste utilisable DANS
  // ce process — mais c'est un process jetable sans secrets : c'est la
  // frontière. Les tests rejouent les PoC pour garantir l'absence de leak.)
  const FORBIDDEN_GLOBALS = [
    "require",
    "module",
    "exports",
    "__dirname",
    "__filename",
    "global",
    "globalThis",
    "process",
    "Buffer",
    "child_process",
    "fs",
    "eval",
    "Function",
    "Proxy",
    "Reflect",
    "WeakRef",
    "FinalizationRegistry",
    "SharedArrayBuffer",
    "Atomics",
    "queueMicrotask",
    "setImmediate",
    "setInterval",
    "setTimeout",
    "clearTimeout",
    "clearImmediate",
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "importScripts",
  ];
  for (const k of FORBIDDEN_GLOBALS) {
    sandboxGlobals[k] = undefined;
  }

  try {
    // Évaluation sémantique fidèle à l'ancien contrat : `vm.runInContext`
    // retourne la VALEUR DE LA DERNIÈRE EXPRESSION (les scripts de test font
    // `typeof process;` sans return). node:vm est utilisé ICI, dans le
    // process jetable : même une évasion totale (constructor.constructor, que
    // les tests d'évasion rejouent) ne touche qu'un process sans secrets,
    // tué au timeout par le père — c'est la frontière documentée de l'audit.
    // Le wrapper sloppy shadow les FORBIDDEN via paramètres ("use strict"
    // retiré : shadowing de `eval` impossible en strict, mot réservé).
    
    const keys = Object.keys(sandboxGlobals);
    const contextified = vm.createContext({ ...sandboxGlobals }, {
      codeGeneration: { strings: false, wasm: false },
    });
    const fn = new Function(...keys, "vm", "contextified", `return vm.runInContext(${JSON.stringify(payload.script)}, contextified)`);
    const result = fn(...Object.values(sandboxGlobals), vm, contextified);
    // Support des scripts async (promesses retournées).
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
