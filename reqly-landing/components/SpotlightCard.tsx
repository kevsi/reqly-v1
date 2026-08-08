"use client";

import { useEffect, useRef, type ReactNode, type MouseEvent } from "react";

interface SpotlightCardProps {
  children: ReactNode;
  className?: string;
}

/**
 * Carte avec un halo qui suit la souris.
 * Pilote les variables CSS --spot-x / --spot-y utilisées par l'utilitaire
 * `spotlight-card` défini dans globals.css.
 *
 * Perf : les écritures de style sont limitées au rythme de requestAnimationFrame
 * (une seule par frame, aucune si la position n'a pas bougé de façon significative).
 */
export function SpotlightCard({ children, className = "" }: SpotlightCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef({ x: -1, y: -1 });
  const pendingRef = useRef({ clientX: 0, clientY: 0 });

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const onMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    pendingRef.current = { clientX: e.clientX, clientY: e.clientY };
    if (rafRef.current != null) return; // la frame programmée lira la valeur la plus fraîche
    // Lecture de layout (getBoundingClientRect) au plus une fois par frame,
    // jamais par événement de souris.
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const rect = el.getBoundingClientRect();
      const x = ((pendingRef.current.clientX - rect.left) / rect.width) * 100;
      const y = ((pendingRef.current.clientY - rect.top) / rect.height) * 100;
      // Ignore les micro-déplacements (< 0.5 %) : évite des repaints inutiles.
      if (Math.abs(x - lastRef.current.x) < 0.5 && Math.abs(y - lastRef.current.y) < 0.5) return;
      lastRef.current = { x, y };
      el.style.setProperty("--spot-x", `${x}%`);
      el.style.setProperty("--spot-y", `${y}%`);
    });
  };

  return (
    <div ref={ref} onMouseMove={onMouseMove} className={`spotlight-card ${className}`}>
      {children}
    </div>
  );
}
