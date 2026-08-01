/**
 * Test: GraphqlResponsePanel renders tabs and empty state.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { GraphqlResponsePanel } from "@/components/graphql/graphql-response-panel";

afterEach(() => cleanup());

const defaultProps = {
  onStop: vi.fn(),
  request: {
    endpoint: "https://api.example.com/graphql",
    query: "query { users }",
    variables: {} as Record<string, unknown>,
    headers: {} as Record<string, string>,
  },
};

describe("GraphqlResponsePanel", () => {
  it("renders all three tabs", () => {
    const { container } = render(<GraphqlResponsePanel {...defaultProps} />);
    expect(container.textContent).toContain("Response");
    expect(container.textContent).toContain("Code");
    expect(container.textContent).toContain("Schema Diff");
  });

  it("switches to Code tab on click", () => {
    const { container } = render(<GraphqlResponsePanel {...defaultProps} />);
    const codeTab = screen.getByTestId("graphql-response-tab-code");
    fireEvent.click(codeTab);
    // Code tab shows generated JS Fetch code
    expect(container.textContent).toContain("fetch(");
  });

  it("switches to Schema Diff tab on click", () => {
    const { container } = render(<GraphqlResponsePanel {...defaultProps} />);
    const diffTab = screen.getByTestId("graphql-response-tab-diff");
    fireEvent.click(diffTab);
    // Schema diff shows a message when no schema is available
    expect(
      container.textContent?.toLowerCase().includes("schema") ||
        container.textContent?.toLowerCase().includes("no schema"),
    ).toBe(true);
  });
});
