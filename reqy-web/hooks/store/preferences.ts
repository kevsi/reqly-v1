import type { Language } from "@/src/i18n";
import { CommitFn } from "./types";

export function createPreferencesMutations(commit: CommitFn) {
  const setLanguage = (language: Language) => {
    commit((prev) => ({ ...prev, language }));
  };

  return { setLanguage };
}
