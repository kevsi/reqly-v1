// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DiagBadge } from "@/src/ai/components/DiagBadge";

describe("DiagBadge", () => {
  it("renders ERREUR label for error severity", () => {
    render(<DiagBadge severity="error" />);
    expect(screen.getByText("ERREUR")).toBeTruthy();
  });
  it("renders ATTENTION label for warning severity", () => {
    render(<DiagBadge severity="warning" />);
    expect(screen.getByText("ATTENTION")).toBeTruthy();
  });
  it("renders INFO label for info severity", () => {
    render(<DiagBadge severity="info" />);
    expect(screen.getByText("INFO")).toBeTruthy();
  });
});
