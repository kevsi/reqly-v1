import { defineI18nUI } from "fumadocs-ui/i18n";

export const i18n = defineI18nUI(
  {
    defaultLanguage: "en",
    languages: ["en", "fr"],
  },
  {
    en: { displayName: "English" },
    fr: { displayName: "Français" },
  },
);

export type Lang = (typeof i18n)["languages"][number];

export function isLang(value: string): value is Lang {
  return i18n.languages.includes(value as Lang);
}
