import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { createRef } from "react";
import { RequestTabBar } from "@/components/request-tab-bar";
import type { RequestTabBarProps } from "@/components/request-tab-bar";
import type { RequestTab } from "@/lib/request-executor";

const makeTab = (overrides: Partial<RequestTab> = {}): RequestTab =>
  ({
    id: "t1",
    name: "Old Name",
    method: "GET",
    url: "",
    endpoint: "",
    headers: [],
    queryParams: [],
    body: "",
    bodyType: "none" as never,
    authType: "none" as never,
    authToken: "",
    hasResponse: false,
    isSaved: true,
    ...overrides,
  }) as unknown as RequestTab;

const baseProps = (onRenameTab = vi.fn()) => ({
  tabs: [makeTab()],
  activeTabId: "t1",
  canScrollLeft: false,
  canScrollRight: false,
  tabListRef: createRef<HTMLDivElement>(),
  contextMenu: null,
  onSelectTab: vi.fn(),
  onScroll: vi.fn(),
  onAddTab: vi.fn(),
  onCloseTab: vi.fn(),
  onContextMenu: vi.fn(),
  onCloseContextMenu: vi.fn(),
  onSaveActiveTab: vi.fn(),
  onDuplicateTab: vi.fn(),
  onCloseOthers: vi.fn(),
  onCloseToRight: vi.fn(),
  onCloseAllTabs: vi.fn(),
  onSaveAllTabs: vi.fn(),
  onOpenCollections: vi.fn(),
  onDuplicateActive: vi.fn(),
  onSaveActive: vi.fn(),
  onOpenHistory: vi.fn(),
  onRenameTab,
});

describe("RequestTabBar — request rename", () => {
  afterEach(() => cleanup());

  it("shows an inline input when the tab label is double-clicked", () => {
    render(<RequestTabBar {...baseProps()} />);
    const label = screen.getByText("Old Name");
    fireEvent.doubleClick(label);
    const input = screen.getByDisplayValue("Old Name") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.tagName).toBe("INPUT");
  });

  it("commits the new name via onRenameTab on Enter", () => {
    const onRenameTab = vi.fn();
    render(<RequestTabBar {...baseProps(onRenameTab)} />);
    fireEvent.doubleClick(screen.getByText("Old Name"));
    const input = screen.getByDisplayValue("Old Name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "New Name" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRenameTab).toHaveBeenCalledWith("t1", "New Name");
  });

  it("does not call onRenameTab when cancelled with Escape", () => {
    const onRenameTab = vi.fn();
    render(<RequestTabBar {...baseProps(onRenameTab)} />);
    fireEvent.doubleClick(screen.getByText("Old Name"));
    const input = screen.getByDisplayValue("Old Name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Aborted" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onRenameTab).not.toHaveBeenCalled();
  });

  it("exposes a Rename action in the context menu that triggers inline edit", () => {
    const onRenameTab = vi.fn();
    const props = baseProps(onRenameTab) as RequestTabBarProps;
    props.contextMenu = { tabId: "t1", x: 0, y: 0 };
    render(<RequestTabBar {...props} />);
    fireEvent.click(screen.getByText("Renommer"));
    const input = screen.getByDisplayValue("Old Name") as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: "From Menu" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRenameTab).toHaveBeenCalledWith("t1", "From Menu");
  });
});
