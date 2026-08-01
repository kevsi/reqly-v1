"use client"

import { Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { Collection } from "@/hooks/use-request-store"

interface RequestSaveDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  onNameChange: (name: string) => void
  collectionId: string
  onCollectionIdChange: (id: string) => void
  collections: Collection[]
  onSubmit: () => void
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save request</DialogTitle>
          <DialogDescription>Name your request and choose whether to add it to a collection.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <label htmlFor="save-name" className="text-sm font-medium text-foreground">
              Request name
            </label>
            <Input
              id="save-name"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="My request"
              onKeyDown={(e) => {
                if (e.key === "Enter") onSubmit()
              }}
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <label htmlFor="save-collection" className="text-sm font-medium text-foreground">
              Collection (optional)
            </label>
            <Select value={collectionId} onValueChange={onCollectionIdChange}>
              <SelectTrigger id="save-collection" className="w-full">
                <SelectValue placeholder="No collection" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">📋 Drafts</SelectItem>
                {collections.filter((col) => col.name !== "Brouillons").map((col) => (
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
            Cancel
          </Button>
          <Button onClick={onSubmit}>
            <Save className="mr-2 size-4" />
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
