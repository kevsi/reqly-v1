"use client";

import { Trash2 } from "lucide-react";
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
import { useTranslation } from "react-i18next";

export interface PendingDelete {
  label: string;
  onConfirm: () => void;
}

interface DeleteConfirmDialogProps {
  pendingDelete: PendingDelete | null;
  onClose: () => void;
}

export function DeleteConfirmDialog({ pendingDelete, onClose }: DeleteConfirmDialogProps) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-destructive/10">
              <Trash2 className="size-4 text-destructive" />
            </span>
            {t("collections.deleteDialog.title")}
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <p>{pendingDelete?.label}</p>
            <p className="font-medium text-destructive/80 text-sm">
              {t("collections.deleteDialog.irreversible")}
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="text-xs">
            {t("collections.deleteDialog.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-xs"
            onClick={() => {
              pendingDelete?.onConfirm();
              onClose();
            }}
          >
            {t("collections.deleteDialog.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
