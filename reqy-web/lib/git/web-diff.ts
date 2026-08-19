// ── Diff de lignes (web) ───────────────────────────────────────────────
// isomorphic-git n'embarque pas de diff ligne à ligne : on calcule ici un
// diff LCS simple et on le formate dans le même schéma que le backend Tauri
// (DiffFile / DiffHunk / DiffLine).

import type { DiffFile, DiffHunk, DiffLine } from "./types";

function splitLines(text: string): string[] {
  const lines = text.split("\n");
  // Le split produit une ligne vide finale si le texte se termine par \n.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Diff LCS entre deux textes → liste d'opérations avec numéros de ligne. */
function computeOps(oldText: string, newText: string): DiffLine[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const n = a.length;
  const m = b.length;

  // Table LCS (DP) — O(n*m), acceptable pour des fichiers JSON de collections.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ origin: "context", content: a[i], oldLineno: i + 1, newLineno: j + 1 });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ origin: "delete", content: a[i], oldLineno: i + 1, newLineno: null });
      i++;
    } else {
      ops.push({ origin: "add", content: b[j], oldLineno: null, newLineno: j + 1 });
      j++;
    }
  }
  while (i < n) {
    ops.push({ origin: "delete", content: a[i], oldLineno: i + 1, newLineno: null });
    i++;
  }
  while (j < m) {
    ops.push({ origin: "add", content: b[j], oldLineno: null, newLineno: j + 1 });
    j++;
  }
  return ops;
}

/** Regroupe les opérations en hunks (avec 3 lignes de contexte de part et d'autre). */
function buildHunks(ops: DiffLine[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let idx = 0;
  const len = ops.length;

  while (idx < len) {
    // Ignorer le contexte de tête
    while (idx < len && ops[idx].origin === "context") idx++;
    if (idx >= len) break;

    // Début du hunk : jusqu'à 3 lignes de contexte avant
    const start = Math.max(0, idx - 3);

    // Fin du hunk : la run de changements + jusqu'à 3 lignes de contexte après
    let end = idx;
    while (end < len && ops[end].origin !== "context") end++;
    end = Math.min(len, end + 3);

    const lines = ops.slice(start, end);
    const first = lines[0];
    const oldStart = first.oldLineno ?? first.newLineno ?? 1;
    const newStart = first.newLineno ?? first.oldLineno ?? 1;

    let oldLines = 0;
    let newLines = 0;
    for (const l of lines) {
      if (l.origin === "add") newLines++;
      else if (l.origin === "delete") oldLines++;
      else {
        oldLines++;
        newLines++;
      }
    }

    hunks.push({ oldStart, oldLines, newStart, newLines, lines });
    idx = end;
  }

  return hunks;
}

/** Diff ligne à ligne entre deux contenus → hunks. */
export function diffText(oldText: string, newText: string): DiffHunk[] {
  if (oldText === newText) return [];
  return buildHunks(computeOps(oldText, newText));
}

/** Construit un DiffFile vide (fichier ajouté/supprimé sans contenu comparé). */
export function emptyDiffFile(filepath: string): DiffFile {
  return { filepath, hunks: [] };
}
