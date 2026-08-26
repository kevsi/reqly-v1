import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ResponseTimeline } from "@/components/response-timeline";

describe("ResponseTimeline", () => {
  afterEach(() => {
    cleanup();
  });
  it("renders nothing when totalMs is 0", () => {
    const { container } = render(<ResponseTimeline timings={{ totalMs: 0 }} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders Download segment when all explicit timings are 0 but totalMs > 0", () => {
    const { container } = render(
      <ResponseTimeline timings={{ dnsMs: 0, connectMs: 0, ttfbMs: 0, totalMs: 100 }} />,
    );
    expect(container.firstChild).not.toBeNull();
    expect(screen.getByText("Download")).toBeTruthy();
    const valueSpans = container.querySelectorAll("span");
    const values = Array.from(valueSpans).map((s) => s.textContent);
    expect(values).toContain("100");
  });

  it("renders DNS and total labels", () => {
    render(<ResponseTimeline timings={{ dnsMs: 10, ttfbMs: 100, totalMs: 200 }} />);
    expect(screen.getByText("DNS")).toBeTruthy();
    expect(screen.getByText("Total")).toBeTruthy();
  });

  it("shows timing values in ms", () => {
    render(<ResponseTimeline timings={{ dnsMs: 12, ttfbMs: 142, totalMs: 234 }} />);
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("142")).toBeTruthy();
    expect(screen.getByText("234")).toBeTruthy();
  });

  it("hides DNS label when dnsMs is 0", () => {
    render(<ResponseTimeline timings={{ dnsMs: 0, ttfbMs: 100, totalMs: 200 }} />);
    expect(screen.queryByText("DNS")).toBeNull();
  });

  it("shows TCP label when connectMs > dnsMs", () => {
    render(<ResponseTimeline timings={{ dnsMs: 10, connectMs: 25, ttfbMs: 100, totalMs: 200 }} />);
    expect(screen.getByText("TCP")).toBeTruthy();
  });

  it("shows warning icon for dominant segment (>50%)", () => {
    render(<ResponseTimeline timings={{ dnsMs: 200, ttfbMs: 50, totalMs: 250 }} />);
    const dnsLabel = screen.getByText("DNS");
    expect(dnsLabel.parentElement?.querySelector("svg")).toBeTruthy();
  });

  it("does not show warning for non-dominant segments", () => {
    render(<ResponseTimeline timings={{ dnsMs: 30, ttfbMs: 100, totalMs: 200 }} />);
    const dnsLabel = screen.getByText("DNS");
    expect(dnsLabel.parentElement?.querySelector("svg")).toBeNull();
  });

  it("renders Download segment when remaining time exists", () => {
    render(<ResponseTimeline timings={{ dnsMs: 10, ttfbMs: 100, totalMs: 200 }} />);
    expect(screen.getByText("Download")).toBeTruthy();
  });

  it("handles only ttfbMs without connectMs", () => {
    render(<ResponseTimeline timings={{ ttfbMs: 150, totalMs: 200 }} />);
    expect(screen.getByText("Download")).toBeTruthy();
  });

  it("renders multiple segments with correct proportions", () => {
    const { container } = render(
      <ResponseTimeline timings={{ dnsMs: 25, ttfbMs: 175, totalMs: 250 }} />,
    );
    const segments = container.querySelectorAll(".h-2.rounded-full > div");
    expect(segments.length).toBeGreaterThanOrEqual(2);
  });

  it("shows TLS label when tlsMs > 0", () => {
    render(<ResponseTimeline timings={{ tlsMs: 30, ttfbMs: 100, totalMs: 200 }} />);
    expect(screen.getByText("TLS")).toBeTruthy();
  });

  it("shows transport indicator when provided", () => {
    render(<ResponseTimeline timings={{ totalMs: 100, transport: "proxy" }} />);
    expect(screen.getByText("via proxy")).toBeTruthy();
  });

  it("shows connection reuse indicator", () => {
    render(<ResponseTimeline timings={{ totalMs: 100, connectionReused: true }} />);
    expect(screen.getByText("keep-alive")).toBeTruthy();
  });

  it("shows new connection indicator when not reused", () => {
    render(<ResponseTimeline timings={{ totalMs: 100, connectionReused: false }} />);
    expect(screen.getByText("nouvelle connexion")).toBeTruthy();
  });

  it("shows request and response bytes", () => {
    render(<ResponseTimeline timings={{ totalMs: 100, requestBytes: 1024, responseBytes: 2048 }} />);
    expect(screen.getByText("↑ 1.0 Ko")).toBeTruthy();
    expect(screen.getByText("↓ 2.0 Ko")).toBeTruthy();
  });

  it("shows threshold warning for slow TTFB", () => {
    render(<ResponseTimeline timings={{ ttfbMs: 600, totalMs: 800 }} />);
    // Wait > 500ms threshold should show alert triangle
    const waitLabel = screen.getByText("Wait");
    expect(waitLabel.parentElement?.querySelector("svg")).toBeTruthy();
  });
});
