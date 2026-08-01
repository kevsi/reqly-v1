import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * TDD — red phase first.
 *
 * `detectTunnelCli` lives in `@/lib/tunnel/detect` and uses `node:child_process`
 * ONLY on a desktop/Node runtime. In a browser/WebView there is no `child_process`
 * module, so the dynamic import must fail gracefully (return `null`, never throw).
 *
 * We mock `node:child_process` per-test via `vi.doMock` so we can simulate each
 * detection outcome without spawning real processes or depending on the host.
 */
describe("detectTunnelCli (free-tunnel CLI detection)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns 'cloudflared' when cloudflared is installed", async () => {
    vi.doMock("node:child_process", () => ({
      execFile: (_cmd: string, args: string[], cb: (err: Error | null) => void) => {
        // `where` (win32) or `which` (unix) — assert on the binary name only.
        const found = args[0] === "cloudflared";
        cb(found ? null : new Error("not found"));
      },
    }));
    const { detectTunnelCli } = await import("@/lib/tunnel/detect");
    await expect(detectTunnelCli()).resolves.toBe("cloudflared");
  });

  it("returns 'ngrok' when only ngrok is installed", async () => {
    vi.doMock("node:child_process", () => ({
      execFile: (_cmd: string, args: string[], cb: (err: Error | null) => void) => {
        const found = args[0] === "ngrok";
        cb(found ? null : new Error("not found"));
      },
    }));
    const { detectTunnelCli } = await import("@/lib/tunnel/detect");
    await expect(detectTunnelCli()).resolves.toBe("ngrok");
  });

  it("returns null when neither CLI is installed", async () => {
    vi.doMock("node:child_process", () => ({
      execFile: (_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
        cb(new Error("not found"));
      },
    }));
    const { detectTunnelCli } = await import("@/lib/tunnel/detect");
    await expect(detectTunnelCli()).resolves.toBeNull();
  });

  it("resolves null (no throw) when child_process cannot be required", async () => {
    // Browser/WebView: the module simply does not exist.
    vi.doMock("node:child_process", () => {
      throw new Error("Cannot find module 'node:child_process'");
    });
    const { detectTunnelCli } = await import("@/lib/tunnel/detect");
    await expect(detectTunnelCli()).resolves.toBeNull();
  });
});
