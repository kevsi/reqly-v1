import { describe, it, expect, beforeEach } from "vitest"
import type { RequestStore } from "@/hooks/request-types"
import type { TestAssertion, CurrentRequest } from "@/src/ai/engine"
import { createAiActionsMutations } from "../ai-actions"
import { WORKSPACE_PERSONAL_ID } from "../types"

function createStore(overrides?: Partial<RequestStore>): RequestStore {
  return {
    history: [],
    collections: [],
    environments: [
      {
        id: "env-test",
        name: "Test",
        color: "blue",
        workspaceId: WORKSPACE_PERSONAL_ID,
        variables: [
          { key: "existing_key", value: "old_value", enabled: true },
        ],
        createdAt: 0,
        updatedAt: 0,
      },
    ],
    notifications: [],
    variableMappings: [],
    systemNotificationPermission: "granted",
    activeEnvironmentId: "env-test",
    projects: [],
    selectedProjectId: null,
    currentRequest: {
      method: "GET",
      url: "https://api.example.com/users",
      headers: { "Content-Type": "application/json" },
      params: {},
    },
    lastResponse: null,
    environmentVariables: {},
    collectionHistory: [],
    activeCollection: null,
    aiAutoApply: false,
    aiAudit: [],
    workspaces: [{ id: WORKSPACE_PERSONAL_ID, name: "Personal", color: "slate", icon: "folder", createdAt: 0, updatedAt: 0 }],
    activeWorkspaceId: WORKSPACE_PERSONAL_ID,
    datasets: [],
    ...overrides,
  }
}

describe("createAiActionsMutations", () => {
  let store: RequestStore
  let mutations: ReturnType<typeof createAiActionsMutations>

  beforeEach(() => {
    store = createStore()
    const commit = (updater: (prev: RequestStore) => RequestStore) => {
      store = updater(store)
    }
    mutations = createAiActionsMutations(commit)
  })

  describe("patchRequest", () => {
    it("merges patch into currentRequest", () => {
      mutations.patchRequest({ url: "https://api.example.com/admin", method: "POST" })
      expect(store.currentRequest?.url).toBe("https://api.example.com/admin")
      expect(store.currentRequest?.method).toBe("POST")
      expect(store.currentRequest?.headers).toEqual({ "Content-Type": "application/json" })
    })

    it("creates default currentRequest when null", () => {
      store = createStore({ currentRequest: null })
      const commit = (updater: (prev: RequestStore) => RequestStore) => {
        store = updater(store)
      }
      mutations = createAiActionsMutations(commit)
      mutations.patchRequest({ url: "/api/test" })
      expect(store.currentRequest?.url).toBe("/api/test")
      expect(store.currentRequest?.method).toBe("GET")
    })
  })

  describe("addAssertions", () => {
    it("appends assertions to currentRequest.aiAssertions", () => {
      const assertions: TestAssertion[] = [
        { label: "Status 200", code: "response.status === 200" },
      ]
      mutations.addAssertions(assertions)
      expect(store.currentRequest?.aiAssertions).toHaveLength(1)
      expect(store.currentRequest?.aiAssertions?.[0].label).toBe("Status 200")
    })

    it("appends to existing assertions", () => {
      store = createStore({
        currentRequest: {
          method: "GET",
          url: "/api/test",
          headers: {},
          params: {},
          aiAssertions: [{ label: "First", code: "first" }],
        },
      })
      const commit = (updater: (prev: RequestStore) => RequestStore) => {
        store = updater(store)
      }
      mutations = createAiActionsMutations(commit)
      mutations.addAssertions([{ label: "Second", code: "second" }])
      expect(store.currentRequest?.aiAssertions).toHaveLength(2)
      expect(store.currentRequest?.aiAssertions?.[1].label).toBe("Second")
    })

    it("handles null currentRequest gracefully", () => {
      store = createStore({ currentRequest: null })
      const commit = (updater: (prev: RequestStore) => RequestStore) => {
        store = updater(store)
      }
      mutations = createAiActionsMutations(commit)
      mutations.addAssertions([{ label: "Test", code: "test" }])
      expect(store.currentRequest?.aiAssertions).toHaveLength(1)
    })
  })

  describe("setVariable", () => {
    it("creates a new variable in the active environment", () => {
      mutations.setVariable("new_key", "new_value")
      const env = store.environments.find((e) => e.id === "env-test")
      expect(env?.variables).toContainEqual({ key: "new_key", value: "new_value", enabled: true })
    })

    it("updates an existing variable in the active environment", () => {
      mutations.setVariable("existing_key", "updated_value")
      const env = store.environments.find((e) => e.id === "env-test")
      expect(env?.variables).toContainEqual({ key: "existing_key", value: "updated_value", enabled: true })
      expect(env?.variables).toHaveLength(1)
    })

    it("does nothing when no active environment", () => {
      store = createStore({ activeEnvironmentId: null })
      const commit = (updater: (prev: RequestStore) => RequestStore) => {
        store = updater(store)
      }
      mutations = createAiActionsMutations(commit)
      mutations.setVariable("key", "value")
      expect(store.environments[0].variables).toHaveLength(1)
    })
  })

  describe("setDoc", () => {
    it("stores documentation on currentRequest", () => {
      mutations.setDoc("# API Docs\n\nThis endpoint...")
      expect(store.currentRequest?.documentation).toBe("# API Docs\n\nThis endpoint...")
    })

    it("handles null currentRequest gracefully", () => {
      store = createStore({ currentRequest: null })
      const commit = (updater: (prev: RequestStore) => RequestStore) => {
        store = updater(store)
      }
      mutations = createAiActionsMutations(commit)
      mutations.setDoc("# Docs")
      expect(store.currentRequest?.documentation).toBe("# Docs")
    })
  })
})
