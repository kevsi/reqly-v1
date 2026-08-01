/**
 * Phase 5.6 — Language detection + prompt adaptation
 *
 * Detects whether input text is French, English, or unknown via a
 * stopword-frequency heuristic. No ML — fast and deterministic.
 *
 * Adapts the generated prompt by appending a "respond in <lang>" hint
 * so the LLM echoes the user's language.
 */

const FR_STOPWORDS = new Set([
  "le", "la", "les", "un", "une", "des", "de", "du",
  "et", "est", "sont", "je", "tu", "il", "elle", "nous", "vous", "ils", "elles",
  "ce", "cette", "ces", "mon", "ton", "son", "ma", "ta", "sa", "mes", "tes", "ses",
  "avec", "sans", "pour", "dans", "sur", "sous", "entre", "contre",
  "avant", "après", "depuis", "pendant",
  "très", "plus", "moins", "aussi", "encore", "déjà", "jamais", "toujours",
  "souvent", "parfois", "peut-être", "peut", "être", "avoir",
  "français", "france", "paris", "où", "quoi", "qui", "que", "quel", "quelle",
  "comment", "pourquoi", "combien",
]);

const EN_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were",
  "i", "you", "he", "she", "it", "we", "they",
  "this", "that", "these", "those",
  "my", "your", "his", "her", "its", "our", "their",
  "with", "without", "for", "in", "on", "at", "under", "between", "against",
  "before", "after", "since", "during",
  "very", "more", "less", "also", "still", "already", "never", "always",
  "often", "sometimes", "maybe", "can", "be", "have",
  "where", "what", "who", "when", "why", "how", "which",
]);

export type Language = "fr" | "en" | "unknown";

/** Normalize text for stopword counting (lowercase + split on word boundaries). */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .split(/[^a-z]+/)
    .filter((t) => t.length > 1);
}

/** Heuristic stopword-frequency language detection. */
export function detectLanguage(text: string): Language {
  if (!text || text.length < 10) return "unknown";
  const tokens = tokenize(text);
  if (tokens.length === 0) return "unknown";

  let fr = 0;
  let en = 0;
  for (const t of tokens) {
    if (FR_STOPWORDS.has(t)) fr++;
    if (EN_STOPWORDS.has(t)) en++;
  }

  const total = fr + en;
  if (total === 0) return "unknown";

  // Need a minimum signal (≥2 stopword hits) to be confident
  if (total < 2) return "unknown";

  // If one side has <40% of the signal, prefer the other
  if (fr / total >= 0.7) return "fr";
  if (en / total >= 0.7) return "en";

  // Otherwise ambiguous — return the dominant one
  return fr > en ? "fr" : "en";
}

/** Returns an instruction to inject into the LLM prompt for a given language. */
export function languageInstruction(lang: Language): string | null {
  switch (lang) {
    case "fr":
      return null; // default system prompt is already in French
    case "en":
      return "Respond to the user's question in English.";
    case "unknown":
    default:
      return null;
  }
}

/** Adapt a generated prompt by appending a language directive. */
export function adaptPromptForLanguage(prompt: string, lang: Language): string {
  const instruction = languageInstruction(lang);
  if (!instruction) return prompt;
  return `${prompt}\n\n${instruction}`;
}

/** Convenience: detect language and adapt in one call. */
export function adaptToQuestionLanguage(userQuestion: string, prompt: string): string {
  const lang = detectLanguage(userQuestion);
  return adaptPromptForLanguage(prompt, lang);
}
