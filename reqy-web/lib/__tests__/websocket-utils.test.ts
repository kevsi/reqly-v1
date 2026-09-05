import { describe, it, expect } from "vitest";
import {
  pushTimelineEntry,
  makeEntryId,
  base64ToHexPreview,
  isValidJson,
  WS_TIMELINE_CAP,
  type WsTimelineEntry,
} from "../websocket-utils";

function entry(overrides: Partial<WsTimelineEntry> = {}): WsTimelineEntry {
  return {
    id: "e1",
    direction: "in",
    kind: "text",
    data: "hello",
    byteLen: 5,
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

describe("pushTimelineEntry", () => {
  it("appends under the cap", () => {
    const result = pushTimelineEntry([entry()], entry({ id: "e2" }));
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("shifts the oldest entry beyond the cap", () => {
    const full = Array.from({ length: WS_TIMELINE_CAP }, (_, i) => entry({ id: `e${i}` }));
    const result = pushTimelineEntry(full, entry({ id: "new" }));
    expect(result).toHaveLength(WS_TIMELINE_CAP);
    expect(result[0].id).toBe("e1");
    expect(result.at(-1)?.id).toBe("new");
  });

  it("does not mutate the input array", () => {
    const original = [entry()];
    pushTimelineEntry(original, entry({ id: "e2" }));
    expect(original).toHaveLength(1);
  });
});

describe("makeEntryId", () => {
  it("is unique and prefixed", () => {
    const a = makeEntryId("ws");
    const b = makeEntryId("ws");
    expect(a).not.toBe(b);
    expect(a.startsWith("ws-")).toBe(true);
  });
});

describe("base64ToHexPreview", () => {
  it("decodes base64 into spaced hex", () => {
    // Buffer.from("AB") → 41 42
    expect(base64ToHexPreview("QUI=")).toBe("41 42");
  });

  it("caps the preview at maxBytes", () => {
    const hex = base64ToHexPreview(
      Buffer.from(Array.from({ length: 100 }, (_, i) => i)).toString("base64"),
      8,
    );
    expect(hex.split(" ")).toHaveLength(8);
    expect(hex.split(" ")[0]).toBe("00");
  });
});

describe("isValidJson", () => {
  it("accepts valid JSON only", () => {
    expect(isValidJson('{"a":1}')).toBe(true);
    expect(isValidJson("[]")).toBe(true);
    expect(isValidJson("not json")).toBe(false);
    expect(isValidJson("")).toBe(false);
    expect(isValidJson("   ")).toBe(false);
  });
});
