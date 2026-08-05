import type {
  Collection,
  CollectionFolder,
  ExportBundle,
  Environment,
  CollectionRunRecord,
  RequestRunRecord,
} from "./types.js";

export class CollectionStore {
  private collections: Collection[] = [];
  private environments: Environment[] = [];
  private history: CollectionRunRecord[] = [];
  private persistCallback: (() => void) | null = null;

  setPersistCallback(cb: () => void): void {
    this.persistCallback = cb;
  }

  private notifyPersist(): void {
    this.persistCallback?.();
  }

  loadFromBundle(bundle: ExportBundle): void {
    this.collections = bundle.collections ?? [];
    this.environments = bundle.environments ?? [];
    this.ensureIds();
  }

  loadFromCollections(collections: Collection[]): void {
    this.collections = collections ?? [];
    this.ensureIds();
  }

  /**
   * Bridge between the two addressing worlds. The CLI/`run`/`ui` address
   * requests by name and its bundles carry no ids; the MCP tools address by id
   * (`request_id`, `collection_id`) and its types require id/endpoint/timestamps.
   * Assign stable ids (and the other MCP invariants) to entities that lack
   * them so `serve --file demo.json` works. Existing ids are never overwritten.
   */
  private ensureIds(): void {
    const now = Date.now();
    const uid = (): string => Math.random().toString(36).slice(2, 8);
    for (const collection of this.collections) {
      if (!collection.id) collection.id = `col-${now}-${uid()}`;
      if (!collection.color) collection.color = "blue";
      if (!collection.icon) collection.icon = "folder";
      if (!collection.createdAt) collection.createdAt = now;
      if (!collection.updatedAt) collection.updatedAt = now;
      if (!collection.folders) collection.folders = [];
      for (const folder of collection.folders) {
        if (!folder.id) folder.id = `fld-${now}-${uid()}`;
        if (!folder.collectionId) folder.collectionId = collection.id;
        if (folder.parentId === undefined) folder.parentId = null;
        if (folder.order === undefined) folder.order = collection.folders.indexOf(folder);
        if (!folder.createdAt) folder.createdAt = now;
        if (!folder.updatedAt) folder.updatedAt = now;
      }
      for (const request of collection.requests) {
        if (!request.id) request.id = `req-${now}-${uid()}`;
        if (!request.endpoint) request.endpoint = request.url;
        if (!request.createdAt) request.createdAt = now;
        if (!request.updatedAt) request.updatedAt = now;
      }
    }
    for (const env of this.environments) {
      if (!env.id) env.id = `env-${now}-${uid()}`;
    }
  }

  getCollections(): Collection[] {
    return this.collections;
  }

  getCollection(id: string): Collection | undefined {
    return this.collections.find((c) => c.id === id);
  }

  findRequestById(
    requestId: string,
  ): { request: Collection["requests"][number]; collection: Collection } | undefined {
    // Exact id first (MCP-generated or file-provided ids take precedence).
    for (const collection of this.collections) {
      const request = collection.requests.find((r) => r.id === requestId);
      if (request) {
        return { request, collection };
      }
    }
    // Fallback: address by name (case-insensitive), like `run --request <name>`.
    // CLI bundles are name-based. Only applied when the name matches EXACTLY ONE
    // request — running by name is ergonomic, but the same lookup backs the
    // mutating tools (update/delete/move) and a duplicate name must not silently
    // hit the wrong request.
    const lower = requestId.toLowerCase();
    const matches: Array<{ request: Collection["requests"][number]; collection: Collection }> = [];
    for (const collection of this.collections) {
      for (const request of collection.requests) {
        if (request.name.toLowerCase() === lower) matches.push({ request, collection });
      }
    }
    return matches.length === 1 ? matches[0] : undefined;
  }

