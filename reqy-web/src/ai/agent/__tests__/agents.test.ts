import { describe, it, expect } from "vitest";
import { REQLY_AGENTS, getSpecialist, SPECIALIST_IDS } from "../agents";
import { isSideEffectTool, isHighImpactTool } from "@/src/ai/agent/permissions";
import {
  assertDelegationAllowed,
  assertSpawnAllowed,
  MAX_DELEGATE_DEPTH,
} from "../subagent";

describe("Garde anti-récursion de délégation", () => {
  it("l'agent principal (depth 0) peut créer un sous-agent (spawn depth 1)", () => {
    expect(() => assertDelegationAllowed(0)).not.toThrow();
    expect(() => assertSpawnAllowed(1)).not.toThrow();
  });

  it("un sous-agent (depth 1) NE PEUT PAS re-déléguer", () => {
    expect(() => assertDelegationAllowed(1)).toThrow(/maximale/i);
    expect(() => assertSpawnAllowed(MAX_DELEGATE_DEPTH + 1)).toThrow(/dépassée/i);
  });
});

describe("Registre d'agents spécialisés", () => {
  it("contient des agents complets et uniques", () => {
    const ids = REQLY_AGENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of REQLY_AGENTS) {
      expect(a.name.length).toBeGreaterThan(0);
      expect(a.system.length).toBeGreaterThan(50);
      expect(typeof a.readOnly).toBe("boolean");
      expect(SPECIALIST_IDS).toContain(a.id);
    }
  });

  it("getSpecialist résout les ids connus et rejette les inconnus", () => {
    expect(getSpecialist("analyste")?.name).toBe("Analyste API");
    expect(getSpecialist("inconnu")).toBeUndefined();
  });

  it("delegate_team est classé side-effect ET high-impact (confirmation obligatoire)", () => {
    expect(isSideEffectTool("delegate_team")).toBe(true);
    expect(isHighImpactTool("delegate_team")).toBe(true);
  });
});
