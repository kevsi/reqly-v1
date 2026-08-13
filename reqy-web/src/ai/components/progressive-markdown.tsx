"use client";

import { useEffect, useRef } from "react";
import { AiMarkdown } from "@/src/ai/components/ai-markdown";
import { useProgressiveText } from "@/src/ai/hooks/use-progressive-text";
import type { ParsedCodeRequest } from "@/src/ai/agent/code-request";

interface ProgressiveMarkdownProps {
  content: string;
  className?: string;
  /** Appelé à chaque fois que le texte affiché évolue (utilisé pour l’auto-scroll). */
  onTextChange?: () => void;
  onExecuteRequest?: (request: ParsedCodeRequest) => void;
}

/**
 * Affiche une réponse IA en markdown avec une révélation progressive du texte,
 * à la manière de ChatGPT/Claude (les mots apparaissent un à un).
 *
 * Le composant est un intermédiaire entre le contenu brut (qui peut arriver
 * d'un bloc ou token par token) et `AiMarkdown`, qui reste inchangé.
 */
export function ProgressiveMarkdown({
  content,
  className,
  onTextChange,
  onExecuteRequest,
}: ProgressiveMarkdownProps) {
  const display = useProgressiveText(content);
  const lastDisplay = useRef(display);

  useEffect(() => {
    if (display !== lastDisplay.current) {
      lastDisplay.current = display;
      onTextChange?.();
    }
  }, [display, onTextChange]);

  return <AiMarkdown content={display} className={className} onExecuteRequest={onExecuteRequest} />;
}
