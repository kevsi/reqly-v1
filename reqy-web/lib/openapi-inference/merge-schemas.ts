export function mergeInferredWithGeneric(
  inferred: Record<string, unknown>,
  generic: Record<string, unknown>
): Record<string, unknown> {
  if (JSON.stringify(inferred) === JSON.stringify(generic)) return inferred
  return { allOf: [generic, inferred] }
}
