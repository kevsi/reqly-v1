"use client";

import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ThemeCards } from "./theme-cards";
import { AccentPicker } from "./accent-picker";
import { AnimationsToggle } from "./animations-toggle";
import { LanguageSelect } from "../language-select";

export function ApparenceSection() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">{t("settings.apparence.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("settings.apparence.description")}</p>
      </div>

      <Card>
        <CardContent className="space-y-6 pt-6">
          <ThemeCards />
          <Separator />
          <AccentPicker />
          <Separator />
          <AnimationsToggle />
          <Separator />
          <LanguageSelect />
        </CardContent>
      </Card>
    </div>
  );
}
