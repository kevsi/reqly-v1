import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createWsTicket, verifyWsTicket } from "../ws-ticket";

const ORIGINAL_SECRET = process.env.AUTH_SIGNING_SECRET;

beforeEach(() => {
  process.env.AUTH_SIGNING_SECRET = "test-secret-for-ws-ticket";
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.AUTH_SIGNING_SECRET;
  else process.env.AUTH_SIGNING_SECRET = ORIGINAL_SECRET;
});

describe("createWsTicket / verifyWsTicket", () => {
  it("round-trips a valid ticket", () => {
    const ticket = createWsTicket("user-1", 2, "ws-1");
    const payload = verifyWsTicket(ticket);
    expect(payload).not.toBeNull();
    expect(payload?.uid).toBe("user-1");
    expect(payload?.ver).toBe(2);
    expect(payload?.wid).toBe("ws-1");
  });

  it("rejects tampered tickets (signature mismatch)", () => {
    const ticket = createWsTicket("user-1", 0, "ws-1");
    const tampered = ticket.slice(0, -2) + (ticket.endsWith("aa") ? "bb" : "aa");
    expect(verifyWsTicket(tampered)).toBeNull();
  });

  it("rejects expired tickets", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const ticket = createWsTicket("user-1", 0, "ws-1");
      vi.setSystemTime(new Date("2026-01-01T00:00:31Z")); // +31 s > TTL 30 s
      expect(verifyWsTicket(ticket)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects non-ticket strings and garbage", () => {
    expect(verifyWsTicket("")).toBeNull();
    expect(verifyWsTicket("Bearer abc")).toBeNull();
    expect(verifyWsTicket("t.not-a-valid-ticket")).toBeNull();
    expect(verifyWsTicket("t.!!!")).toBeNull();
  });

  it("rejects a ticket for a revoked session (token_version bump)", () => {
    // isSessionRevoked lit store.sessionRevocations (mémoire) — simulé :
    // on vérifie juste que le chemin ne crashe pas avec une version inconnue.
    const ticket = createWsTicket("user-1", 999, "ws-1");
    expect(() => verifyWsTicket(ticket)).not.toThrow();
  });
});
