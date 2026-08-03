"use client";

import { useRef, type ReactNode, type MouseEvent } from "react";

interface SpotlightCardProps {
  children: ReactNode;
  className?: string;
}

/**
 * Carte avec un halo qui suit la souris.
 * Pilote les variables CSS --spot-x / --spot-y utilisées par l'utilitaire
 * `spotlight-card` défini dans globals.css.
 */
export function SpotlightCard({ children, className = "" }: SpotlightCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  const onMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--spot-x", `${((e.clientX - rect.left) / rect.width) * 100}%`);
    el.style.setProperty("--spot-y", `${((e.clientY - rect.top) / rect.height) * 100}%`);
  };

  return (
    <div ref={ref} onMouseMove={onMouseMove} className={`spotlight-card ${className}`}>
      {children}
    </div>
  );
}
