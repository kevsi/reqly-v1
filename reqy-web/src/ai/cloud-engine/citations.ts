/**
 * Phase 5.7 — Citations of specs in LLM responses
 *
 * Extracts a deduplicated, user-friendly list of source citations from
 * retrieved knowledge chunks. Used to render "Sources:" badges below
 * LLM answers in the chat UI.
 */

export interface Citation {
  /** Source identifier (e.g. "rfc-9110", "mdn-http"). */
  source: string;
  /** Human-readable label (defaults to source if not provided). */
  label: string;
  /** Short snippet from the chunk (one line, truncated). */
  snippet: string;
  /** Optional URL or anchor for the citation. */
  url?: string;
  /** Optional RRF score (higher = more relevant). */
  score?: number;
}

export interface CitationChunkLike {
  source: string;
  content: string;
  metadata?: Record<string, unknown>;
  score?: number;
}

const MAX_SNIPPET_CHARS = 120;
const MAX_CITATIONS = 5;

/** Truncate content at the first sentence boundary, then hard-cap. */
function firstSentence(s: string): string {
  const trimmed = s.trim().replace(/\s+/g, " ");
  const stop = /[.!?](?=\s|$)/;
  const m = trimmed.match(stop);
  if (m && m.index !== undefined) {
    return trimmed.slice(0, m.index + 1);
  }
  if (trimmed.length <= MAX_SNIPPET_CHARS) return trimmed;
  return trimmed.slice(0, MAX_SNIPPET_CHARS - 1).trimEnd() + "…";
}

/**
 * Extract a deduplicated, ranked list of citations from chunks.
 * - Dedup by source (keep highest-scoring chunk per source)
 * - Sort by score (desc), then by snippet length (desc) as tiebreaker
 * - Cap to MAX_CITATIONS
 */
export function extractCitations(chunks: CitationChunkLike[]): Citation[] {
  const bySource = new Map<string, CitationChunkLike>();
  for (const c of chunks) {
    const existing = bySource.get(c.source);
    if (!existing || (c.score ?? 0) > (existing.score ?? 0)) {
      bySource.set(c.source, c);
    }
  }

  const sorted = Array.from(bySource.values()).sort((a, b) => {
    const sa = a.score ?? 0;
    const sb = b.score ?? 0;
    if (sa !== sb) return sb - sa;
    return b.content.length - a.content.length;
  });

  return sorted.slice(0, MAX_CITATIONS).map((c) => ({
    source: c.source,
    label: prettyLabel(c.source, c.metadata),
    snippet: firstSentence(c.content),
    url: typeof c.metadata?.url === "string" ? c.metadata.url : undefined,
    score: c.score,
  }));
}

/** Convert source id to a human-friendly label. */
function prettyLabel(source: string, metadata?: Record<string, unknown>): string {
  if (metadata && typeof metadata.title === "string") return metadata.title;
  // "rfc-9110" → "RFC 9110"
  if (/^rfc-\d+/i.test(source)) {
    return "RFC " + source.slice(4);
  }
  // "iana-status-codes" → "IANA Status Codes"
  return source
    .split(/[-_]/)
    .map((s) => (s.length <= 4 ? s.toUpperCase() : s[0].toUpperCase() + s.slice(1)))
    .join(" ");
}

/** Group citations by source family for compact display. */
export function groupCitationsByFamily(citations: Citation[]): Record<string, Citation[]> {
  const groups: Record<string, Citation[]> = {};
  for (const c of citations) {
    const family = c.source.split("-")[0];
    if (!groups[family]) groups[family] = [];
    groups[family].push(c);
  }
  return groups;
}
