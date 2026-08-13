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
import type { GraphqlTab } from "@/lib/types";
import { useTranslation } from "react-i18next";

interface GraphqlUnsavedCloseDialogProps {
  pendingTab: GraphqlTab | null;
  onOpenChange: (open: boolean) => void;
  onDiscard: () => void;
}

export function GraphqlUnsavedCloseDialog({
  pendingTab,
  onOpenChange,
  onDiscard,
}: GraphqlUnsavedCloseDialogProps) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={!!pendingTab} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("graphql.unsavedDialog.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("graphql.unsavedDialog.description", { name: pendingTab?.name })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("graphql.unsavedDialog.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onDiscard}
          >
            {t("graphql.unsavedDialog.discard")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
