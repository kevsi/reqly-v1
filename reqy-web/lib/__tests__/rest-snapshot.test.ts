import { describe, it, expect, beforeEach } from "vitest";
import {
  saveRestSnapshot,
  compareRestSnapshot,
  listRestSnapshots,
  getRestSnapshot,
} from "@/lib/rest-snapshot/store";

describe("rest-snapshot store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("save then compare identical returns []", () => {
    const body = { id: 1, name: "x" };
    saveRestSnapshot("v1", body);
    const changes = compareRestSnapshot("v1", body);
    expect(changes).toEqual([]);
  });

  it("save { id:1, name:'x' } then compare { id:'abc' } detects removed + type-changed", () => {
    saveRestSnapshot("v1", { id: 1, name: "x" });
    const changes = compareRestSnapshot("v1", { id: "abc" });
    expect(changes.some((c) => c.path === "name" && c.kind === "removed")).toBe(true);
    expect(changes.some((c) => c.path === "id" && c.kind === "type-changed")).toBe(true);
  });

  it("listRestSnapshots returns the saved name", () => {
    saveRestSnapshot("prod", { a: 1 });
    expect(listRestSnapshots()).toContain("prod");
  });

  it("getRestSnapshot returns the stored schema", () => {
    saveRestSnapshot("prod", { a: 1 });
    const schema = getRestSnapshot("prod");
    expect(schema?.type).toBe("object");
    expect(schema?.properties?.a?.type).toBe("integer");
  });

  it("compareRestSnapshot on unknown name returns []", () => {
    expect(compareRestSnapshot("ghost", { a: 1 })).toEqual([]);
  });
});
