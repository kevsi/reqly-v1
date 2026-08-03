"use client"

import { useState } from "react"
import { Loader2, RefreshCw, Search, Plus, Check, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Command,
  CommandList,
  CommandEmpty,
} from "@/components/ui/command"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import type { AIProvider } from "@/lib/types"
import { ANTHROPIC_NO_FETCH } from "@/lib/provider-models"
import type { ModelOption } from "@/lib/provider-models"

interface ModelSearchListProps {
  models: ModelOption[]
  selectedModelId: string
  onModelSelect: (id: string) => void
  provider: AIProvider
  isCustom: boolean
  onFetchModels: () => void
  fetchingModels: boolean
  modelsFetched: boolean
  apiKey: string
  baseUrl: string
  /** Called when user adds a manual model ID (custom providers only) */
  onAddModel?: (modelId: string) => void
  /** Called when user removes a manually-added model */
  onRemoveModel?: (modelId: string) => void
}

export function ModelSearchList({
  models,
  selectedModelId,
  onModelSelect,
  provider,
  isCustom,
  onFetchModels,
  fetchingModels,
  modelsFetched,
  apiKey,
  baseUrl,
  onAddModel,
  onRemoveModel,
}: ModelSearchListProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [manualModelInput, setManualModelInput] = useState("")

  const filteredModels = models.filter(
    (m) =>
      m.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.label.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  const selectedModelObj = models.find((m) => m.id === selectedModelId)

  const canFetchModels = Boolean(
    !fetchingModels &&
      (provider === "ollama" || ANTHROPIC_NO_FETCH.has(provider) || apiKey) &&
      (!isCustom || baseUrl.trim()),
  )

  const handleAddManual = () => {
    const id = manualModelInput.trim()
    if (!id) return
    if (models.some((m) => m.id === id)) {
      toast.info("Ce modèle existe déjà dans la liste.")
      setManualModelInput("")
      return
    }
    onAddModel?.(id)
    setManualModelInput("")
  }

  const handleRemoveModel = (modelId: string) => {
    onRemoveModel?.(modelId)
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <label className="text-sm font-medium text-foreground">
          Modèle{isCustom ? "s" : ""}
        </label>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            disabled={!canFetchModels}
            onClick={onFetchModels}
            title={
              ANTHROPIC_NO_FETCH.has(provider)
                ? "Cet éditeur n'expose pas d'endpoint public"
                : !apiKey
                  ? "Entrez une clé API pour activer le chargement"
                  : "Charger la liste depuis l'API"
            }
          >
            {fetchingModels ? (
              <>
                <Loader2 className="mr-1.5 size-3 animate-spin" />
                Chargement...
              </>
            ) : (
              <>
                <RefreshCw className="mr-1.5 size-3" />
                Charger
              </>
            )}
          </Button>
          {isCustom && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddManual}
              disabled={!manualModelInput.trim()}
            >
              <Plus className="mr-1 size-3" />
              Ajouter
            </Button>
          )}
        </div>
      </div>

      {/* Manual model input (only for custom) */}
      {isCustom && (
        <div className="mb-3">
          <div className="flex gap-2">
            <Input
              value={manualModelInput}
              onChange={(e) => setManualModelInput(e.target.value)}
              placeholder="Entrez un ID de modèle manuellement..."
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  handleAddManual()
                }
              }}
            />
          </div>
        </div>
      )}

      {/* Selected model badge */}
      {selectedModelObj && (
        <div className="mb-3">
          <Badge
            variant="secondary"
            className="flex items-center gap-1 px-3 py-1 text-xs"
          >
            <Check className="size-3" />
            {selectedModelObj.label}
            <button
              type="button"
              onClick={() => onModelSelect("")}
              className="ml-1 rounded-full hover:bg-muted-foreground/20 p-0.5"
            >
              <X className="size-2.5" />
            </button>
          </Badge>
        </div>
      )}

      {/* Model search list */}
      <div className="rounded-lg border border-border overflow-hidden">
        <Command className="rounded-lg">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search className="size-4 shrink-0 opacity-50" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher un modèle..."
              className="flex h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          <CommandList>
            {models.length === 0 && !fetchingModels && (
              <CommandEmpty>
                <div className="flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground">
                  <Search className="size-8 opacity-30" />
                  {modelsFetched
                    ? "Aucun modèle trouvé"
                    : isCustom
                      ? "Chargez les modèles depuis l'API ou ajoutez-en manuellement"
                      : "Cliquez sur « Charger » pour récupérer les modèles"}
                </div>
              </CommandEmpty>
            )}

            {fetchingModels && models.length === 0 && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {filteredModels.length > 0 && (
              <ScrollArea className="h-48">
                <div className="p-1 space-y-0.5">
                  {filteredModels.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onModelSelect(m.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                        selectedModelId === m.id
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-foreground hover:bg-accent",
                      )}
                    >
                      <div
                        className={cn(
                          "flex size-4 shrink-0 items-center justify-center rounded-full border",
                          selectedModelId === m.id
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground/30",
                        )}
                      >
                        {selectedModelId === m.id && (
                          <Check className="size-3" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="truncate font-medium">
                          {m.label}
                        </div>
                        {m.id !== m.label && (
                          <div className="truncate text-xs text-muted-foreground">
                            {m.id}
                          </div>
                        )}
                      </div>
                      {isCustom && onRemoveModel && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRemoveModel(m.id)
                          }}
                          className="shrink-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100"
                          title="Retirer"
                        >
                          <X className="size-3.5" />
                        </button>
                      )}
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CommandList>
        </Command>
      </div>

      <p className="mt-1.5 text-xs text-muted-foreground">
        {isCustom
          ? "Ajoutez des modèles manuellement ou chargez-les depuis l'API."
          : provider === "anthropic"
            ? "Anthropic n'expose pas d'endpoint public. Utilisez la liste statique."
            : "Laissez vide pour utiliser le modèle par défaut."}
      </p>
    </div>
  )
}
