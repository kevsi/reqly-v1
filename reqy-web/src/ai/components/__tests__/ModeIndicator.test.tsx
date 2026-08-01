// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ModeIndicator } from "@/src/ai/components/ModeIndicator";

describe("ModeIndicator", () => {
  it("shows 'Local' when mode is local", () => {
    render(<ModeIndicator mode="local" />);
    expect(screen.getByText(/local/i)).toBeTruthy();
  });
  it("shows 'Cloud' when mode is cloud", () => {
    render(<ModeIndicator mode="cloud" />);
    expect(screen.getByText(/cloud/i)).toBeTruthy();
  });
});
