"use client";

import { useState } from "react";
import { Check, ChevronDown, Plus, Trash2, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { BranchInfo } from "@/hooks/use-git";

interface BranchBarProps {
  branches: BranchInfo[];
  currentBranch: string;
  onSwitch: (name: string) => void;
  onCreate: (name: string) => void;
  onDelete: (name: string) => void;
}

export function GitBranchBar({
  branches,
  currentBranch,
  onSwitch,
  onCreate,
  onDelete,
}: BranchBarProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");

  const handleCreate = () => {
    if (!newBranchName.trim()) return;
    onCreate(newBranchName.trim());
    setNewBranchName("");
    setDialogOpen(false);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs font-medium">
            <GitBranch className="size-3.5" />
            {currentBranch}
            <ChevronDown className="size-3 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {branches.map((b) => (
            <DropdownMenuItem
              key={b.name}
              onClick={() => {
                if (b.name !== currentBranch) onSwitch(b.name);
              }}
              className="flex items-center justify-between text-xs"
            >
              <span>{b.name}</span>
              <div className="flex items-center gap-2">
                {b.isCurrent && <Check className="size-3 text-primary" />}
                {(b.ahead !== 0 || b.behind !== 0) && (
                  <span className="text-[10px] text-muted-foreground">
                    ↑{b.ahead}↓{b.behind}
                  </span>
                )}
              </div>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setDialogOpen(true)} className="text-xs gap-2">
            <Plus className="size-3.5" />
            New branch
          </DropdownMenuItem>
          {branches.filter((b) => !b.isCurrent).length > 0 && (
            <>
              <DropdownMenuSeparator />
              {branches
                .filter((b) => !b.isCurrent)
                .map((b) => (
                  <DropdownMenuItem
                    key={`delete-${b.name}`}
                    onClick={() => onDelete(b.name)}
                    className="text-xs text-destructive gap-2"
                  >
                    <Trash2 className="size-3.5" />
                    Delete "{b.name}"
                  </DropdownMenuItem>
                ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Plus className="size-4" />
              Create branch
            </DialogTitle>
          </DialogHeader>
          <Input
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            placeholder="branch-name"
            className="text-sm"
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <DialogFooter>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDialogOpen(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={!newBranchName.trim()}
              className="text-xs"
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