  addCollection(name: string, description?: string, color?: string, icon?: string): Collection {
    const now = Date.now();
    const collection: Collection = {
      id: `col-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      description: description ?? "",
      color: color ?? "blue",
      icon: icon ?? "folder",
      requests: [],
      folders: [],
      createdAt: now,
      updatedAt: now,
    };
    this.collections.push(collection);
    this.notifyPersist();
    return collection;
  }

  updateCollection(
    id: string,
    updates: Partial<Pick<Collection, "name" | "description" | "color" | "icon">>,
  ): Collection {
    const collection = this.getCollection(id);
    if (!collection) throw new Error(`Collection not found: ${id}`);
    if (updates.name !== undefined) collection.name = updates.name;
    if (updates.description !== undefined) collection.description = updates.description;
    if (updates.color !== undefined) collection.color = updates.color;
    if (updates.icon !== undefined) collection.icon = updates.icon;
    collection.updatedAt = Date.now();
    this.notifyPersist();
    return collection;
  }

  deleteCollection(id: string): void {
    const index = this.collections.findIndex((c) => c.id === id);
    if (index === -1) throw new Error(`Collection not found: ${id}`);
    this.collections.splice(index, 1);
    this.notifyPersist();
  }

  duplicateCollection(id: string): Collection {
    const source = this.getCollection(id);
    if (!source) throw new Error(`Collection not found: ${id}`);
    const now = Date.now();
    const clone: Collection = {
      ...JSON.parse(JSON.stringify(source)),
      id: `col-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name: `${source.name} (copy)`,
      createdAt: now,
      updatedAt: now,
    };
    clone.requests = source.requests.map((r) => ({
      ...r,
      id: `req-${now}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,
      updatedAt: now,
    }));
    clone.folders = (source.folders ?? []).map((f) => ({
      ...f,
      id: `fld-${now}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,
      updatedAt: now,
    }));
    this.collections.push(clone);
    this.notifyPersist();
    return clone;
  }

  addRequest(collectionId: string, request: Collection["requests"][number]): void {
    const collection = this.getCollection(collectionId);
    if (!collection) throw new Error(`Collection not found: ${collectionId}`);
    collection.requests.push(request);
    collection.updatedAt = Date.now();
    this.notifyPersist();
  }

  updateRequest(
    requestId: string,
    updates: Partial<Omit<Collection["requests"][number], "id" | "createdAt">>,
  ): Collection["requests"][number] {
    const found = this.findRequestById(requestId);
    if (!found) throw new Error(`Request not found: ${requestId}`);
    const { request } = found;
    if (updates.name !== undefined) request.name = updates.name;
    if (updates.method !== undefined) request.method = updates.method;
    if (updates.url !== undefined) {
      request.url = updates.url;
      request.endpoint = updates.url;
    }
    if (updates.headers !== undefined) request.headers = updates.headers;
    if (updates.body !== undefined) request.body = updates.body;
    if (updates.bodyType !== undefined) request.bodyType = updates.bodyType;
    if (updates.authType !== undefined) request.authType = updates.authType;
    if (updates.authToken !== undefined) request.authToken = updates.authToken;
    if (updates.queryParams !== undefined) request.queryParams = updates.queryParams;
    if (updates.folderId !== undefined) request.folderId = updates.folderId;
    if (updates.preRequestScript !== undefined) request.preRequestScript = updates.preRequestScript;
    if (updates.postResponseScript !== undefined)
      request.postResponseScript = updates.postResponseScript;
    if (updates.runnerAssertions !== undefined) request.runnerAssertions = updates.runnerAssertions;
    if (updates.protocol !== undefined) request.protocol = updates.protocol;
    if (updates.graphql !== undefined) request.graphql = updates.graphql;
    request.updatedAt = Date.now();
    found.collection.updatedAt = Date.now();
    this.notifyPersist();
    return request;
  }

  deleteRequest(requestId: string): void {
    for (const collection of this.collections) {
      const index = collection.requests.findIndex((r) => r.id === requestId);
      if (index !== -1) {
        collection.requests.splice(index, 1);
        collection.updatedAt = Date.now();
        this.notifyPersist();
        return;
      }
    }
    throw new Error(`Request not found: ${requestId}`);
  }

