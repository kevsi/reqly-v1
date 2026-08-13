"use client";

import { useEffect, useRef, useState } from "react";

export interface UseProgressiveTextOptions {
  /** Délai entre deux révélations (ms). Défaut : 20 ms. */
  delayMs?: number;
}

/**
 * Révèle progressivement le texte d'une réponse IA, à la manière de ChatGPT /
 * Claude : les mots apparaissent un à un au lieu d'arriver d'un bloc.
 *
 * Trois cas couverts :
 * - Streaming réel (SSE) : le contenu grandit token par token et la révélation
 *   suit le rythme (elle reste juste un mot derrière) ;
 * - Réponse complète d'un seul coup (Ollama, Anthropic, Gemini, Tauri…) : le
 *   texte est « tapé » mot à mot jusqu'à la fin ;
 * - Message monté avec un contenu déjà rempli (chargement d'un historique,
 *   réponse de commande, édition) : tout est affiché immédiatement — on ne
 *   « retape » pas les anciennes réponses.
 *
 * Aucun « saut » ne se produit en cas de pause du stream : la révélation
 * continue simplement à son rythme jusqu'à épuisement du contenu.
 */
export function useProgressiveText(content: string, options?: UseProgressiveTextOptions): string {
  const { delayMs = 20 } = options ?? {};

  // Si le message monte avec un contenu déjà rempli (historique, commande…),
  // tout est affiché immédiatement ; s'il monte vide (réponse en cours de
  // génération), la boucle ci-dessous révèle le texte mot à mot.
  const [revealed, setRevealed] = useState(() => content.length);

  const contentRef = useRef(content);
  const revealedRef = useRef(revealed);
  // Message déjà rempli au montage (historique, commande…) : pas de révélation.
  const mountedWithContent = useRef(content.length > 0);

  // Synchronise la ref après chaque rendu (jamais pendant le rendu).
  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  // Boucle de révélation : un mot (ou un début de ligne) par tick.
  useEffect(() => {
    if (mountedWithContent.current) return;

    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = () => {
      const current = contentRef.current;
      const r = revealedRef.current;

      if (r < current.length) {
        // Avance jusqu'au prochain mot (espace) ou retour à la ligne.
        const rest = current.slice(r + 1);
        const space = rest.indexOf(" ");
        const newline = rest.indexOf("\n");
        const cut = space === -1 ? newline : newline === -1 ? space : Math.min(space, newline);
        const target = cut === -1 ? current.length : r + 1 + cut + 1;

        revealedRef.current = target;
        setRevealed(target);
        timer = setTimeout(tick, delayMs);
      } else {
        // Contenu entièrement révélé : on repasse en veille (poll lent) pour
        // rattraper une éventuelle croissance ultérieure sans coût CPU.
        timer = setTimeout(tick, 500);
      }
    };

    timer = setTimeout(tick, delayMs);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [delayMs]);

  return content.slice(0, revealed);
}
