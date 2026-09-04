import { describe, it, expect } from "vitest";
import { runTransform } from "../scripts.js";

// Audit P0 2026-09-04 : le sandbox vm était contournable via
// this.constructor.constructor (proto chain du sandbox traversant le
// contexte). Correctif : process jetable sous --permission (fs/cp refusés),
// getBuiltinModule neutralisé, env vidé, constructeurs realm-locaux bloqués
// par codeGeneration:false. Ces PoC rejouent l'évasion : le runner doit soit
// REJETER (erreur), soit renvoyer un résultat sans donnée hôte.
describe("mock transform escape PoCs (audit P0) — must all be blocked", () => {
  const noopInput = {
    request: { method: "GET", path: "/", query: {}, headers: {} },
    body: null,
    state: null,
  };

  it("blocks: this.constructor.constructor → process.env", async () => {
    const result = await runTransform(
      'return this.constructor.constructor("return process.env.USERNAME")()',
      noopInput,
    );
    expect(JSON.stringify(result ?? "")).not.toMatch(/[a-zA-Z]{4,}/);
  });

  it("rejects: this.constructor.constructor → fs read", async () => {
    await expect(
      runTransform(
        "return this.constructor.constructor(\"return process.getBuiltinModule('fs').readFileSync('package.json','utf8').slice(0,20)\")()",
        noopInput,
      ),
    ).rejects.toThrow();
  });

  it("rejects: this.constructor.constructor → child_process spawn", async () => {
    await expect(
      runTransform(
        "return this.constructor.constructor(\"const cp = process.getBuiltinModule('child_process'); return cp.spawnSync('echo',['PWNED']).stdout.toString()\")()",
        noopInput,
      ),
    ).rejects.toThrow();
  });

  it("rejects: JSON.constructor.constructor → process.env (host JSON removed)", async () => {
    await expect(
      runTransform(
        'return JSON.constructor.constructor("return process.env.USERNAME")()',
        noopInput,
      ),
    ).rejects.toThrow();
  });

  it("rejects: JSON.constructor.constructor → fs read (realm Function, codeGen off)", async () => {
    await expect(
      runTransform(
        "return JSON.constructor.constructor(\"return process.getBuiltinModule('fs')\")()",
        noopInput,
      ),
    ).rejects.toThrow(/Code generation|not a function/);
  });

  it("legit transforms still work (body echo, Math, JSON)", async () => {
    // Contrat historique : `return` explicite dans le transform.
    const echoed = await runTransform(
      "return { echoed: body.echo, doubled: body.amount * 2 };",
      {
        request: { method: "POST", path: "/pay", query: {}, headers: {} },
        body: { amount: 10, echo: "ping" },
        state: null,
      },
    );
    expect(echoed).toEqual({ echoed: "ping", doubled: 20 });

    const computed = await runTransform(
      "return JSON.stringify({ v: Math.max(1, 5, 3), ok: true });",
      noopInput,
    );
    expect(computed).toBe(JSON.stringify({ v: 5, ok: true }));
  });
});
