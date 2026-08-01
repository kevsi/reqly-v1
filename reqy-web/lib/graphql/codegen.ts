export interface CodegenInput {
  endpoint: string
  query: string
  variables?: Record<string, unknown>
  operationName?: string
  headers?: Record<string, string>
}

export function generateFetchSnippet(input: CodegenInput): string {
  const payload = JSON.stringify(
    {
      query: input.query,
      variables: input.variables ?? {},
      operationName: input.operationName,
    },
    null,
    2,
  )
  const headerEntries = Object.entries(input.headers ?? {})
  const headerLines = headerEntries.length
    ? "\n" + headerEntries.map(([k, v]) => `    "${k}": "${v}",`).join("\n")
    : ""
  return `fetch("${input.endpoint}", {
  method: "POST",
  headers: {${headerLines}
    "Content-Type": "application/json",
    "Accept": "application/json",
  },
  body: JSON.stringify(${payload}),
})
  .then((res) => res.json())
  .then((data) => console.log(data))
  .catch((err) => console.error(err))`
}

export function generateCurlSnippet(input: CodegenInput): string {
  const payload = JSON.stringify({
    query: input.query,
    variables: input.variables ?? {},
    operationName: input.operationName,
  })
  const headerLines = Object.entries(input.headers ?? {})
    .map(([k, v]) => `  -H "${k}: ${v}" \\`)
    .join("\n")
  return `curl -X POST "${input.endpoint}" \\
  -H "Content-Type: application/json" \\
${headerLines ? headerLines + "\n" : ""}  -d '${payload}'`
}

export function generateTypeScriptStub(queryName: string, fields: string[]): string {
  const fieldLines = fields.length
    ? fields.map((f) => `  ${f}: unknown`).join("\n")
    : "  // no fields detected"
  return `interface ${queryName}Response {\n${fieldLines}\n}\n\n// Usage:\n// const data: ${queryName}Response = await sendGraphQL<${queryName}Response>()`
}
