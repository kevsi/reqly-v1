import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { fireEvent, screen } from "@testing-library/react";
import { useRequestTabsState } from "@/hooks/use-request-tabs-state";
import { createEmptyTab } from "@/lib/request-tab-utils";
import type { RequestTab } from "@/lib/request-executor";

const mocks = vi.hoisted(() => ({
  updateRequestById: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/hooks/use-request-store", () => ({
  useRequestStore: (
    selector: (s: { updateRequestById: typeof mocks.updateRequestById }) => unknown,
  ) => selector({ updateRequestById: mocks.updateRequestById }),
}));
vi.mock("@/lib/tauri", () => ({
  isTauriAvailable: () => false,
}));
vi.mock("@/hooks/use-toast", () => ({
  toast: mocks.toast,
}));

function makeTab(overrides: Partial<RequestTab>): RequestTab {
  return createEmptyTab(overrides);
}

async function seedTabs(tabs: RequestTab[]) {
  const { result } = renderHook(() => useRequestTabsState());
  act(() => {
    result.current.setTabs(tabs);
  });
  return result;
}

describe("useRequestTabsState — fermetures en masse protégées (R10)", () => {
  beforeEach(() => {
    mocks.updateRequestById.mockReset();
    mocks.toast.mockReset();
  });

  it("closeOthers : demande confirmation quand un onglet non sauvegardé a du contenu", async () => {
    const result = await seedTabs([
      makeTab({ id: "t1", name: "Saved", isSaved: true, url: "https://a.test" }),
      makeTab({ id: "t2", name: "Dirty", isSaved: false, url: "https://b.test" }),
    ]);

    act(() => {
      result.current.closeOthers("t1");
    });

    // Le dialog apparaît et rien n'est encore fermé.
    expect(screen.getByTestId("request-mass-close-dialog")).toBeTruthy();
    expect(result.current.tabs.map((t) => t.id)).toEqual(["t1", "t2"]);

    // « Abandonner » confirme la fermeture des autres onglets.
    fireEvent.click(screen.getByTestId("mass-close-discard"));

    expect(screen.queryByTestId("request-mass-close-dialog")).toBeNull();
    expect(result.current.tabs.map((t) => t.id)).toEqual(["t1"]);
    expect(result.current.activeTabId).toBe("t1");
  });

  it("closeToRight : demande confirmation puis ferme les onglets à droite", async () => {
    const result = await seedTabs([
      makeTab({ id: "t1", name: "S1", isSaved: true, url: "https://a.test" }),
      makeTab({ id: "t2", name: "D1", isSaved: false, url: "https://b.test" }),
      makeTab({ id: "t3", name: "D2", isSaved: false, body: "{}" }),
    ]);

    act(() => {
      result.current.closeToRight("t1");
    });

    expect(screen.getByTestId("request-mass-close-dialog")).toBeTruthy();
    expect(result.current.tabs).toHaveLength(3);

    fireEvent.click(screen.getByTestId("mass-close-discard"));

    expect(result.current.tabs.map((t) => t.id)).toEqual(["t1"]);
  });

  it("closeAllTabs : annuler préserve les onglets", async () => {
    const result = await seedTabs([
      makeTab({ id: "t1", name: "D1", isSaved: false, url: "https://a.test" }),
    ]);

    act(() => {
      result.current.closeAllTabs();
    });

    expect(screen.getByTestId("request-mass-close-dialog")).toBeTruthy();

    fireEvent.click(screen.getByText("Annuler"));

    expect(screen.queryByTestId("request-mass-close-dialog")).toBeNull();
    expect(result.current.tabs.map((t) => t.id)).toEqual(["t1"]);
  });

  it("ferme immédiatement quand tous les candidats sont sauvegardés ou vides", async () => {
    const result = await seedTabs([
      makeTab({ id: "t1", name: "S1", isSaved: true, url: "https://a.test" }),
      makeTab({ id: "t2", name: "Empty", isSaved: false }),
    ]);

    act(() => {
      result.current.closeOthers("t1");
    });

    expect(screen.queryByTestId("request-mass-close-dialog")).toBeNull();
    expect(result.current.tabs.map((t) => t.id)).toEqual(["t1"]);
  });
});

describe("useRequestTabsState — saveAllTabs réel (R10)", () => {
  beforeEach(() => {
    mocks.updateRequestById.mockReset();
    mocks.toast.mockReset();
  });

  it("persiste les onglets rattachés et avertit pour les onglets non rattachés", async () => {
    const result = await seedTabs([
      makeTab({
        id: "t1",
        name: "Attached",
        isSaved: false,
        savedRequestId: "req-9",
        url: "https://api.test/v1",
        body: '{"a":1}',
        method: "POST",
      }),
      makeTab({
        id: "t2",
        name: "Detached",
        isSaved: false,
        url: "https://other.test",
      }),
      makeTab({ id: "t3", name: "Already", isSaved: true, savedRequestId: "req-1" }),
    ]);

    act(() => {
      result.current.saveAllTabs();
    });

    // Persistance réelle du seul onglet rattaché.
    expect(mocks.updateRequestById).toHaveBeenCalledTimes(1);
    expect(mocks.updateRequestById).toHaveBeenCalledWith(
      "req-9",
      expect.objectContaining({ name: "Attached", method: "POST", body: '{"a":1}' }),
    );

    // isSaved basculé uniquement pour l'onglet rattaché.
    const byId = Object.fromEntries(result.current.tabs.map((tab) => [tab.id, tab]));
    expect(byId.t1?.isSaved).toBe(true);
    expect(byId.t2?.isSaved).toBe(false);

    // Toast succès + toast d'avertissement pour le non-rattaché.
    const titles = mocks.toast.mock.calls.map((call) => String(call[0]?.title ?? ""));
    expect(
      titles.some((title) => title.includes("1")) && titles.some((t) => t.includes("sauvegard")),
    ).toBe(true);
    const warnCall = mocks.toast.mock.calls.find((call) => call[0]?.variant === "destructive");
    expect(warnCall).toBeTruthy();
    expect(String(warnCall?.[0]?.title)).toMatch(/non rattach/);
  });

  it("signale que tout est déjà sauvegardé sans toucher au store", async () => {
    const result = await seedTabs([
      makeTab({ id: "t1", name: "S1", isSaved: true, savedRequestId: "req-1" }),
    ]);

    act(() => {
      result.current.saveAllTabs();
    });

    expect(mocks.updateRequestById).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    expect(String(mocks.toast.mock.calls[0][0].title)).toMatch(/déjà sauvegard/);
  });
});
