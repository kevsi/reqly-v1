/**
 * Processus enfant jetable — exécution des transforms de mocks.
 * (pattern validé dans reqy-web/lib/script-sandbox.ts, audit P0 2026-09-03)
 *
 * Sécurité, deux couches :
 *  1. Le process tourne sous `--permission` (imposé par le père dans
 *     execArgv) : fs/worker_threads refusés, seul child_process est permis
 *     pour le canal IPC. Un échappement vm ne donne ni fs ni réseau ni spawn.
 *  2. `process.getBuiltinModule` neutralisé + `process.env` vidé avant tout
 *     code utilisateur (un échappement vm ne lit rien de l'environnement).
 *  3. node:vm avec `codeGeneration:false` et sandbox sans intrinsèque hôte :
 *     les constructeurs accessibles depuis le code sont realm-locaux et leur
 *     Function est bloquée par codeGeneration.
 */

import vm from "node:vm";

if (typeof process.getBuiltinModule === "function") {
  process.getBuiltinModule = undefined;
}
process.env = {};

process.on("message", (payload) => {
  if (!payload || typeof payload.code !== "string") {
    process.send({ ok: false, error: "Invalid payload" }, () => process.exit(0));
    return;
  }

  const sandbox = {
    request: payload.request || {},
    body: payload.body ?? null,
    state: payload.state ?? null,
    console: {
      log: () => {},
      warn: () => {},
      error: () => {},
    },
  };
  // Shadowing des globals dangereux via paramètres du wrapper (sloppy mode :
  // shadowing de `Function` impossible en strict). La frontière reste le
  // process jetable sous --permission.
  const shadow = ["require", "process", "global", "globalThis", "Function", "fetch"];
  const keys = [...Object.keys(sandbox), ...shadow];
  const globals = { ...sandbox };
  for (const k of shadow) globals[k] = undefined;

  // Wrapper IIFE : permet le `return` top-level dans les transforms
  // (contrat historique du moteur, cf. tests server).
  const wrapped = "(function(){\n" + payload.code + "\n})()";

  try {
    const contextified = vm.createContext(sandbox, {
      codeGeneration: { strings: false, wasm: false },
    });
    const fn = new Function(...keys, "vm", "contextified", "wrapped",
      "return vm.runInContext(wrapped, contextified)");
    const result = fn(...Object.values(globals), vm, contextified, wrapped);
    process.send({ ok: true, result: result === undefined ? null : result }, () => process.exit(0));
  } catch (err) {
    process.send({
      ok: false,
      error: err && err.message ? err.message : String(err),
    }, () => process.exit(0));
  }
});
