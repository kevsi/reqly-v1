"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { RequestTab } from "@/lib/request-executor";
import { useTranslation } from "react-i18next";

interface RequestUnsavedCloseDialogProps {
  pendingTab: RequestTab | null;
  onOpenChange: (open: boolean) => void;
  onDiscard: () => void;
  onSave?: () => void;
}

export function RequestUnsavedCloseDialog({
  pendingTab,
  onOpenChange,
  onDiscard,
  onSave,
}: RequestUnsavedCloseDialogProps) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={!!pendingTab} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("requestUnsaved.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {pendingTab && t("requestUnsaved.description", { name: pendingTab.name })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          {onSave && (
            <AlertDialogAction
              onClick={onSave}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {t("common.save")}
            </AlertDialogAction>
          )}
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onDiscard}
          >
            {t("common.discard")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
