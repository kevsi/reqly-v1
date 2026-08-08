import { it, expect } from "vitest";
import { hashRunReport, verifyRunReport } from "@/lib/run-report/hash";

it("is deterministic and changes when the report is tampered", () => {
  const report = { id: "r1", results: [{ name: "a", status: "pass" }] } as unknown;
  const h = hashRunReport(report);
  expect(h).toMatch(/^[0-9a-f]{64}$/);
  expect(verifyRunReport(report, h)).toBe(true);
  const tampered = { ...report, results: [{ name: "a", status: "fail" }] } as unknown;
  expect(verifyRunReport(tampered, h)).toBe(false);
});