  duplicateRequest(requestId: string, targetCollectionId?: string): Collection["requests"][number] {
    const found = this.findRequestById(requestId);
    if (!found) throw new Error(`Request not found: ${requestId}`);
    const now = Date.now();
    const clone: Collection["requests"][number] = {
      ...JSON.parse(JSON.stringify(found.request)),
      id: `req-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name: `${found.request.name} (copy)`,
      createdAt: now,
      updatedAt: now,
    };
    const colId = targetCollectionId ?? found.collection.id;
    const target = this.getCollection(colId);
    if (!target) throw new Error(`Target collection not found: ${colId}`);
    target.requests.push(clone);
    target.updatedAt = now;
    this.notifyPersist();
    return clone;
  }

  searchRequests(
    query: string,
  ): Array<{
    request: Collection["requests"][number];
    collectionId: string;
    collectionName: string;
  }> {
    const lower = query.toLowerCase();
    const results: Array<{
      request: Collection["requests"][number];
      collectionId: string;
      collectionName: string;
    }> = [];
    for (const collection of this.collections) {
      for (const request of collection.requests) {
        const text = `${request.name} ${request.url} ${request.method}`.toLowerCase();
        if (text.includes(lower)) {
          results.push({ request, collectionId: collection.id, collectionName: collection.name });
        }
      }
    }
    return results;
  }

  addFolder(collectionId: string, name: string, parentId?: string | null): CollectionFolder {
    const collection = this.getCollection(collectionId);
    if (!collection) throw new Error(`Collection not found: ${collectionId}`);
    const now = Date.now();
    const folder: CollectionFolder = {
      id: `fld-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      parentId: parentId ?? null,
      collectionId,
      order: (collection.folders ?? []).length,
      createdAt: now,
      updatedAt: now,
    };
    if (!collection.folders) collection.folders = [];
    collection.folders.push(folder);
    collection.updatedAt = now;
    this.notifyPersist();
    return folder;
  }

  updateFolder(
    folderId: string,
    updates: Partial<Pick<CollectionFolder, "name" | "parentId" | "order">>,
  ): CollectionFolder {
    for (const collection of this.collections) {
      const folder = (collection.folders ?? []).find((f) => f.id === folderId);
      if (folder) {
        if (updates.name !== undefined) folder.name = updates.name;
        if (updates.parentId !== undefined) folder.parentId = updates.parentId;
        if (updates.order !== undefined) folder.order = updates.order;
        folder.updatedAt = Date.now();
        collection.updatedAt = Date.now();
        this.notifyPersist();
        return folder;
      }
    }
    throw new Error(`Folder not found: ${folderId}`);
  }

  deleteFolder(folderId: string): void {
    for (const collection of this.collections) {
      const index = (collection.folders ?? []).findIndex((f) => f.id === folderId);
      if (index !== -1) {
        collection.folders!.splice(index, 1);
        for (const req of collection.requests) {
          if (req.folderId === folderId) req.folderId = null;
        }
        collection.updatedAt = Date.now();
        this.notifyPersist();
        return;
      }
    }
    throw new Error(`Folder not found: ${folderId}`);
  }

  moveRequest(requestId: string, targetCollectionId: string, targetFolderId?: string | null): void {
    const found = this.findRequestById(requestId);
    if (!found) throw new Error(`Request not found: ${requestId}`);
    const { request, collection: sourceCol } = found;
    const targetCol = this.getCollection(targetCollectionId);
    if (!targetCol) throw new Error(`Target collection not found: ${targetCollectionId}`);
    const idx = sourceCol.requests.findIndex((r) => r.id === requestId);
    if (idx !== -1) sourceCol.requests.splice(idx, 1);
    sourceCol.updatedAt = Date.now();
    request.folderId = targetFolderId ?? null;
    request.updatedAt = Date.now();
    targetCol.requests.push(request);
    targetCol.updatedAt = Date.now();
    this.notifyPersist();
  }

