"use client";

import { useState } from "react";
import Link from "next/link";
import { User, LogOut, Loader2 } from "lucide-react";
import { useSessionStore } from "@/lib/session-store";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export function AccountMenu() {
  const user = useSessionStore((s) => s.user);
  const status = useSessionStore((s) => s.status);
  const logout = useSessionStore((s) => s.logout);
  const [loggingOut, setLoggingOut] = useState(false);

  if (status !== "authenticated" || !user) {
    return (
      <Link
        href="/login"
        className="flex h-9 items-center rounded-lg border border-border px-3 text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground"
      >
        Se connecter
      </Link>
    );
  }

  const initial = (user.name?.[0] || user.email[0] || "?").toUpperCase();

  async function onLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Compte"
          data-testid="account-trigger"
          className="flex size-9 items-center justify-center rounded-full border border-border bg-muted/30 text-sm font-semibold text-foreground transition-all duration-200 hover:border-primary/30 hover:bg-primary/5"
          title={user.email}
        >
          {initial}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 animate-scale-in">
        <DropdownMenuLabel className="flex flex-col gap-0.5 px-3 py-2">
          <span className="truncate text-sm font-medium text-foreground">
            {user.name || user.email}
          </span>
          <span className="truncate text-xs text-muted-foreground">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={onLogout}
          disabled={loggingOut}
          className="cursor-pointer gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {loggingOut ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
          {loggingOut ? "Déconnexion…" : "Se déconnecter"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
