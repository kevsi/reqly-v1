"use client";

import { useTranslation } from "react-i18next";

import type { Language } from "@/src/i18n";
import { SUPPORTED_LANGUAGES } from "@/src/i18n";
import { useRequestStore } from "@/hooks/use-request-store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function LanguageSelect() {
  const { t } = useTranslation();
  const language = useRequestStore((s) => s.language);
  const setLanguage = useRequestStore((s) => s.setLanguage);

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <h3 className="text-sm font-medium">{t("settings.apparence.language")}</h3>
        <p className="text-xs text-muted-foreground">
          {t("settings.apparence.languageDescription")}
        </p>
      </div>
      <Select value={language} onValueChange={(value) => setLanguage(value as Language)}>
        <SelectTrigger className="w-[180px]" aria-label={t("common.language")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SUPPORTED_LANGUAGES.map((lang) => (
            <SelectItem key={lang.value} value={lang.value}>
              {lang.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
