import type { Artifact } from "@/src/ai/components/ai-sidebar-types";

/**
 * Extraction d'artefacts depuis le markdown de réponse de l'assistant.
 *
 * Un bloc de code devient un artefact quand :
 *  - c'est du HTML (aperçu iframe possible), ou
 *  - il est suffisamment consistant (≥ 10 lignes ou ≥ 400 caractères).
 *
 * Le bloc est retiré du markdown affiché (la carte artefact le remplace),
 * comme dans l'interface Claude.
 */

const MIN_LINES = 10;
const MIN_CHARS = 400;

const DEFAULT_NAMES: Record<string, string> = {
  html: "document.html",
  css: "styles.css",
  js: "script.js",
  javascript: "script.js",
  ts: "script.ts",
  typescript: "script.ts",
  python: "script.py",
  py: "script.py",
  json: "data.json",
  bash: "script.sh",
  shell: "script.sh",
  sh: "script.sh",
  sql: "query.sql",
  jsx: "component.jsx",
  tsx: "component.tsx",
  yaml: "config.yaml",
  yml: "config.yaml",
  xml: "document.xml",
  markdown: "note.md",
  md: "note.md",
};

let artifactCounter = 0;

function defaultName(language: string, content: string): string {
  if (language === "html") {
    const titleMatch = content.match(/<title>([^<]{1,80})<\/title>/i);
    if (titleMatch) {
      const slug = titleMatch[1]
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (slug) return `${slug}.html`;
    }
    return "document.html";
  }
  return DEFAULT_NAMES[language] ?? `extrait-${language || "code"}.txt`;
}

export interface ExtractedArtifacts {
  /** Markdown nettoyé (blocs promus en artefacts retirés). */
  text: string;
  artifacts: Artifact[];
}

export function extractArtifacts(markdown: string): ExtractedArtifacts {
  const artifacts: Artifact[] = [];
  const text = markdown.replace(
    /```([\w+-]*)\n([\s\S]*?)```/g,
    (full: string, langRaw: string, body: string) => {
      const language = (langRaw || "").toLowerCase();
      const trimmedBody = body.replace(/\n$/, "");
      const lines = trimmedBody.split("\n").length;
      const isHtml = language === "html" || /^\s*<!doctype html/i.test(trimmedBody);
      const isBigEnough = lines >= MIN_LINES || trimmedBody.length >= MIN_CHARS;
      if (!isHtml && !isBigEnough) return full;
      // Déjà trop d'artefacts sur ce message : on garde le bloc en place.
      if (artifacts.length >= 4) return full;
      artifactCounter += 1;
      artifacts.push({
        id: `artifact-${Date.now().toString(36)}-${artifactCounter}`,
        title: defaultName(language, trimmedBody),
        kind: isHtml ? "html" : language === "markdown" || language === "md" ? "markdown" : "code",
        language: language || undefined,
        content: trimmedBody,
      });
      return "";
    },
  );

  return { text: text.replace(/\n{3,}/g, "\n\n").trim(), artifacts };
}
