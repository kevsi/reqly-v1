"use client"

import { Trash2 } from "lucide-react"
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

export interface PendingDelete {
  label: string
  onConfirm: () => void
}

interface DeleteConfirmDialogProps {
  pendingDelete: PendingDelete | null
  onClose: () => void
}

export function DeleteConfirmDialog({ pendingDelete, onClose }: DeleteConfirmDialogProps) {
  return (
    <AlertDialog
      open={!!pendingDelete}
      onOpenChange={(open) => !open && onClose()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-destructive/10">
              <Trash2 className="size-4 text-destructive" />
            </span>
            Confirm deletion
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <p>{pendingDelete?.label}</p>
            <p className="font-medium text-destructive/80 text-sm">This action cannot be undone.</p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="text-xs">Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-xs"
            onClick={() => {
              pendingDelete?.onConfirm()
              onClose()
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
