"use client";

import { useEffect, type ReactNode } from "react";
import i18n, { DEFAULT_LANGUAGE, isLanguage } from "@/src/i18n";
import { useRequestStore } from "@/hooks/use-request-store";

/**
 * Syncs the persisted store language into the i18next instance.
 *
 * Hydration strategy: i18next initializes to `fr` by default, which matches
 * both the static-export HTML and the client's first render, so there is no
 * mismatch. Once the store has loaded, we switch to the persisted language;
 * react-i18next re-renders every translated component.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const language = useRequestStore((s) => s.language);
  const isLoaded = useRequestStore((s) => s.isLoaded);

  useEffect(() => {
    if (!isLoaded) return;
    const lang = isLanguage(language) ? language : DEFAULT_LANGUAGE;
    void i18n.changeLanguage(lang).then(() => {
      document.documentElement.lang = lang;
    });
  }, [language, isLoaded]);

  return <>{children}</>;
}
