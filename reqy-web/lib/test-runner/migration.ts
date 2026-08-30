import type { Assertion } from "./types";

export interface LegacyRequestTestAssertion {
  id?: string;
  type: "status" | "bodyContains" | "headerExists" | "jsonPath" | string;
  target?: string;
  expected?: string;
  enabled?: boolean;
}

export function legacyToRunnerAssertion(legacy: LegacyRequestTestAssertion): Assertion | null {
  if (legacy.enabled === false) return null;
  switch (legacy.type) {
    case "status": {
      // TestAssertionPanel crée {target:"200", expected:""} → expected vide ne doit pas donner 0
      const raw = (legacy.expected?.trim() ? legacy.expected : legacy.target)?.trim() ?? "200";
      // Supporte "200" ou expressions type ">=200" (on extrait le premier nombre)
      const num = Number(raw);
      const fallback = Number.parseInt(raw.match(/\d+/)?.[0] ?? "200", 10);
      const val = Number.isFinite(num) && raw.trim() !== "" ? num : fallback;
      return { type: "status", expected: Number.isFinite(val) ? val : 200 };
    }
    case "bodyContains": {
      const val = (legacy.expected?.trim() ? legacy.expected : legacy.target) ?? "";
      return {
        type: "jsonPath",
        path: "$",
        operator: "contains",
        value: val,
      };
    }
    case "headerExists": {
      return {
        type: "header",
        name: legacy.target ?? legacy.expected ?? "",
        operator: "exists",
      };
    }
    case "jsonPath": {
      return {
        type: "jsonPath",
        path: legacy.target ?? "$",
        operator: "equals",
        value: legacy.expected ?? "",
      };
    }
    default:
      return null;
  }
}

export function migrateItemAssertions<
  T extends { assertions?: LegacyRequestTestAssertion[]; runnerAssertions?: Assertion[] },
>(item: T): T {
  if (
    (!item.runnerAssertions || item.runnerAssertions.length === 0) &&
    item.assertions &&
    item.assertions.length > 0
  ) {
    const converted = item.assertions
      .map(legacyToRunnerAssertion)
      .filter((a): a is Assertion => a !== null);

    return {
      ...item,
      runnerAssertions: converted,
    };
  }
  return item;
}
