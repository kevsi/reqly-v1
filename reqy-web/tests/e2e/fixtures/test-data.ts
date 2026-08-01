export const sampleRequest = {
  name: "GET mock endpoint",
  method: "GET" as const,
  url: "/mock",
  headers: [],
  bodyType: "none" as const,
  authType: "none" as const,
}

export const sampleCollection = {
  name: "Test Collection",
  description: "Smoke test collection",
  requests: [sampleRequest],
}

export const sampleEnvironment = {
  name: "Test Env",
  variables: [
    { key: "baseUrl", value: "http://127.0.0.1:MOCK_PORT_PLACEHOLDER", enabled: true },
  ],
}
