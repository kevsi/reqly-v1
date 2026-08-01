export function extractExample(responseBody: unknown): unknown {
  if (responseBody === null || typeof responseBody !== "object") return responseBody
  if (Array.isArray(responseBody)) return responseBody[0] ?? null
  return responseBody
}
