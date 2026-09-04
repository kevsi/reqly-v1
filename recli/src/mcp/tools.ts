import type { CollectionStore } from "./store.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ExportBundle } from "./types.js";
import type { ToolHandlerOptions } from "./tool-definitions.js";

import {
  handleListCollections,
  handleCreateCollection,
  handleUpdateCollection,
  handleDeleteCollection,
  handleDuplicateCollection,
} from "./handlers/collections.js";
import {
  handleListRequests,
  handleGetCollectionTree,
  handleGetRequest,
  handleCreateRequest,
  handleGenerateRequestFromDescription,
  handleUpdateRequest,
  handleDeleteRequest,
  handleDuplicateRequest,
  handleImportFromCurl,
  handleExportRequestToCurl,
  handleSearchRequests,
  handleMoveRequest,
  handleReorderRequests,
  handleValidateRequest,
  handleCreateFolder,
  handleUpdateFolder,
  handleDeleteFolder,
} from "./handlers/requests.js";
import {
  handleListEnvironments,
  handleResolveVariables,
  handleGetEnvironmentVariables,
  handleCreateEnvironment,
  handleUpdateEnvironment,
  handleDeleteEnvironment,
  handleDuplicateEnvironment,
} from "./handlers/environments.js";
import {
  handleRunRequest,
  handleRunCollection,
  handleRunRequestsBatch,
  handleRunCollectionWithAssertions,
  handleGetRequestHistory,
  handleGetRunHistory,
} from "./handlers/runner.js";
import {
  handleExportBundle,
  handleImportBundle,
  handleImportFromOpenApi,
  handleExportToOpenApi,
  handleExportCollectionToJUnit,
  handleAnalyzeProjectRoutes,
  handleGraphQlExecute,
} from "./handlers/import-export.js";
import { handleGenerateTests } from "./handlers/generate-tests.js";
import { handleOpenApiSync } from "./handlers/import-export.js";

export type { Tool } from "./tool-definitions.js";
export { listTools } from "./tool-definitions.js";

export function createToolHandler(
  store: CollectionStore,
  bundle: ExportBundle | undefined,
  options: ToolHandlerOptions,
) {
  return async function handleToolCall(
    name: string,
    args: Record<string, unknown>,
    progressToken?: string | number,
  ): Promise<CallToolResult> {
    switch (name) {
      case "list_collections":
        return handleListCollections(store);
      case "create_collection":
        return handleCreateCollection(store, args);
      case "update_collection":
        return handleUpdateCollection(store, args);
      case "delete_collection":
        return handleDeleteCollection(store, args);
      case "duplicate_collection":
        return handleDuplicateCollection(store, args);

      case "list_requests":
        return handleListRequests(store, args);
      case "get_collection_tree":
        return handleGetCollectionTree(store, args);
      case "get_request":
        return handleGetRequest(store, args);
      case "generate_request_from_description":
        return handleGenerateRequestFromDescription(store, args);
      case "create_request":
        return handleCreateRequest(store, args);
      case "update_request":
        return handleUpdateRequest(store, args);
      case "delete_request":
        return handleDeleteRequest(store, args);
      case "duplicate_request":
        return handleDuplicateRequest(store, args);
      case "import_from_curl":
        return handleImportFromCurl(store, args);
      case "export_request_to_curl":
        return handleExportRequestToCurl(store, args);
      case "search_requests":
        return handleSearchRequests(store, args);
      case "move_request":
        return handleMoveRequest(store, args);
      case "reorder_requests":
        return handleReorderRequests(store, args);
      case "validate_request":
        return handleValidateRequest(store, args);

      case "create_folder":
        return handleCreateFolder(store, args);
      case "update_folder":
        return handleUpdateFolder(store, args);
      case "delete_folder":
        return handleDeleteFolder(store, args);

      case "run_request":
        return await handleRunRequest(store, args, bundle, options);
      case "run_collection":
        return await handleRunCollection(store, args, bundle, options, progressToken);
      case "run_requests_batch":
        return await handleRunRequestsBatch(store, args, bundle, options, progressToken);
      case "run_collection_with_assertions":
        return await handleRunCollectionWithAssertions(store, args, bundle, options, progressToken);
      case "get_request_history":
        return handleGetRequestHistory(store, args);
      case "get_run_history":
        return handleGetRunHistory(store, args);

      case "list_environments":
        return handleListEnvironments(store);
      case "resolve_variables":
        return handleResolveVariables(store, args);
      case "get_environment_variables":
        return handleGetEnvironmentVariables(store, args);
      case "create_environment":
        return handleCreateEnvironment(store, args);
      case "update_environment":
        return handleUpdateEnvironment(store, args);
      case "delete_environment":
        return handleDeleteEnvironment(store, args);
      case "duplicate_environment":
        return handleDuplicateEnvironment(store, args);

      case "export_bundle":
        return handleExportBundle(store, bundle);
      case "import_bundle":
        return handleImportBundle(store, args);
      case "import_from_openapi":
        return handleImportFromOpenApi(store, args);
      case "export_to_openapi":
        return handleExportToOpenApi(store);
      case "export_collection_to_junit":
        return handleExportCollectionToJUnit(store, args);
      case "analyze_project_routes":
        return await handleAnalyzeProjectRoutes(store, args);
      case "graphql_execute":
        return await handleGraphQlExecute(args, options);
      case "generate_tests":
        return handleGenerateTests(store, args);
      case "openapi_sync":
        return await handleOpenApiSync(store, args, options);

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  };
}