  getEnvironments(): Environment[] {
    return this.environments;
  }

  getEnvironment(name: string): Environment | undefined {
    return this.environments.find((e) => e.name.toLowerCase() === name.toLowerCase());
  }

  addEnvironment(name: string, color?: string): Environment {
    const now = Date.now();
    const env: Environment = {
      id: `env-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      color,
      variables: [],
      createdAt: now,
      updatedAt: now,
    };
    this.environments.push(env);
    this.notifyPersist();
    return env;
  }

  updateEnvironment(
    envId: string,
    updates: Partial<Pick<Environment, "name" | "color" | "variables">>,
  ): Environment {
    const env = this.environments.find((e) => e.id === envId);
    if (!env) throw new Error(`Environment not found: ${envId}`);
    if (updates.name !== undefined) env.name = updates.name;
    if (updates.color !== undefined) env.color = updates.color;
    if (updates.variables !== undefined) env.variables = updates.variables;
    env.updatedAt = Date.now();
    this.notifyPersist();
    return env;
  }

  deleteEnvironment(envId: string): void {
    const index = this.environments.findIndex((e) => e.id === envId);
    if (index === -1) throw new Error(`Environment not found: ${envId}`);
    this.environments.splice(index, 1);
    this.notifyPersist();
  }

  duplicateEnvironment(envId: string): Environment {
    const source = this.environments.find((e) => e.id === envId);
    if (!source) throw new Error(`Environment not found: ${envId}`);
    const now = Date.now();
    const clone: Environment = {
      ...JSON.parse(JSON.stringify(source)),
      id: `env-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name: `${source.name} (copy)`,
      createdAt: now,
      updatedAt: now,
    };
    this.environments.push(clone);
    this.notifyPersist();
    return clone;
  }

  reorderRequests(collectionId: string, orderedIds: string[]): void {
    const collection = this.getCollection(collectionId);
    if (!collection) throw new Error(`Collection not found: ${collectionId}`);
    const idSet = new Set(orderedIds);
    const existingIds = collection.requests.map((r) => r.id);
    if (
      existingIds.some((id) => !idSet.has(id)) ||
      orderedIds.some((id) => !existingIds.includes(id))
    ) {
      throw new Error("Ordered IDs must contain exactly the same request IDs as the collection");
    }
    const indexMap = new Map(orderedIds.map((id, idx) => [id, idx]));
    collection.requests.sort((a, b) => (indexMap.get(a.id) ?? 0) - (indexMap.get(b.id) ?? 0));
    collection.updatedAt = Date.now();
    this.notifyPersist();
  }

  addRunRecord(record: CollectionRunRecord): void {
    this.history.unshift(record);
    if (this.history.length > 100) {
      this.history = this.history.slice(0, 100);
    }
  }

  getRunHistory(collectionId?: string, requestId?: string): CollectionRunRecord[] {
    let records = this.history;
    if (collectionId) records = records.filter((r) => r.collectionId === collectionId);
    if (requestId)
      records = records.filter((r) => r.results.some((res) => res.requestId === requestId));
    return records;
  }

  getRequestHistory(requestId: string): RequestRunRecord[] {
    return this.history
      .flatMap((r) => r.results)
      .filter((r) => r.requestId === requestId)
      .sort((a, b) => b.executedAt - a.executedAt);
  }

  clearHistory(): void {
    this.history = [];
  }

  getResolvedVariables(envName?: string): Record<string, string> {
    if (!envName) return {};
    const env = this.getEnvironment(envName);
    if (!env) return {};
    const result: Record<string, string> = {};
    for (const v of env.variables ?? []) {
      if (v.enabled) result[v.key] = v.value;
    }
    return result;
  }

  serializeBundle(): ExportBundle {
    return {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      collections: this.collections,
      environments: this.environments,
    };
  }
}
