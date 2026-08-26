"use client";

/**
 * Outils IA read-only autour de Git (debug assisté). Tous passent par le
 * GitService courant via git-ai-bridge — aucun effet de bord, aucune écriture.
 */
import { requireGitService } from "./git-ai-bridge";
import type { ReqlyTool, ToolResult } from "@/lib/llm-tools";

const MAX_STATUS_FILES = 100;
const MAX_DIFF_FILES = 30;
const MAX_HUNK_LINES_PER_FILE = 60;

async function handleGitStatus(): Promise<ToolResult> {
  const resolved = requireGitService();
  if ("error" in resolved) {
    return { callId: "", name: "git_status", content: "", error: resolved.error };
  }
  const state = resolved.service.getState();
  const files = state.status.slice(0, MAX_STATUS_FILES).map((f) => ({
    file: f.filepath,
    staged: f.staged !== 1,
    modifiedInWorkdir: f.workdir === 2,
    deleted: f.head === 1 && f.workdir === 0,
    untracked: f.head === 0,
    conflicted: f.conflicted,
  }));
  return {
    callId: "",
    name: "git_status",
    content: JSON.stringify({
      repoPath: state.repoPath,
      branch: state.currentBranch || null,
      totalChanged: state.status.length,
      truncated: state.status.length > MAX_STATUS_FILES,
      files,
    }),
  };
}

async function handleGitBranches(): Promise<ToolResult> {
  const resolved = requireGitService();
  if ("error" in resolved) {
    return { callId: "", name: "git_branches", content: "", error: resolved.error };
  }
  const state = resolved.service.getState();
  return {
    callId: "",
    name: "git_branches",
    content: JSON.stringify({
      current: state.currentBranch || null,
      remotes: state.remotes,
      branches: state.branches.map((b) => ({
        name: b.name,
        isCurrent: b.isCurrent,
        upstream: b.upstream ?? null,
        ahead: b.ahead,
        behind: b.behind,
      })),
    }),
  };
}

async function handleGitDiff(args: Record<string, unknown>): Promise<ToolResult> {
  const resolved = requireGitService();
  if ("error" in resolved) {
    return { callId: "", name: "git_diff", content: "", error: resolved.error };
  }
  const service = resolved.service;
  const commits = service.getState().commits;
  const oldOid =
    typeof args.oldOid === "string" && args.oldOid
      ? args.oldOid
      : commits.length >= 2
        ? commits[1]!.oid
        : null;
  if (!oldOid) {
    return {
      callId: "",
      name: "git_diff",
      content: "",
      error:
        "Impossible de déterminer la base du diff : passe oldOid explicite ou fais au moins deux commits.",
    };
  }
  const newOid = typeof args.newOid === "string" && args.newOid ? args.newOid : "WORKING";
  try {
    const files = await service.diff(oldOid, newOid);
    const truncated = files.length > MAX_DIFF_FILES;
    const payload = files.slice(0, MAX_DIFF_FILES).map((f) => ({
      file: f.filepath,
      hunks: f.hunks.map((hunk) => ({
        oldStart: hunk.oldStart,
        newStart: hunk.newStart,
        lines: hunk.lines.slice(0, MAX_HUNK_LINES_PER_FILE).map((line) => ({
          origin: line.origin,
          content: line.content,
        })),
      })),
    }));
    return {
      callId: "",
      name: "git_diff",
      content: JSON.stringify({ base: oldOid, target: newOid, truncated, files: payload }),
    };
  } catch (err) {
    return {
      callId: "",
      name: "git_diff",
      content: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const GIT_AI_TOOLS: ReqlyTool[] = [
  {
    name: "git_status",
    title: "Statut Git",
    description:
      "Liste les fichiers modifiés/staged/non-suivis du dépôt Git ouvert dans Reqly, avec la branche courante.",
    parameters: {},
    handler: handleGitStatus,
  },
  {
    name: "git_branches",
    title: "Branches Git",
    description:
      "Liste les branches locales, la branche courante, les remotes et les compteurs ahead/behind.",
    parameters: {},
    handler: handleGitBranches,
  },
  {
    name: "git_diff",
    title: "Diff Git",
    description:
      "Diff entre deux révisions du dépôt ouvert. Par défaut : commit parent → working directory. Champs newOid=\"WORKING\" supporté.",
    parameters: {
      oldOid: { type: "string", description: "OID de base (défaut : commit précédent)." },
      newOid: {
        type: "string",
        description: 'OID cible, ou "WORKING" pour le répertoire de travail (défaut).',
      },
    },
    handler: handleGitDiff,
  },
];
