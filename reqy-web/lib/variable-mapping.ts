import { extractValueFromResponse, extractValueFromResponsePipeline } from "@/lib/variable-path"
import type { VariableMapping, HistoryItem } from "@/lib/types"

export function resolveMappingValue(
  mapping: VariableMapping,
  history: HistoryItem[]
): { value: string; error?: string } {
  const sourceItem = history.find((item) => item.id === mapping.sourceRequestId)
  if (!sourceItem) {
    return { value: "", error: "Source request not found in history." }
  }
  if (!sourceItem.responseBody) {
    return { value: "", error: "No response recorded for this request." }
  }

  // Blob responses are binary — JSON path extraction is not applicable
  if (sourceItem.responseBody instanceof Blob) {
    return { value: "", error: "Response is binary (Blob). Variable extraction requires a text/JSON response." }
  }

  return extractValueFromResponse(sourceItem.responseBody, mapping.sourcePath)
}

export function resolveMappingValuePipeline(
  mapping: VariableMapping,
  history: HistoryItem[]
): { value: string; error?: string } {
  const sourceItem = history.find((item) => item.id === mapping.sourceRequestId)
  if (!sourceItem) {
    return { value: "", error: "Source request not found in history." }
  }
  if (sourceItem.responseBody instanceof Blob) {
    return { value: "", error: "Response is binary (Blob); pipeline extraction requires text/JSON/XML." }
  }
  if (!sourceItem.responseBody) {
    return { value: "", error: "No response recorded for this request." }
  }

  return extractValueFromResponsePipeline(sourceItem.responseBody, mapping.sourcePath)
}

export function getUnresolvedWarnings(
  variableMappings: VariableMapping[],
  history: HistoryItem[],
  options?: { usePipeline?: boolean }
): { name: string; error: string }[] {
  const usePipeline = options?.usePipeline ?? false
  const resolver = usePipeline ? resolveMappingValuePipeline : resolveMappingValue
  return variableMappings
    .filter((mapping) => mapping.enabled && mapping.name.trim())
    .map((mapping) => {
      const result = resolver(mapping, history)
      if (!result.error) return null
      return { name: mapping.name.trim(), error: result.error }
    })
    .filter((entry): entry is { name: string; error: string } => entry !== null)
}

export function computeDynamicVars(
  variableMappings: VariableMapping[],
  history: HistoryItem[],
  options?: { usePipeline?: boolean }
): { key: string; value: string; enabled: boolean }[] {
  const usePipeline = options?.usePipeline ?? false
  const resolver = usePipeline ? resolveMappingValuePipeline : resolveMappingValue
  return variableMappings
    .filter((mapping) => mapping.enabled && mapping.name.trim())
    .map((mapping) => {
      const result = resolver(mapping, history)
      return {
        key: mapping.name.trim(),
        value: result.error ? "" : result.value,
        enabled: true,
      }
    })
}
