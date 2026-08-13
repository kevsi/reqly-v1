/**
 * Test: ResponseViewer shows empty state, loading, or response content.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ResponseViewer } from "@/components/graphql/response-viewer";

afterEach(() => cleanup());

describe("ResponseViewer", () => {
  it("shows empty state when no response data is present", () => {
    const { container } = render(<ResponseViewer />);
    const empty = container.querySelector('[data-testid="graphql-response-empty"]');
    expect(empty).not.toBeNull();
    expect(container.textContent).toContain("Aucune réponse pour le moment");
  });

  it("shows a loading indicator", () => {
    render(<ResponseViewer loading={true} />);
    expect(screen.getByTestId("graphql-response-viewer")).toBeTruthy();
    expect(screen.getByText("Chargement...")).toBeTruthy();
  });

  it("shows the response data when provided", () => {
    const { container } = render(<ResponseViewer data={{ hello: "world" }} status={200} />);
    expect(container.textContent).toContain("world");
    expect(container.textContent).toContain("200");
  });

  it("shows status badge with code", () => {
    const { container } = render(<ResponseViewer data={{}} status={200} />);
    const statusEl = container.querySelector('[data-testid="graphql-response-status"]');
    expect(statusEl).not.toBeNull();
    expect(statusEl?.textContent).toContain("200");
  });

  it("shows GraphQL errors when present", () => {
    const gqlErrors = [{ message: "Field 'foo' not found" }];
    const { container } = render(<ResponseViewer data={null} errors={gqlErrors} status={200} />);
    expect(container.textContent).toContain("Field 'foo' not found");
  });
});
