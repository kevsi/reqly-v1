import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import CapturePage from "@/app/(app)/capture/page";

// jsdom renderers accumulate in document.body; clean up between tests so
// queries stay unambiguous (the vitest config does not enable globals, so
// @testing-library/react's auto-cleanup does not run).
afterEach(() => cleanup());

const hoisted = vi.hoisted(() => ({
  listCapturedSessions: vi.fn(),
  getCapturedSession: vi.fn(),
  clearCapturedSessions: vi.fn(),
  startCaptureProxy: vi.fn(),
  stopCaptureProxy: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  isTauriAvailable: () => true,
  listCapturedSessions: (...a: unknown[]) => hoisted.listCapturedSessions(...a),
  getCapturedSession: (...a: unknown[]) => hoisted.getCapturedSession(...a),
  startCaptureProxy: (...a: unknown[]) => hoisted.startCaptureProxy(...a),
  stopCaptureProxy: (...a: unknown[]) => hoisted.stopCaptureProxy(...a),
  clearCapturedSessions: (...a: unknown[]) => hoisted.clearCapturedSessions(...a),
  setBandwidthLimit: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@/hooks/use-request-store", () => ({
  useRequestStore: () => ({ addCollection: vi.fn(), addRequestToCollection: vi.fn() }),
}));

vi.mock("@/lib/capture-to-test/generate", () => ({
  generateCollectionFromCapture: vi.fn(() => ({
    collections: [{ name: "Gen", color: "#000000", icon: "box", description: "", requests: [] }],
  })),
}));

const sampleSession = {
  id: "c1",
  method: "GET",
  url: "https://api.test/ping",
  timestamp: 1_700_000_000_000,
};

const sampleDetail = {
  id: "c1",
  method: "GET",
  url: "https://api.test/ping",
  headers: [["Accept", "*/*"]] as Array<[string, string]>,
  body: null,
  timestamp: 1_700_000_000_000,
  status: 200,
  responseHeaders: [["Content-Type", "text/plain"]] as Array<[string, string]>,
  responseBody: "ok",
  durationMs: 12,
  error: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.listCapturedSessions.mockResolvedValue([sampleSession]);
  hoisted.getCapturedSession.mockResolvedValue(sampleDetail);
});

describe("Page Capture (persistance + UI)", () => {
  it("auto-charge les captures au montage", async () => {
    render(<CapturePage />);
    await waitFor(() => expect(hoisted.listCapturedSessions).toHaveBeenCalled());
  });

  it("affiche les captures avec un badge de méthode", async () => {
    render(<CapturePage />);
    const badge = await screen.findByText("GET");
    const methodEl = badge.closest("[data-method]");
    expect(methodEl).not.toBeNull();
    expect(methodEl?.getAttribute("data-method")).toBe("GET");
  });

  it("efface les captures quand on clique sur « Effacer »", async () => {
    render(<CapturePage />);
    await waitFor(() => expect(hoisted.listCapturedSessions).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /effacer/i }));
    await waitFor(() => expect(hoisted.clearCapturedSessions).toHaveBeenCalled());
  });

  it("ouvre le détail au clic sur une ligne", async () => {
    render(<CapturePage />);
    await screen.findByText("GET");
    fireEvent.click(screen.getByText("https://api.test/ping"));
    await waitFor(() => expect(hoisted.getCapturedSession).toHaveBeenCalledWith("c1"));
    const detail = await screen.findByTestId("capture-detail");
    expect(detail.textContent).toContain("200");
  });
});
