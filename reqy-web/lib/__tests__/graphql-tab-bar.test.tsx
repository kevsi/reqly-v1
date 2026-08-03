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
    dirty: true,
  },
  {
    id: "tab-2",
    name: "Query 2",
    endpoint: "https://api.example.com/graphql",
    query: "query { posts }",
    variables: "{}",
    headers: "{}",
    saved: true,
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
    onCloseOthers: vi.fn(),
    onCloseToRight: vi.fn(),
    onCloseAll: vi.fn(),
    onSaveActive: vi.fn(),
    onSaveAll: vi.fn(),
    onRename: vi.fn(),
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

  it("calls onClose when the close button is clicked and stops propagation", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderBar({ onSelect, onClose });
    fireEvent.click(screen.getByTestId("graphql-tab-close-tab-2"));
    expect(onClose).toHaveBeenCalledWith("tab-2");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("opens a context menu on right-click with tab actions", () => {
    const onClose = vi.fn();
    const onCloseOthers = vi.fn();
    renderBar({ onClose, onCloseOthers });
    fireEvent.contextMenu(screen.getByTestId("graphql-tab-tab-2"));
    expect(screen.getByTestId("graphql-tab-context-menu")).toBeTruthy();
    fireEvent.click(screen.getByText("Close Others"));
    expect(onCloseOthers).toHaveBeenCalledWith("tab-2");
  });

  it("exposes Rename in the context menu that triggers inline edit", () => {
    const onRename = vi.fn();
    renderBar({ onRename });
    fireEvent.contextMenu(screen.getByTestId("graphql-tab-tab-2"));
    fireEvent.click(screen.getByText("Rename"));
    const input = screen.getByDisplayValue("Query 2") as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("tab-2", "Renamed");
  });

  it("renames inline on double-click", () => {
    const onRename = vi.fn();
    renderBar({ onRename });
    fireEvent.doubleClick(screen.getByText("Query 2"));
    const input = screen.getByDisplayValue("Query 2") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Dbl Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("tab-2", "Dbl Renamed");
  });

  it("does not rename when cancelled with Escape", () => {
    const onRename = vi.fn();
    renderBar({ onRename });
    fireEvent.doubleClick(screen.getByText("Query 2"));
    const input = screen.getByDisplayValue("Query 2") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Aborted" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onRename).not.toHaveBeenCalled();
  });
});
