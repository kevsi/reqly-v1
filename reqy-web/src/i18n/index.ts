import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import fr from "./locales/fr.json";
import en from "./locales/en.json";

export const DEFAULT_LANGUAGE = "fr";

export const SUPPORTED_LANGUAGES = [
  { value: "fr", label: "Français" },
  { value: "en", label: "English" },
] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number]["value"];

export function isLanguage(value: unknown): value is Language {
  return value === "fr" || value === "en";
}

void i18n.use(initReactI18next).init({
  resources: {
    fr: { translation: fr },
    en: { translation: en },
  },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
