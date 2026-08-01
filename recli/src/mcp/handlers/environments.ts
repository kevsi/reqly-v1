import type { CollectionStore } from "../store.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function handleListEnvironments(store: CollectionStore): CallToolResult {
  const envs = store.getEnvironments().map((e) => ({
    id: e.id,
    name: e.name,
    variable_count: e.variables?.length ?? 0,
    color: e.color,
  }));
  return { content: [{ type: "text", text: JSON.stringify(envs, null, 2) }] };
}

export function handleResolveVariables(
  store: CollectionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const textToResolve = String(args.text ?? "");
  const resolveEnvName = String(args.env_name ?? "");
  if (!textToResolve || !resolveEnvName) {
    return { content: [{ type: "text", text: "Missing required fields: text, env_name" }], isError: true };
  }
  const env = store.getEnvironment(resolveEnvName);
  if (!env) {
    return { content: [{ type: "text", text: `Environment not found: ${resolveEnvName}` }], isError: true };
  }
  const resolved = textToResolve.replace(/\{\{([^}]+)\}\}/g, (_match, varName) => {
    const key = varName.trim();
    const variable = env.variables?.find((v) => v.key === key && v.enabled);
    return variable?.value ?? `{{${key}}}`;
  });
  return {
    content: [{ type: "text", text: JSON.stringify({ original: textToResolve, resolved, env_name: resolveEnvName }, null, 2) }],
  };
}

export function handleGetEnvironmentVariables(
  store: CollectionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const envName = String(args.env_name ?? "");
  if (!envName) {
    return { content: [{ type: "text", text: "Missing required field: env_name" }], isError: true };
  }
  const env = store.getEnvironment(envName);
  if (!env) {
    return { content: [{ type: "text", text: `Environment not found: ${envName}` }], isError: true };
  }
  return { content: [{ type: "text", text: JSON.stringify({ name: env.name, variables: env.variables ?? [] }, null, 2) }] };
}

export function handleCreateEnvironment(
  store: CollectionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const envName = String(args.name ?? "");
  if (!envName) {
    return { content: [{ type: "text", text: "Missing required field: name" }], isError: true };
  }
  const color = args.color ? String(args.color) : undefined;
  const env = store.addEnvironment(envName, color);
  return {
    content: [{ type: "text", text: JSON.stringify({ created: true, environment_id: env.id, name: env.name }, null, 2) }],
  };
}

export function handleUpdateEnvironment(
  store: CollectionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const envId = String(args.env_id ?? "");
  if (!envId) {
    return { content: [{ type: "text", text: "Missing required field: env_id" }], isError: true };
  }
  const updates: Record<string, unknown> = {};
  if (args.name !== undefined) updates.name = String(args.name);
  if (args.color !== undefined) updates.color = String(args.color);
  if (args.variables !== undefined) updates.variables = args.variables;
  store.updateEnvironment(envId, updates);
  return { content: [{ type: "text", text: JSON.stringify({ updated: true, environment_id: envId }) }] };
}

export function handleDeleteEnvironment(
  store: CollectionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const envId = String(args.env_id ?? "");
  if (!envId) {
    return { content: [{ type: "text", text: "Missing required field: env_id" }], isError: true };
  }
  store.deleteEnvironment(envId);
  return { content: [{ type: "text", text: JSON.stringify({ deleted: true, environment_id: envId }) }] };
}

export function handleDuplicateEnvironment(
  store: CollectionStore,
  args: Record<string, unknown>,
): CallToolResult {
  const envId = String(args.env_id ?? "");
  if (!envId) {
    return { content: [{ type: "text", text: "Missing required field: env_id" }], isError: true };
  }
  const newEnv = store.duplicateEnvironment(envId);
  return { content: [{ type: "text", text: JSON.stringify({ duplicated: true, new_environment_id: newEnv?.id }, null, 2) }] };
}
