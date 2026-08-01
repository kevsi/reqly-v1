import { describe, it, expect } from "vitest";
import { formatDataSize } from "@/lib/network/format";

describe("formatDataSize", () => {
  it("formats 0 bytes", () => {
    expect(formatDataSize(0)).toBe("0 B");
  });

  it("formats 1500 bytes as Ko (French decimal separator)", () => {
    expect(formatDataSize(1500)).toBe("1.46 Ko");
  });

  it("formats 1_500_000 bytes as Mo", () => {
    expect(formatDataSize(1_500_000)).toBe("1.43 Mo");
  });

  // Extra cases — exercise every branch so the coverage gate stays green.
  it("formats sub-Ko sizes as bytes", () => {
    expect(formatDataSize(500)).toBe("500 B");
  });

  it("formats the Ko boundary", () => {
    expect(formatDataSize(1024)).toBe("1.00 Ko");
  });

  it("formats Go for very large payloads", () => {
    expect(formatDataSize(2 * 1024 * 1024 * 1024)).toBe("2.00 Go");
  });
});
