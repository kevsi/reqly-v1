"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface FocusScopeProps {
  children: ReactNode;
  className?: string;
  /** Appelé à la fermeture (Escape géré par la pile de la sidebar). */
  onEscape?: () => void;
  "data-testid"?: string;
}

/**
 * Conteneur d'overlay accessible : focus initial dans le scope, piège Tab,
 * restitution du focus au démontage. Léger, sans dépendance Radix.
 */
export function FocusScope({ children, className, onEscape, ...rest }: FocusScopeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const el = containerRef.current;
    // Focus le premier élément focusable, sinon le conteneur lui-même.
    const focusables = el?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    (focusables?.[0] ?? el)?.focus();
    return () => {
      previousFocusRef.current?.focus?.();
    };
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onEscape?.();
      return;
    }
    if (e.key !== "Tab") return;
    // Piège Tab : cycle parmi les focusables du scope.
    const el = containerRef.current;
    if (!el) return;
    const focusables = Array.from(
      el.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select, textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((n) => n.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={containerRef}
      className={cn("outline-none", className)}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      {...rest}
    >
      {children}
    </div>
  );
}
