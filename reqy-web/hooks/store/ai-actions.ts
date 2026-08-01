import type { RequestStore } from "@/hooks/request-types"
import type { TestAssertion } from "@/src/ai/engine"
import type { CurrentRequest } from "@/src/ai/engine"
import { CommitFn } from "./types"

export function createAiActionsMutations(commit: CommitFn) {
  const patchRequest = (patch: Partial<CurrentRequest>) => {
    commit((prev) => {
      const current = prev.currentRequest ?? { method: "GET" as const, url: "", headers: {}, params: {} }
      return {
        ...prev,
        currentRequest: { ...current, ...patch },
      }
    })
  }

  const addAssertions = (assertions: TestAssertion[]) => {
    commit((prev) => {
      const current = prev.currentRequest ?? { method: "GET" as const, url: "", headers: {}, params: {} }
      const existing = current.aiAssertions || []
      return {
        ...prev,
        currentRequest: { ...current, aiAssertions: [...existing, ...assertions] },
      }
    })
  }

  const setVariable = (name: string, value: string, _description?: string) => {
    commit((prev) => {
      const activeEnvId = prev.activeEnvironmentId
      if (!activeEnvId) return prev
      return {
        ...prev,
        environments: prev.environments.map((e) =>
          e.id === activeEnvId
            ? {
                ...e,
                updatedAt: Date.now(),
                variables: (() => {
                  const idx = e.variables.findIndex((v) => v.key === name)
                  if (idx >= 0) {
                    const updated = [...e.variables]
                    updated[idx] = { ...updated[idx], value, enabled: true }
                    return updated
                  }
                  return [...e.variables, { key: name, value, enabled: true }]
                })(),
              }
            : e
        ),
      }
    })
  }

  const setDoc = (markdown: string, _title?: string) => {
    commit((prev) => {
      const current = prev.currentRequest ?? { method: "GET" as const, url: "", headers: {}, params: {} }
      return {
        ...prev,
        currentRequest: { ...current, documentation: markdown },
      }
    })
  }

  return { patchRequest, addAssertions, setVariable, setDoc }
}
