"use client";

import { Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Collection } from "@/hooks/use-request-store";

interface RequestSaveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  onNameChange: (name: string) => void;
  collectionId: string;
  onCollectionIdChange: (id: string) => void;
  collections: Collection[];
  onSubmit: () => void;
}

export function RequestSaveDialog({
  open,
  onOpenChange,
  name,
  onNameChange,
  collectionId,
  onCollectionIdChange,
  collections,
  onSubmit,
}: RequestSaveDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("saveDialog.title")}</DialogTitle>
          <DialogDescription>{t("saveDialog.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <label htmlFor="save-name" className="text-sm font-medium text-foreground">
              {t("saveDialog.nameLabel")}
            </label>
            <Input
              id="save-name"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder={t("saveDialog.namePlaceholder")}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSubmit();
              }}
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <label htmlFor="save-collection" className="text-sm font-medium text-foreground">
              {t("saveDialog.collectionLabel")}
            </label>
            <Select value={collectionId} onValueChange={onCollectionIdChange}>
              <SelectTrigger id="save-collection" className="w-full">
                <SelectValue placeholder={t("saveDialog.noCollection")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("saveDialog.drafts")}</SelectItem>
                {collections
                  .filter((col) => col.name !== "Brouillons")
                  .map((col) => (
                    <SelectItem key={col.id} value={col.id}>
                      {col.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={onSubmit}>
            <Save className="mr-2 size-4" />
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
