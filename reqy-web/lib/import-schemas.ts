import { z } from "zod"

const httpMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])

export const requestItemSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  method: httpMethodSchema,
  url: z.string(),
  endpoint: z.string(),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
  bodyType: z.enum(["json", "form-data", "x-www-form", "raw", "binary"]).optional(),
  authType: z.enum(["none", "bearer", "basic", "api-key", "oauth2"]).optional(),
  authToken: z.string().optional(),
  queryParams: z
    .array(z.object({ key: z.string(), value: z.string() }))
    .optional(),
  folderId: z.string().nullable().optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
})

export const collectionSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
  requests: z.array(requestItemSchema).default([]),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
})

export const environmentVariableSchema = z.object({
  key: z.string(),
  value: z.string(),
  enabled: z.boolean(),
})

export const environmentSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  color: z.string().optional(),
  variables: z.array(environmentVariableSchema).default([]),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
})

export const variableMappingSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  sourceRequestId: z.string(),
  sourcePath: z.string(),
  enabled: z.boolean().optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
})

export const exportBundleSchema = z.object({
  version: z.string().optional(),
  exportedAt: z.string().optional(),
  collections: z.array(collectionSchema),
  environments: z.array(environmentSchema),
  variableMappings: z.array(variableMappingSchema).optional(),
})

export const postmanImportBodySchema = z.object({
  collectionId: z.string().min(1),
})

export const postmanRouteSchema = z.object({
  method: z.string(),
  path: z.string(),
  url: z.string().optional(),
  name: z.string().optional(),
  description: z.union([z.string(), z.array(z.unknown())]).optional(),
  sourceFile: z.string().optional(),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
  bodyType: z.enum(["json", "form-data", "x-www-form", "raw", "binary"]).optional(),
  authType: z.enum(["none", "bearer", "basic", "api-key", "oauth2"]).optional(),
  authToken: z.string().optional(),
  queryParams: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
})

export const postmanImportResponseSchema = z.object({
  name: z.string(),
  framework: z.string().optional(),
  language: z.string().optional(),
  routes: z.array(postmanRouteSchema),
  metadata: z
    .object({
      collectionId: z.string().optional(),
      description: z.string().optional(),
    })
    .optional(),
})

export const githubImportBodySchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().optional(),
  githubToken: z.string().optional(),
})

export const githubImportResponseSchema = z.object({
  name: z.string().optional(),
  framework: z.string().optional(),
  language: z.string().optional(),
  port: z.number().optional(),
  routes: z.array(
    z.object({
      method: z.string(),
      path: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      sourceFile: z.string().optional(),
      authRequired: z.boolean().optional(),
      authType: z.string().nullable().optional(),
      bodyType: z.string().optional(),
      confidence: z.string().optional(),
      controller: z.union([z.string(), z.null()]).optional(),
      middlewareChain: z.array(z.string()).optional(),
      reasonings: z.array(z.string()).optional(),
    }),
  ),
})

export const postmanExportBodySchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  requests: z.array(
    z.object({
      name: z.string().optional(),
      method: z.string().optional(),
      url: z.string().optional(),
      headers: z.record(z.string()).optional(),
      body: z.string().optional(),
    }),
  ),
})

export function formatZodError(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ")
}

export function resolveUniqueCollectionName(
  desiredName: string,
  existingNames: string[],
): string {
  const trimmed = desiredName.trim() || "Collection"
  if (!existingNames.some((name) => name.toLowerCase() === trimmed.toLowerCase())) {
    return trimmed
  }
  let index = 2
  while (existingNames.some((name) => name.toLowerCase() === `${trimmed} (${index})`.toLowerCase())) {
    index += 1
  }
  return `${trimmed} (${index})`
}
