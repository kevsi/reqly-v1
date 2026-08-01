"use client";

/**
 * Connection state for OAuth tools (GitHub / GitLab).
 *
 * The native desktop flow (`use-oauth-connect.ts`) updates this store when a
 * token is stored or removed; `tools-section.tsx` derives the card status from
 * it (with an initial sync from the encrypted secure store).
 */

import { create } from "zustand";

export type ToolId = "github" | "gitlab";

export type ConnectionStatus = "connected" | "disconnected" | "loading";

interface ToolConnectionsState {
  github: ConnectionStatus;
  gitlab: ConnectionStatus;
  setStatus: (tool: ToolId, status: ConnectionStatus) => void;
}

export const useToolConnections = create<ToolConnectionsState>((set) => ({
  github: "loading",
  gitlab: "loading",
  setStatus: (tool, status) => set({ [tool]: status }),
}));

export function isOAuthTool(id: string): id is ToolId {
  return id === "github" || id === "gitlab";
}

/** secure-storage keys holding each provider's access token. */
export const OAUTH_TOKEN_KEYS: Record<ToolId, string> = {
  github: "github_access_token",
  gitlab: "gitlab_access_token",
};
