"use client";
import { useCallback, useMemo, useState } from "react";
import { buildCommandMenu, type SlashCommand } from "@/src/ai/agent/commands";
import { searchContextTargets } from "@/src/ai/agent/context-picker";
import type { ContextAttachment } from "@/src/ai/agent/types";

export function useAiAgentInput(
  commands: SlashCommand[],
  onRunCommand: (name: string, args: string) => void,
) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<ContextAttachment[]>([]);
  const [commandQuery, setCommandQuery] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);

  const commandResults = useMemo(
    () => (commandQuery === null ? [] : buildCommandMenu(commandQuery, commands)),
    [commandQuery, commands],
  );
  const mentionResults = useMemo(
    () => (mentionQuery === null ? [] : searchContextTargets(mentionQuery)),
    [mentionQuery],
  );

  const handleChange = useCallback((next: string) => {
    setValue(next);
    const tokens = next.split(/\s/);
    const last = tokens[tokens.length - 1];
    if (next === "/" || (last.startsWith("/") && tokens.length === 1)) {
      setCommandQuery(last.slice(1));
      setMentionQuery(null);
    } else if (last.startsWith("@")) {
      setMentionQuery(last.slice(1));
      setCommandQuery(null);
    } else {
      setCommandQuery(null);
      setMentionQuery(null);
    }
  }, []);

  const acceptCommand = useCallback(
    (name: string) => {
      onRunCommand(name, "");
      setValue("");
      setCommandQuery(null);
    },
    [onRunCommand],
  );

  const acceptMention = useCallback((att: ContextAttachment) => {
    setAttachments((prev) => (prev.some((a) => a.id === att.id) ? prev : [...prev, att]));
    setValue((prev) => prev.replace(/@\S*$/, " "));
    setMentionQuery(null);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clear = useCallback(() => {
    setValue("");
    setCommandQuery(null);
    setMentionQuery(null);
  }, []);

  return {
    value,
    setValue,
    handleChange,
    clear,
    attachments,
    removeAttachment,
    commandResults,
    mentionResults,
    acceptCommand,
    acceptMention,
    commandQuery,
    mentionQuery,
  };
}
