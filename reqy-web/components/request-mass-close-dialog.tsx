"use client";

/**
 * Confirmation dialog for mass tab closures (Close Others / Close to the
 * Right / Close All) when at least one tab has unsaved content.
 *
 * Rendered imperatively through a detached React root so the tabs state hook
 * can trigger it without threading dialog state through every consumer.
 * Mirrors RequestUnsavedCloseDialog visually (same AlertDialog primitives).
 */
import { createRoot, type Root } from "react-dom/client";
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
import i18n from "@/src/i18n";

let activeRoot: Root | null = null;
let activeContainer: HTMLDivElement | null = null;

function closeMassCloseDialog() {
  activeRoot?.unmount();
  activeRoot = null;
  activeContainer?.remove();
  activeContainer = null;
}

/**
 * Opens the mass-close confirmation. `onDiscard` runs only when the user
 * explicitly confirms; closing/canceling just discards the dialog itself.
 */
export function openRequestMassCloseConfirm(count: number, onDiscard: () => void): void {
  closeMassCloseDialog();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  activeRoot = root;
  activeContainer = container;

  root.render(
    <AlertDialog open onOpenChange={(open) => !open && closeMassCloseDialog()}>
      <AlertDialogContent data-testid="request-mass-close-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {i18n.t("requestUnsaved.massCloseTitle", {
              count,
              defaultValue: "{{count}} onglet(s) non sauvegardé(s)",
            })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {i18n.t("requestUnsaved.massCloseDescription", {
              defaultValue:
                "Fermer sans enregistrer ? Les modifications de ces onglets seront perdues.",
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{i18n.t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-testid="mass-close-discard"
            onClick={onDiscard}
          >
            {i18n.t("common.discard")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>,
  );
}
