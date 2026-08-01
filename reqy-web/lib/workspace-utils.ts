/**
 * Workspace Utilities — Centralized workspace ID normalization
 * 
 * Single source of truth for workspace ID handling across the entire application.
 * All workspace ID normalization must use these utilities to prevent data leakage
 * and inconsistencies between workspaces.
 */

export const WORKSPACE_IDS = {
  PERSONAL: 'ws-personal',
  DEFAULT: 'ws-personal',
} as const

export type WorkspaceId = typeof WORKSPACE_IDS[keyof typeof WORKSPACE_IDS]

/**
 * Centralized workspace ID normalizer
 * 
 * Usage:
 *   WORKSPACE_NORMALIZER.normalize(id) → returns normalized ID
 *   WORKSPACE_NORMALIZER.isValid(id) → validates workspace ID
 */
export const WORKSPACE_NORMALIZER = {
  /**
   * Normalize a workspace ID to a consistent format.
   * Returns WORKSPACE_IDS.PERSONAL if the ID is null, undefined, or empty string.
   */
  normalize: (id?: string | null): string => {
    if (typeof id === 'string' && id.trim().length > 0) {
      return id.trim()
    }
    return WORKSPACE_IDS.PERSONAL
  },

  /**
   * Check if a workspace ID is valid (non-empty string)
   */
  isValid: (id: unknown): id is string => {
    return typeof id === 'string' && id.trim().length > 0
  },

  /**
   * Check if an ID is the personal workspace
   */
  isPersonal: (id: string): boolean => {
    return WORKSPACE_NORMALIZER.normalize(id) === WORKSPACE_IDS.PERSONAL
  },

  /**
   * Get all workspace IDs from an array of objects with optional workspaceId
   */
  extractUniqueIds: (items: Array<{ workspaceId?: string | null }>): string[] => {
    const ids = new Set<string>()
    items.forEach((item) => {
      const normalized = WORKSPACE_NORMALIZER.normalize(item.workspaceId)
      ids.add(normalized)
    })
    return Array.from(ids)
  },
} as const
