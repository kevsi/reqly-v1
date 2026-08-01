/**
 * Test: GraphqlTabBar renders tabs and duplicate button.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { GraphqlTabBar } from "@/components/graphql/graphql-tab-bar";
import type { GraphqlTab } from "@/lib/types";

const sampleTabs: GraphqlTab[] = [
  {
    id: "tab-1",
    name: "Query 1",
    endpoint: "https://api.example.com/graphql",
    query: "query { users }",
    variables: "{}",
    headers: "{}",
  },
  {
    id: "tab-2",
    name: "Query 2",
    endpoint: "https://api.example.com/graphql",
    query: "query { posts }",
    variables: "{}",
    headers: "{}",
  },
];

afterEach(() => cleanup());

describe("GraphqlTabBar", () => {
  const defaultProps = {
    tabs: sampleTabs,
    activeTabId: "tab-1",
    onSelect: vi.fn(),
    onAdd: vi.fn(),
    onClose: vi.fn(),
    onDuplicate: vi.fn(),
  };

  function renderBar(props = {}) {
    return render(<GraphqlTabBar {...defaultProps} {...props} />);
  }

  it("renders all tabs", () => {
    renderBar();
    expect(screen.getByText("Query 1")).toBeTruthy();
    expect(screen.getByText("Query 2")).toBeTruthy();
  });

  it("highlights the active tab", () => {
    renderBar();
    const activeTab = screen.getByTestId("graphql-tab-tab-1");
    expect(activeTab.getAttribute("data-active")).toBe("true");
  });

  it("renders duplicate button and calls onDuplicate when clicked", () => {
    const onDuplicate = vi.fn();
    renderBar({ onDuplicate });
    const duplicateBtn = screen.getByTestId("graphql-tab-duplicate");
    expect(duplicateBtn).toBeTruthy();
    fireEvent.click(duplicateBtn);
    expect(onDuplicate).toHaveBeenCalledWith("tab-1");
  });

  it("renders an add button and calls onAdd when clicked", () => {
    const onAdd = vi.fn();
    renderBar({ onAdd });
    const addBtn = screen.getByTestId("graphql-tab-add");
    expect(addBtn).toBeTruthy();
    fireEvent.click(addBtn);
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it("calls onSelect when a tab is clicked", () => {
    const onSelect = vi.fn();
    renderBar({ onSelect });
    const tab2 = screen.getByTestId("graphql-tab-tab-2");
    fireEvent.click(tab2);
    expect(onSelect).toHaveBeenCalledWith("tab-2");
  });
});
