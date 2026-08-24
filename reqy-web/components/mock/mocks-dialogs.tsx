"use client";

import { useRequestStore } from "@/hooks/use-request-store";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { MockConfig } from "@reqly/mock-engine";
import { useTranslation } from "react-i18next";
import { collectionsToMockConfig } from "@/lib/mock/convert";
import type { MockSuccessTitle } from "./use-mock-routes";
import { CollectionsGenerateModal } from "./collections-generate-modal";

const K = {
  apply: "mocks.actions.apply",
  replaceTitle: "mocks.replace.title",
  replaceDesc: "mocks.replace.description",
  resetConfirmTitle: "mocks.status.resetConfirmTitle",
  resetConfirmDesc: "mocks.status.resetConfirmDesc",
  resetStateLabel: "mocks.status.resetStateLabel",
  generatedToast: "mocks.generate.generatedToast",
  deleteTitle: "mocks.routes.deleteTitle",
  deleteManyTitle: "mocks.bulk.deleteTitle",
  deleteDescMany: "mocks.bulk.deleteDesc",
  bulkRemove: "mocks.bulk.remove",
} as const;

interface MocksDialogsProps {
  generateOpen: boolean;
  onGenerateOpenChange: (open: boolean) => void;
  config: MockConfig | null;
  requestReplace: (next: MockConfig, successTitle?: MockSuccessTitle | null) => void;
  pendingReplace: { next: MockConfig; successTitle: MockSuccessTitle | null } | null;
  onPendingReplaceOpenChange: (open: boolean) => void;
  onDoReplace: (next: MockConfig, successTitle?: MockSuccessTitle | null) => void;
  resetOpen: boolean;
  onResetOpenChange: (open: boolean) => void;
  onReset: () => void;
  deleteTarget: string[] | null;
  deleteTargetDescription: string | null;
  onDeleteDialogOpenChange: (open: boolean) => void;
  onConfirmDelete: () => void;
}

/** Every confirmation / generation dialog of the mocks page, in one place. */
export function MocksDialogs({
  generateOpen,
  onGenerateOpenChange,
  config,
  requestReplace,
  pendingReplace,
  onPendingReplaceOpenChange,
  onDoReplace,
  resetOpen,
  onResetOpenChange,
  onReset,
  deleteTarget,
  deleteTargetDescription,
  onDeleteDialogOpenChange,
  onConfirmDelete,
}: MocksDialogsProps) {
  const { t } = useTranslation();
  const collections = useRequestStore((s) => s.collections);

  return (
    <>
      <CollectionsGenerateModal
        open={generateOpen}
        onOpenChange={onGenerateOpenChange}
        onConfirm={(ids) => {
          const selectedCollections = ids
            .map((id) => collections.find((c) => c.id === id))
            .filter((c) => c !== undefined);
          if (selectedCollections.length === 0) return;
          const next = collectionsToMockConfig(selectedCollections, {
            name: config?.name,
            port: config?.port ?? 4015,
            cors: true,
          });
          // Le toast de succès est déclenché par doReplace, après remplacement effectif.
          requestReplace(next, { key: K.generatedToast, fallback: "Routes générées" });
        }}
      />

      <ConfirmDialog
        open={pendingReplace !== null}
        onOpenChange={onPendingReplaceOpenChange}
        title={t(K.replaceTitle, { defaultValue: "Remplacer les routes actuelles ?" })}
        description={t(K.replaceDesc, {
          defaultValue: "Les {{count}} routes existantes seront remplacées par la nouvelle config.",
          count: config?.routes.length ?? 0,
        })}
        confirmLabel={t(K.apply, { defaultValue: "Appliquer au mock" })}
        variant="default"
        onConfirm={() => {
          if (pendingReplace) onDoReplace(pendingReplace.next, pendingReplace.successTitle);
          onPendingReplaceOpenChange(false);
        }}
      />

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={onResetOpenChange}
        title={t(K.resetConfirmTitle, { defaultValue: "Réinitialiser l'état du mock ?" })}
        description={t(K.resetConfirmDesc, {
          defaultValue: "Toutes les ressources stateful enregistrées seront effacées.",
        })}
        confirmLabel={t(K.resetStateLabel, { defaultValue: "Reset state" })}
        onConfirm={onReset}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={onDeleteDialogOpenChange}
        title={
          deleteTarget && deleteTarget.length > 1
            ? t(K.deleteManyTitle, { defaultValue: "Supprimer les routes sélectionnées ?" })
            : t(K.deleteTitle, { defaultValue: "Supprimer cette route ?" })
        }
        description={
          deleteTargetDescription ??
          t(K.deleteDescMany, {
            defaultValue: "{{count}} routes seront définitivement supprimées.",
            count: deleteTarget?.length ?? 0,
          })
        }
        confirmLabel={t(K.bulkRemove, { defaultValue: "Supprimer" })}
        onConfirm={onConfirmDelete}
      />
    </>
  );
}
