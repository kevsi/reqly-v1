import { describe, it, expect, vi } from "vitest";
import { createFoldersMutations } from "@/hooks/store/folders";
import type { Collection } from "@/hooks/request-types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function makeCollection(
  id: string,
  requests: Array<{ id: string; folderId?: string }>,
): Collection {
  return {
    id,
    name: `Col ${id}`,
    color: "emerald",
    icon: "package",
    requests: requests.map((r) => ({
      id: r.id,
      name: r.id,
      method: "GET",
      url: "https://api.example.com",
      endpoint: "/",
      ...(r.folderId !== undefined ? { folderId: r.folderId } : {}),
    })),
    folders: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("createFoldersMutations.moveRequestToFolder", () => {
  it("déplace une requête vers un dossier de la MÊME collection", () => {
    const col = makeCollection("c1", [{ id: "req1" }]);
    let committed: Collection[] | null = null;
    const mutations = createFoldersMutations((updater) => {
      committed = updater({
        collections: [col],
        environments: [],
        history: [],
      } as never).collections;
    });

    mutations.moveRequestToFolder("c1", "req1", "folder-1");
    expect(committed![0].requests[0].folderId).toBe("folder-1");
  });

  it("déplace une requête d'UNE AUTRE collection vers un dossier (cross-collection)", () => {
    const colA = makeCollection("cA", [{ id: "reqX" }]);
    const colB = makeCollection("cB", []);
    let committed: Collection[] | null = null;
    const mutations = createFoldersMutations((updater) => {
      committed = updater({
        collections: [colA, colB],
        environments: [],
        history: [],
      } as never).collections;
    });

    // Déposer reqX (dans cA) sur un dossier de cB
    mutations.moveRequestToFolder("cB", "reqX", "folder-B");
    expect(committed![0].requests.find((r) => r.id === "reqX")).toBeUndefined();
    const moved = committed![1].requests.find((r) => r.id === "reqX");
    expect(moved).toBeDefined();
    expect(moved!.folderId).toBe("folder-B");
  });

  it("ne fait rien si la requête n'existe nulle part", () => {
    const col = makeCollection("c1", []);
    let committed: Collection[] | null = null;
    const mutations = createFoldersMutations((updater) => {
      committed = updater({
        collections: [col],
        environments: [],
        history: [],
      } as never).collections;
    });
    mutations.moveRequestToFolder("c1", "ghost", "folder-1");
    expect(committed![0].requests).toHaveLength(0);
  });
});
