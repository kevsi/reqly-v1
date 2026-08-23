"use client";

import { useEffect, useState, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import i18n, { DEFAULT_LANGUAGE, isLanguage } from "@/src/i18n";
import { useRequestStore } from "@/hooks/use-request-store";

/**
 * Syncs the persisted store language into the i18next instance.
 *
 * Hydration strategy: i18next initializes to `fr` by default, which matches
 * both the static-export HTML and the client's first render.
 *
 * The initial render must have the same structure on the server and client.
 * The persisted language is applied after the store has loaded, while the
 * default French copy remains visible during persistence startup.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const language = useRequestStore((s) => s.language);
  const isLoaded = useRequestStore((s) => s.isLoaded);

  // Track if we've synchronized language to prevent FOUC
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    if (!isLoaded) return;

    const lang = isLanguage(language) ? language : DEFAULT_LANGUAGE;
    void i18n.changeLanguage(lang).then(() => {
      document.documentElement.lang = lang;
      // Mark hydration complete after language is synced
      setIsHydrated(true);
    });
  }, [language, isLoaded]);

  return (
    <I18nextProvider i18n={i18n}>
      <div
        aria-busy={!isLoaded}
        className="contents"
        data-language-ready={isHydrated ? "true" : "false"}
      >
        {children}
      </div>
    </I18nextProvider>
  );
}
