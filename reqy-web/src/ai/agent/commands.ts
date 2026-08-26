import type { AgentMode } from "./types";

export interface SlashCommandContext {
  clearMessages: () => void;
  newSession: () => void;
  setMode: (mode: AgentMode) => void;
  openRules: () => void;
  openPermissions: () => void;
  /** Tronque RÉELLEMENT l'historique (garde les N derniers messages). */
  compact: () => void;
  exportSession: () => void;
  /** Ajoute une réponse texte de l'assistant (utilisée par /help). */
  reply: (text: string) => void;
}

export interface SlashCommand {
  name: string;
  description: string;
  usage: string;
  run: (args: string, ctx: SlashCommandContext) => void | Promise<void>;
}

export function parseSlashCommand(text: string): { name: string; args: string } | null {
  if (!text.startsWith("/")) return null;
  const trimmed = text.slice(1).trim();
  if (!trimmed) return null;
  const [rawName, ...rest] = trimmed.split(/\s+/);
  return { name: rawName.toLowerCase(), args: rest.join(" ") };
}

export function buildCommandMenu(query: string, commands: SlashCommand[]): SlashCommand[] {
  const q = query.toLowerCase();
  return commands
    .filter((c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q))
    .slice(0, 8);
}

function helpText(commands: SlashCommand[]): string {
  const lines = commands.map((c) => `${c.usage} — ${c.description}`).join("\n");
  return `## Commandes disponibles\n\n${lines}`;
}

export function createDefaultCommands(): SlashCommand[] {
  return [
    { name: "help", description: "Liste des commandes", usage: "/help", run: (args, ctx) => { void args; ctx.reply(helpText(createDefaultCommands())); } },
    { name: "clear", description: "Efface la conversation", usage: "/clear", run: (_a, c) => c.clearMessages() },
    { name: "new", description: "Nouvelle session", usage: "/new", run: (_a, c) => c.newSession() },
    { name: "plan", description: "Passe en mode plan (propose sans agir)", usage: "/plan", run: (_a, c) => c.setMode("plan") },
    { name: "act", description: "Passe en mode action (exécute)", usage: "/act", run: (_a, c) => c.setMode("act") },
    { name: "rules", description: "Ouvre les règles du workspace", usage: "/rules", run: (_a, c) => c.openRules() },
    { name: "permissions", description: "Ouvre les permissions d'outils", usage: "/permissions", run: (_a, c) => c.openPermissions() },
    { name: "compact", description: "Résume la conversation", usage: "/compact [n]", run: (args, c) => c.compact() },
    { name: "export", description: "Exporte la session", usage: "/export", run: (_a, c) => c.exportSession() },
  ];
}
