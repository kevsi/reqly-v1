"use client";

import type { ComponentType, SVGProps } from "react";
import {
  Bot,
  Cpu,
  Sparkles,
  Globe,
  BrainCircuit,
  Server,
  Puzzle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AIProvider } from "@/lib/types";
import { OpenaiIcon } from "@/components/icons/openai";
import { AnthropicIcon } from "@/components/icons/anthropic";
import { OpenrouterIcon } from "@/components/icons/openrouter";
import { GeminiIcon } from "@/components/icons/gemini";
import { OllamaIcon } from "@/components/icons/ollama";
import { OpencodeIcon } from "@/components/icons/opencode";
import { GrokIcon } from "@/components/icons/grok";
import { DeepseekIcon } from "@/components/icons/deepseek";
import { useTranslation } from "react-i18next";

export interface ProviderInfo {
  value: AIProvider;
  label: string;
  descriptionKey: string;
  /** Brand SVG icon component (falls back to `fallbackIcon` when absent) */
  brandIcon?: ComponentType<SVGProps<SVGSVGElement>>;
  /** Fallback Lucide icon when no brandIcon is available */
  fallbackIcon: LucideIcon;
  gradient: string;
}

export const PROVIDER_INFOS: ProviderInfo[] = [
  {
    value: "openai",
    label: "OpenAI",
    descriptionKey: "settings.ai.providers.openai.description",
    brandIcon: OpenaiIcon,
    fallbackIcon: Sparkles,
    gradient: "from-emerald-500/20 to-emerald-600/10",
  },
  {
    value: "anthropic",
    label: "Anthropic",
    descriptionKey: "settings.ai.providers.anthropic.description",
    brandIcon: AnthropicIcon,
    fallbackIcon: BrainCircuit,
    gradient: "from-amber-500/20 to-amber-600/10",
  },
  {
    value: "openrouter",
    label: "OpenRouter",
    descriptionKey: "settings.ai.providers.openrouter.description",
    brandIcon: OpenrouterIcon,
    fallbackIcon: Globe,
    gradient: "from-blue-500/20 to-blue-600/10",
  },
  {
    value: "gemini",
    label: "Gemini",
    descriptionKey: "settings.ai.providers.gemini.description",
    brandIcon: GeminiIcon,
    fallbackIcon: Bot,
    gradient: "from-violet-500/20 to-violet-600/10",
  },
  {
    value: "deepseek",
    label: "DeepSeek",
    descriptionKey: "settings.ai.providers.deepseek.description",
    brandIcon: DeepseekIcon,
    fallbackIcon: Cpu,
    gradient: "from-cyan-500/20 to-cyan-600/10",
  },
  {
    value: "grok",
    label: "Grok",
    descriptionKey: "settings.ai.providers.grok.description",
    brandIcon: GrokIcon,
    fallbackIcon: BrainCircuit,
    gradient: "from-neutral-500/20 to-neutral-600/10",
  },
  {
    value: "ollama",
    label: "Ollama",
    descriptionKey: "settings.ai.providers.ollama.description",
    brandIcon: OllamaIcon,
    fallbackIcon: Server,
    gradient: "from-orange-500/20 to-orange-600/10",
  },
  {
    value: "opencode-zen",
    label: "Opencode Zen",
    descriptionKey: "settings.ai.providers.opencodeZen.description",
    brandIcon: OpencodeIcon,
    fallbackIcon: Puzzle,
    gradient: "from-rose-500/20 to-rose-600/10",
  },
  {
    value: "custom",
    label: "Custom Provider",
    descriptionKey: "settings.ai.providers.custom.description",
    fallbackIcon: Puzzle,
    gradient: "from-slate-500/20 to-slate-600/10",
  },
];

interface AiProviderCardProps {
  info: ProviderInfo;
  isSelected: boolean;
  isConfigured: boolean;
  onClick: () => void;
  className?: string;
}

export function AiProviderCard({
  info,
  isSelected,
  isConfigured,
  onClick,
  className,
}: AiProviderCardProps) {
  const FallbackIcon = info.fallbackIcon;
  const BrandIcon = info.brandIcon;
  const { t } = useTranslation();

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex w-full flex-col items-center gap-3 rounded-xl border p-5 text-center transition-all duration-200",
        "hover:shadow-md hover:border-primary/40",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        isSelected
          ? "border-primary/60 bg-primary/5 shadow-sm"
          : "border-border bg-card hover:bg-accent/30",
        className,
      )}
    >
      {/* Gradient background */}
      <div
        className={cn(
          "absolute inset-0 rounded-xl opacity-0 transition-opacity duration-200",
          "group-hover:opacity-100",
          isSelected ? "opacity-100" : "",
          `bg-gradient-to-br ${info.gradient}`,
        )}
        aria-hidden="true"
      />

      {/* Icon: PNG image or Lucide fallback */}
      <div
        className={cn(
          "relative z-10 flex size-12 items-center justify-center rounded-xl transition-colors duration-200 overflow-hidden",
          isSelected ? "bg-primary/15" : "bg-muted group-hover:bg-primary/10",
        )}
      >
        {BrandIcon ? (
          <BrandIcon className="max-h-7 max-w-7 h-auto w-auto" aria-label={info.label} />
        ) : (
          <FallbackIcon
            className={cn(
              "size-6",
              isSelected ? "text-primary" : "text-muted-foreground group-hover:text-primary",
            )}
          />
        )}
      </div>

      {/* Label */}
      <div className="relative z-10 space-y-1">
        <span
          className={cn(
            "block text-sm font-semibold",
            isSelected ? "text-primary" : "text-foreground",
          )}
        >
          {info.label}
        </span>
        <span className="block text-xs text-muted-foreground leading-snug">
          {t(info.descriptionKey)}
        </span>
      </div>

      {/* Configured badge */}
      {isConfigured && (
        <div className="relative z-10">
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-medium text-primary">
            <span className="size-1.5 rounded-full bg-primary" />
            {t("settings.ai.configured")}
          </span>
        </div>
      )}
    </button>
  );
}
