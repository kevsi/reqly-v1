// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Panel } from "@/src/ai/components/Panel";
import type { Diagnostic } from "@/src/ai/types";

const fakeDiag: Diagnostic = {
  id: "auth.401.bearer.missing",
  severity: "error",
  category: "auth",
  title: "Token Bearer manquant",
  explanation: "...",
  confidence: "certain",
  source: "local",
  timestamp: 0,
};

describe("Panel", () => {
  it("renders empty state when no diagnostics", () => {
    render(<Panel diagnostics={[]} />);
    expect(screen.getByText(/aucun diagnostic/i)).toBeTruthy();
  });
  it("renders a DiagBadge per diagnostic", () => {
    render(<Panel diagnostics={[fakeDiag]} />);
    expect(screen.getByText("Token Bearer manquant")).toBeTruthy();
  });
});
