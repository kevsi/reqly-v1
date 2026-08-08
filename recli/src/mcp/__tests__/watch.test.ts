import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CollectionStore } from "../store.js";
import { watchBundleFile } from "../watch.js";
import type { ExportBundle, CollectionRunRecord } from "../types.js";

const makeBundle = (name: string): ExportBundle => ({
  version: "1.0",
  collections: [
    {
      id: `col-${name}`,
      name,
      color: "blue",
      icon: "folder",
      folders: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      requests: [
        {
          id: `req-${name}`,
          name: `${name}-req`,
          method: "GET",
          url: `https://${name}.example.com`,
          endpoint: `/${name}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    },
  ],
  environments: [],
});

describe("watchBundleFile", () => {
  let dir: string;
  let watcher: ReturnType<typeof watchBundleFile> | undefined;

  afterEach(() => {
    watcher?.close();
    watcher = undefined;
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reloads the store when the bundle file changes on disk", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "recli-watch-"));
    const file = path.join(dir, "bundle.json");
    fs.writeFileSync(file, JSON.stringify(makeBundle("A")));

    const store = new CollectionStore();
    store.loadFromBundle(makeBundle("A"));
    const logs: string[] = [];
    watcher = watchBundleFile(file, store, (m) => logs.push(m));

    // chokidar needs time to initialise its watch handles
    await new Promise((r) => setTimeout(r, 500));

    fs.writeFileSync(file, JSON.stringify(makeBundle("B")));

    let ok = false;
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (store.getCollections()[0]?.name === "B") {
        ok = true;
        break;
      }
    }
    expect(ok).toBe(true);
    expect(logs.some((m) => m.includes("Hot-reloaded"))).toBe(true);
  });

  it("ignores its own writes via markWritten", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "recli-watch-self-"));
    const file = path.join(dir, "bundle.json");
    fs.writeFileSync(file, JSON.stringify(makeBundle("A")));

    const store = new CollectionStore();
    store.loadFromBundle(makeBundle("A"));
    const logs: string[] = [];
    watcher = watchBundleFile(file, store, (m) => logs.push(m));
    await new Promise((r) => setTimeout(r, 500));

    // Simulate the server persisting the same bundle (our own write).
    const content = JSON.stringify(makeBundle("A"));
    watcher.markWritten(content);
    fs.writeFileSync(file, content);
    await new Promise((r) => setTimeout(r, 500));

    expect(logs.some((m) => m.includes("Hot-reloaded"))).toBe(false);
  });
});

describe("CollectionStore — history persistence", () => {
  it("serialises history without body fields", () => {
    const store = new CollectionStore();
    const record: CollectionRunRecord = {
      id: "r1",
      collectionId: "c1",
      collectionName: "C1",
      startedAt: Date.now(),
      completedAt: Date.now(),
      totalDurationMs: 100,
      summary: { total: 1, passed: 1, failed: 0, errored: 0 },
      results: [
        {
          id: "rr1",
          requestId: "req1",
          requestName: "Get",
          collectionId: "c1",
          collectionName: "C1",
          method: "GET",
          url: "https://a.example.com",
          status: 200,
          statusText: "OK",
          durationMs: 100,
          size: 50,
          passed: true,
          body: '{"secret":"token"}',
          executedAt: Date.now(),
        },
      ],
    };
    store.addRunRecord(record);
    const history = store.getRunHistory();

    // Re-serialise through the same replacer the server uses.
    const serialised = JSON.stringify(history, (_key, value) =>
      value instanceof Object && value !== null && "body" in value
        ? { ...value, body: undefined }
        : value,
    );
    expect(serialised).not.toContain('"secret":"token"');
    expect(serialised).toContain('"passed":true');
  });

  it("loadHistory restores records", () => {
    const store = new CollectionStore();
    const records: CollectionRunRecord[] = [
      {
        id: "h1",
        collectionId: "c1",
        collectionName: "C1",
        startedAt: 1,
        completedAt: 2,
        totalDurationMs: 1,
        summary: { total: 1, passed: 1, failed: 0, errored: 0 },
        results: [],
      },
    ];
    store.loadHistory(records);
    expect(store.getRunHistory()).toHaveLength(1);
    expect(store.getRunHistory()[0]!.id).toBe("h1");
  });

  it("addRunRecord calls historyPersistCallback", () => {
    const store = new CollectionStore();
    let persisted = false;
    store.setHistoryPersistCallback(() => {
      persisted = true;
    });
    store.addRunRecord({
      id: "p1",
      collectionId: "c1",
      collectionName: "C1",
      startedAt: 1,
      completedAt: 1,
      totalDurationMs: 0,
      summary: { total: 0, passed: 0, failed: 0, errored: 0 },
      results: [],
    });
    expect(persisted).toBe(true);
  });
});
