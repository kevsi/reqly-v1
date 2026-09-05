import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  getPublicEnv: () => ({ NEXT_PUBLIC_SYNC_URL: "https://sync.example.com" }),
}));

import {
  pushMonitorToServer,
  deleteMonitorFromServer,
  fetchServerRuns,
  isServerMonitorSyncAvailable,
  type ServerMonitorRun,
} from "../server-sync";
import type { Monitor } from "../types";

function monitor(overrides: Partial<Monitor> = {}): Monitor {
  return {
    id: "local-1",
    name: "API uptime",
    enabled: true,
    intervalSec: 300,
    checks: { expectedStatus: 200 },
    requests: [
      { id: "r1", name: "Health", method: "GET", url: "https://example.com/health" },
    ],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("server monitor sync", () => {
  it("reports availability based on the sync URL", () => {
    expect(isServerMonitorSyncAvailable()).toBe(true);
  });

  it("creates a server monitor on first push", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { monitor: { id: "mon-1", name: "API uptime", enabled: true, intervalSec: 300, lastStatus: null, nextRunAt: 2 } },
        { status: 201 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const info = await pushMonitorToServer(monitor(), "tok");
    expect(info.id).toBe("mon-1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://sync.example.com/api/monitors/");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    const body = JSON.parse(init.body as string);
    expect(body.requests).toHaveLength(1);
    expect(body.checks.expectedStatus).toBe(200);
  });

  it("updates via PATCH when a serverId exists", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        monitor: { id: "mon-1", name: "Renamed", enabled: false, intervalSec: 60, lastStatus: "pass", nextRunAt: 3 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const info = await pushMonitorToServer(monitor({ serverId: "mon-1", name: "Renamed" }), "tok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://sync.example.com/api/monitors/mon-1");
    expect(init.method).toBe("PATCH");
    expect(info.name).toBe("Renamed");
    expect(info.intervalSec).toBe(60);
  });

  it("falls back to creation when the server copy disappeared", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/mon-1")) {
        return new Response(null, { status: 404 });
      }
      return Response.json(
        { monitor: { id: "mon-9", name: "API uptime", enabled: true, intervalSec: 300, lastStatus: null, nextRunAt: 5 } },
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const info = await pushMonitorToServer(monitor({ serverId: "mon-1" }), "tok");
    expect(info.id).toBe("mon-9");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("deletes and tolerates 404", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(deleteMonitorFromServer("mon-1", "tok")).resolves.toBeUndefined();
  });

  it("parses server runs", async () => {
    const runs: ServerMonitorRun[] = [
      {
        id: 1,
        status: "pass",
        durationMs: 100,
        at: 1_700_000_000_000,
        checks: [{ requestId: "r1", name: "Health", ok: true, statusCode: 200, durationMs: 100 }],
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ runs })),
    );
    const result = await fetchServerRuns("mon-1", "tok");
    expect(result).toHaveLength(1);
    expect(result[0].checks[0].statusCode).toBe(200);
  });

  it("surfaces server errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "Monitor not found" }, { status: 404 })),
    );
    await expect(fetchServerRuns("mon-x", "tok")).rejects.toThrow("Monitor not found");
  });
});
