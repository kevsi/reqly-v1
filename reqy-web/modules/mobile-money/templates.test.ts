import { it, expect, vi, afterEach } from "vitest";
import {
  buildCallbackPayload,
  sendCallbackPayload,
  type MomoProvider,
} from "@/modules/mobile-money/templates";

const PROVIDERS: MomoProvider[] = [
  "mtn-momo-collections",
  "mtn-momo-disbursement",
  "fedapay",
  "kkiapay",
];

/** Status lives at different paths per provider shape — read it defensively. */
function statusOf(p: any): unknown {
  return p.status ?? p.data?.status ?? p.transaction_status;
}

it("MTN MoMo Collections success matches documented shape", () => {
  const p = buildCallbackPayload("mtn-momo-collections", "success") as any;
  expect(p).toMatchObject({ status: "SUCCESSFUL", amount: expect.any(String) });
});

it("each provider returns a distinct, non-empty object", () => {
  const shapes = PROVIDERS.map((provider) =>
    JSON.stringify(buildCallbackPayload(provider, "success")),
  );
  expect(new Set(shapes).size).toBe(PROVIDERS.length);
  for (const s of shapes) expect(s.length).toBeGreaterThan(0);
});

it("failure differs from success (status indicates failure)", () => {
  for (const provider of PROVIDERS) {
    const ok = buildCallbackPayload(provider, "success") as any;
    const ko = buildCallbackPayload(provider, "failure") as any;
    expect(statusOf(ko)).not.toBe(statusOf(ok));
  }
});

it("timeout indicates a pending/timeout state distinct from success and failure", () => {
  for (const provider of PROVIDERS) {
    const ok = buildCallbackPayload(provider, "success") as any;
    const ko = buildCallbackPayload(provider, "failure") as any;
    const to = buildCallbackPayload(provider, "timeout") as any;
    expect(statusOf(to)).not.toBe(statusOf(ok));
    expect(statusOf(to)).not.toBe(statusOf(ko));
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

it("sendCallbackPayload POSTs JSON and returns the status", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ status: 201 } as Response);
  vi.stubGlobal("fetch", fetchMock);
  const payload = { status: "SUCCESSFUL", amount: "1000" };
  const res = await sendCallbackPayload("https://example.com/hook", payload);
  expect(res.status).toBe(201);
  expect(fetchMock).toHaveBeenCalledWith(
    "https://example.com/hook",
    expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
});
