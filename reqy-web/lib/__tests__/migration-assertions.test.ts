import { describe, it, expect } from "vitest";
import { legacyToRunnerAssertion, migrateItemAssertions } from "../test-runner/migration";

describe("legacyToRunnerAssertion", () => {
  it("converts status assertion", () => {
    const res = legacyToRunnerAssertion({ type: "status", target: "200" });
    expect(res).toEqual({ type: "status", expected: 200 });
  });

  it("converts bodyContains assertion", () => {
    const res = legacyToRunnerAssertion({ type: "bodyContains", target: "success" });
    expect(res).toEqual({ type: "jsonPath", path: "$", operator: "contains", value: "success" });
  });

  it("converts headerExists assertion", () => {
    const res = legacyToRunnerAssertion({ type: "headerExists", target: "content-type" });
    expect(res).toEqual({ type: "header", name: "content-type", operator: "exists" });
  });

  it("converts jsonPath assertion", () => {
    const res = legacyToRunnerAssertion({ type: "jsonPath", target: "$.data.id", expected: "123" });
    expect(res).toEqual({ type: "jsonPath", path: "$.data.id", operator: "equals", value: "123" });
  });

  it("ignores disabled assertions", () => {
    const res = legacyToRunnerAssertion({ type: "status", target: "200", enabled: false });
    expect(res).toBeNull();
  });
});

describe("migrateItemAssertions", () => {
  it("populates runnerAssertions when empty and legacy assertions present", () => {
    const item = {
      assertions: [{ type: "status", target: "201" }],
    };
    const migrated = migrateItemAssertions(item);
    expect(migrated.runnerAssertions).toEqual([{ type: "status", expected: 201 }]);
  });

  it("does not overwrite runnerAssertions if already present", () => {
    const item = {
      assertions: [{ type: "status", target: "201" }],
      runnerAssertions: [{ type: "status", expected: 200 }],
    };
    const migrated = migrateItemAssertions(item);
    expect(migrated.runnerAssertions).toEqual([{ type: "status", expected: 200 }]);
  });
});
