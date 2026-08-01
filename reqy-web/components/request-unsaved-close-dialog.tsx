"use client"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import type { RequestTab } from "@/lib/request-executor"

interface RequestUnsavedCloseDialogProps {
  pendingTab: RequestTab | null
  onOpenChange: (open: boolean) => void
  onDiscard: () => void
}

export function RequestUnsavedCloseDialog({
  pendingTab,
  onOpenChange,
  onDiscard,
}: RequestUnsavedCloseDialogProps) {
  return (
    <AlertDialog open={!!pendingTab} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
          <AlertDialogDescription>
            You have unsaved changes in &quot;{pendingTab?.name}&quot;. Do you want to discard them?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={onDiscard}>
            Discard
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
