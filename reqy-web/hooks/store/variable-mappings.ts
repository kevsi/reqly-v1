import type { RequestStore, VariableMapping } from "@/hooks/request-types";
import { CommitFn, WORKSPACE_PERSONAL_ID } from "./types";

export function createVariableMappingsMutations(commit: CommitFn) {
  const addVariableMapping = (data: Omit<VariableMapping, "id" | "createdAt" | "updatedAt">) => {
    commit((prev: RequestStore) => ({
      ...prev,
      variableMappings: [
        ...prev.variableMappings,
        {
          ...data,
          id: `vm-${crypto.randomUUID()}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    }));
  };

  const updateVariableMapping = (id: string, updates: Partial<VariableMapping>) => {
    commit((prev: RequestStore) => ({
      ...prev,
      variableMappings: prev.variableMappings.map((vm) =>
        vm.id === id ? { ...vm, ...updates, updatedAt: Date.now() } : vm,
      ),
    }));
  };

  const removeVariableMapping = (id: string) => {
    commit((prev: RequestStore) => ({
      ...prev,
      variableMappings: prev.variableMappings.filter((vm) => vm.id !== id),
    }));
  };

  return { addVariableMapping, updateVariableMapping, removeVariableMapping };
}
