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
      const val = Number(legacy.expected ?? legacy.target ?? 200);
      return { type: "status", expected: isNaN(val) ? 200 : val };
    }
    case "bodyContains": {
      return {
        type: "jsonPath",
        path: "$",
        operator: "contains",
        value: legacy.expected ?? legacy.target ?? "",
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
