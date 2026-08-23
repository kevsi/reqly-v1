"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { uuidV4 } from "@/lib/utils";

export interface ChainStepExtraction {
  sourcePath: string; // JSONPath pour extraire de la réponse
  targetVariable: string; // Nom de la variable à créer
}

export interface ChainStep {
  id: string;
  requestId: string;
  requestName: string;
  collectionId: string;
  extractVariables: ChainStepExtraction[];
  waitForPrevious: boolean;
  enabled: boolean;
}

export interface RequestChain {
  id: string;
  name: string;
  steps: ChainStep[];
}

interface ChainsState {
  chains: RequestChain[];
  addChain: (name: string, steps?: ChainStep[]) => string;
  updateChain: (id: string, updates: Partial<Omit<RequestChain, "id">>) => void;
  removeChain: (id: string) => void;
}

export const useChainsStore = create<ChainsState>()(
  persist(
    (set) => ({
      chains: [],
      addChain: (name, steps = []) => {
        const id = uuidV4();
        set((state) => ({ chains: [...state.chains, { id, name, steps }] }));
        return id;
      },
      updateChain: (id, updates) =>
        set((state) => ({
          chains: state.chains.map((c) => (c.id === id ? { ...c, ...updates } : c)),
        })),
      removeChain: (id) => set((state) => ({ chains: state.chains.filter((c) => c.id !== id) })),
    }),
    {
      name: "reqly-chains-store",
      version: 1,
      storage: createJSONStorage(() => window.localStorage),
    },
  ),
);
