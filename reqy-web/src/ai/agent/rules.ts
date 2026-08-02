import { persistence } from "@/lib/persistence";

export interface AiRuleFile {
  workspaceId: string;
  content: string;
  updatedAt: string;
}

const RULES_KEY_PREFIX = "ai-rules-";

export function loadRules(workspaceId: string): AiRuleFile | null {
  try {
    return persistence.getItem<AiRuleFile>(`${RULES_KEY_PREFIX}${workspaceId}`) ?? null;
  } catch {
    return null;
  }
}

export function saveRules(workspaceId: string, content: string): void {
  void persistence.setItem(`${RULES_KEY_PREFIX}${workspaceId}`, {
    workspaceId,
    content,
    updatedAt: new Date().toISOString(),
  } satisfies AiRuleFile);
}

export function buildRulesSystemPrompt(rules: AiRuleFile | null): string {
  if (!rules || !rules.content.trim()) return "";
  return `# Règles du workspace (AGENTS-like)\n${rules.content.trim()}`;
}
