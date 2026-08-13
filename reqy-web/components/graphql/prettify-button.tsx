"use client";
import { Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

interface Props {
  onClick: () => void;
  disabled?: boolean;
}

export function PrettifyButton({ onClick, disabled }: Props) {
  const { t } = useTranslation();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      data-testid="graphql-prettify-button"
    >
      <Wand2 className="w-3 h-3 mr-1" />
      {t("graphql.toolbar.prettify")}
    </Button>
  );
}
