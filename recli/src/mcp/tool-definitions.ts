export interface Tool {
  name: string;
  description: string;
  inputSchema: object;
}

export interface ToolHandlerOptions {
  defaultTimeoutMs: number;
  defaultEnvName?: string;
  allowLocalHosts?: boolean;
  maxResponseSize?: number;
  maxBatchSize?: number;
  maxConcurrency?: number;
}

export const DEFAULT_MAX_BATCH_SIZE = 20;
export const DEFAULT_MAX_CONCURRENCY = 5;

const TOOLS: Tool[] = [
  {
    name: "list_collections",
    description: "List all Reqly collections with their request counts",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_requests",
    description: "List all requests in a given collection",
    inputSchema: {
      type: "object",
      properties: { collection_id: { type: "string", description: "The ID of the collection" } },
      required: ["collection_id"],
    },
  },
  {
    name: "get_request",
    description: "Get full details of a specific request by ID",
    inputSchema: {
      type: "object",
      properties: { request_id: { type: "string", description: "The ID of the request" } },
      required: ["request_id"],
    },
  },
  {
    name: "run_request",
    description: "Execute a request by ID and return status, body, and timing",
    inputSchema: {
      type: "object",
      properties: {
        request_id: { type: "string", description: "The ID of the request to run" },
        timeout_ms: {
          type: "number",
          description: "Request timeout in milliseconds (default: 30000)",
        },
        env_name: {
          type: "string",
          description: "Optional environment name for variable interpolation",
        },
      },
      required: ["request_id"],
    },
  },
  {
    name: "create_collection",
    description: "Create a new collection",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the collection" },
        description: { type: "string", description: "Optional description" },
        color: {
          type: "string",
          description:
            "Optional color (slate, red, orange, amber, emerald, blue, indigo, violet, pink)",
        },
        icon: { type: "string", description: "Optional icon name" },
      },
      required: ["name"],
    },
  },
  {
    name: "create_request",
    description: "Create a new request in a collection",
    inputSchema: {
      type: "object",
      properties: {
        collection_id: {
          type: "string",
          description: "The ID of the collection to add the request to",
        },
        name: { type: "string", description: "Name of the request" },
        method: {
          type: "string",
          description: "HTTP method (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, GRAPHQL)",
        },
        url: { type: "string", description: "Request URL" },
        headers: { type: "object", description: "Optional headers object" },
        body: { type: "string", description: "Optional request body" },
        body_type: {
          type: "string",
          description: "Optional body type: json, form-data, x-www-form, raw, binary",
        },
        auth_type: {
          type: "string",
          description: "Optional auth type: none, bearer, basic, api-key, oauth2",
        },
        auth_token: { type: "string", description: "Optional auth token" },
        query_params: {
          type: "array",
          description: "Optional query parameters array of {key, value}",
        },
      },
      required: ["collection_id", "name", "method", "url"],
    },
  },
  {
    name: "import_from_curl",
    description: "Import a request from a curl command string into a collection",
    inputSchema: {
      type: "object",
      properties: {
        collection_id: { type: "string", description: "The collection ID to add the request to" },
        curl_command: { type: "string", description: "The curl command to parse" },
        name: { type: "string", description: "Optional request name (defaults to URL path)" },
      },
      required: ["collection_id", "curl_command"],
    },
  },
  {
    name: "export_request_to_curl",
    description: "Export a stored request to an equivalent curl command string",
    inputSchema: {
      type: "object",
      properties: { request_id: { type: "string", description: "The request ID" } },
      required: ["request_id"],
    },
  },
  {
    name: "search_requests",
    description: "Search requests by name, URL, or method",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Search query string" } },
      required: ["query"],
    },
  },
  {
    name: "update_collection",
    description: "Update an existing collection's name, description, color, or icon",
    inputSchema: {
      type: "object",
      properties: {
        collection_id: { type: "string", description: "The ID of the collection to update" },
        name: { type: "string", description: "New name" },
        description: { type: "string", description: "New description" },
        color: { type: "string", description: "New color" },
        icon: { type: "string", description: "New icon name" },
      },
      required: ["collection_id"],
    },
  },
  {
    name: "delete_collection",
    description: "Delete a collection and all its requests",
    inputSchema: {
      type: "object",
      properties: {
        collection_id: { type: "string", description: "The ID of the collection to delete" },
      },
      required: ["collection_id"],
    },
  },
  {
    name: "duplicate_collection",
    description: "Duplicate a collection with all its requests and folders",
    inputSchema: {
      type: "object",
      properties: {
        collection_id: { type: "string", description: "The ID of the collection to duplicate" },
      },
      required: ["collection_id"],
    },
  },
  {
    name: "update_request",
    description: "Update an existing request's fields (method, URL, headers, body, auth, etc.)",
    inputSchema: {
      type: "object",
      properties: {
        request_id: { type: "string", description: "The ID of the request to update" },
        name: { type: "string", description: "New name" },
        method: { type: "string", description: "New HTTP method" },
        url: { type: "string", description: "New URL" },
        headers: { type: "object", description: "New headers object" },
        body: { type: "string", description: "New request body" },
        body_type: { type: "string", description: "New body type" },
        auth_type: { type: "string", description: "New auth type" },
        auth_token: { type: "string", description: "New auth token" },
        query_params: { type: "array", description: "New query params array" },
        folder_id: { type: "string", description: "Move to folder (null to remove from folder)" },
        pre_request_script: { type: "string", description: "JavaScript to run before request" },
        post_response_script: { type: "string", description: "JavaScript to run after response" },
        protocol: { type: "string", description: "Protocol (rest or graphql)" },
      },
      required: ["request_id"],
    },
  },
  {
    name: "delete_request",
    description: "Delete a request by ID",
    inputSchema: {
      type: "object",
      properties: {
        request_id: { type: "string", description: "The ID of the request to delete" },
      },
      required: ["request_id"],
    },
  },
  {
    name: "duplicate_request",
    description: "Duplicate a request within the same or a different collection",
    inputSchema: {
      type: "object",
      properties: {
        request_id: { type: "string", description: "The ID of the request to duplicate" },
        target_collection_id: {
          type: "string",
          description: "Optional target collection ID (defaults to same collection)",
        },
      },
      required: ["request_id"],
    },
  },
  {
    name: "run_collection",
    description: "Run all requests in a collection sequentially and return results",
    inputSchema: {
      type: "object",
      properties: {
        collection_id: { type: "string", description: "The ID of the collection to run" },
        timeout_ms: { type: "number", description: "Per-request timeout in milliseconds" },
        env_name: { type: "string", description: "Environment name for variable interpolation" },
      },
      required: ["collection_id"],
    },
  },
  {
    name: "run_requests_batch",
    description: "Run multiple requests in parallel by their IDs",
    inputSchema: {
      type: "object",
      properties: {
        request_ids: {
          type: "array",
          description: "Array of request IDs to run",
          items: { type: "string" },
        },
        timeout_ms: { type: "number", description: "Per-request timeout in milliseconds" },
        env_name: { type: "string", description: "Environment name for variable interpolation" },
      },
      required: ["request_ids"],
    },
  },
  {
    name: "list_environments",
    description: "List all environments with their variable counts",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_collection_tree",
    description: "Get the full tree of a collection including folders and requests",
    inputSchema: {
      type: "object",
      properties: { collection_id: { type: "string", description: "The collection ID" } },
      required: ["collection_id"],
    },
  },
  {
    name: "resolve_variables",
    description: "Resolve {{variable}} placeholders in a string using an environment",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The text containing {{variable}} placeholders" },
        env_name: { type: "string", description: "The environment name" },
      },
      required: ["text", "env_name"],
    },
  },
  {
    name: "get_environment_variables",
    description: "Get resolved variables for a given environment (for debugging interpolation)",
    inputSchema: {
      type: "object",
      properties: { env_name: { type: "string", description: "The environment name" } },
      required: ["env_name"],
    },
  },
  {
    name: "create_environment",
    description: "Create a new environment",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Environment name" },
        color: { type: "string", description: "Optional color" },
      },
      required: ["name"],
    },
  },
  {
    name: "update_environment",
    description: "Update environment variables (add, modify, remove, toggle variables)",
    inputSchema: {
      type: "object",
      properties: {
        env_id: { type: "string", description: "The environment ID" },
        name: { type: "string", description: "New name" },
        color: { type: "string", description: "New color" },
        variables: {
          type: "array",
          description: "Array of {key, value, enabled} objects",
          items: { type: "object" },
        },
      },
      required: ["env_id"],
    },
  },
  {
    name: "delete_environment",
    description: "Delete an environment",
    inputSchema: {
      type: "object",
      properties: { env_id: { type: "string", description: "The environment ID" } },
      required: ["env_id"],
    },
  },
  {
    name: "export_bundle",
    description: "Export all collections, requests, folders, and environments as a JSON bundle",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "import_from_openapi",
    description: "Import collections and requests from an OpenAPI JSON or YAML spec",
    inputSchema: {
      type: "object",
      properties: { spec: { type: "string", description: "The OpenAPI JSON or YAML spec string" } },
      required: ["spec"],
    },
  },
  {
    name: "export_to_openapi",
    description: "Export all collections to an OpenAPI 3.0 JSON spec",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "import_bundle",
    description: "Import collections and requests from a JSON bundle",
    inputSchema: {
      type: "object",
      properties: {
        bundle_json: { type: "string", description: "JSON string of the export bundle" },
      },
      required: ["bundle_json"],
    },
  },
  {
    name: "create_folder",
    description: "Create a folder inside a collection to organize requests",
    inputSchema: {
      type: "object",
      properties: {
        collection_id: { type: "string", description: "The collection ID" },
        name: { type: "string", description: "Folder name" },
        parent_id: { type: "string", description: "Optional parent folder ID for nesting" },
      },
      required: ["collection_id", "name"],
    },
  },
  {
    name: "update_folder",
    description: "Rename or move a folder",
    inputSchema: {
      type: "object",
      properties: {
        folder_id: { type: "string", description: "The folder ID" },
        name: { type: "string", description: "New name" },
        parent_id: { type: "string", description: "New parent folder ID (null for root)" },
      },
      required: ["folder_id"],
    },
  },
  {
    name: "delete_folder",
    description: "Delete a folder (requests inside are unlinked but not deleted)",
    inputSchema: {
      type: "object",
      properties: { folder_id: { type: "string", description: "The folder ID" } },
      required: ["folder_id"],
    },
  },
  {
    name: "move_request",
    description: "Move a request to a different collection and/or folder",
    inputSchema: {
      type: "object",
      properties: {
        request_id: { type: "string", description: "The request ID to move" },
        target_collection_id: { type: "string", description: "Target collection ID" },
        target_folder_id: {
          type: "string",
          description: "Optional target folder ID (null for root)",
        },
      },
      required: ["request_id", "target_collection_id"],
    },
  },
  {
    name: "generate_request_from_description",
    description: "Generate a request definition from a plain-text description",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Plain-text description of the request" },
        collection_id: {
          type: "string",
          description: "Optional collection ID to save the generated request",
        },
        name: { type: "string", description: "Optional override name for the generated request" },
      },
      required: ["description"],
    },
  },
  {
    name: "validate_request",
    description: "Pre-flight validation of request fields without sending the request",
    inputSchema: {
      type: "object",
      properties: {
        request_id: { type: "string", description: "Validate an existing request by ID" },
        name: { type: "string", description: "Or validate ad-hoc: request name" },
        method: { type: "string", description: "Or validate ad-hoc: HTTP method" },
        url: { type: "string", description: "Or validate ad-hoc: URL" },
        body: { type: "string", description: "Or validate ad-hoc: request body" },
        body_type: { type: "string", description: "Or validate ad-hoc: body type" },
        auth_type: { type: "string", description: "Or validate ad-hoc: auth type" },
        auth_token: { type: "string", description: "Or validate ad-hoc: auth token" },
      },
    },
  },
  {
    name: "analyze_project_routes",
    description:
      "Analyze a local project folder and return detected HTTP routes (desktop mode only)",
    inputSchema: {
      type: "object",
      properties: {
        folder_path: { type: "string", description: "Absolute path to the project folder" },
        save_collection_id: {
          type: "string",
          description: "Optional collection ID to save generated requests",
        },
      },
      required: ["folder_path"],
    },
  },
  {
    name: "graphql_execute",
    description: "Execute a raw GraphQL query against an endpoint (not tied to a stored request)",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "GraphQL endpoint URL" },
        query: { type: "string", description: "GraphQL query string" },
        variables: { type: "object", description: "Optional GraphQL variables" },
        operation_name: { type: "string", description: "Optional operation name" },
        headers: { type: "object", description: "Optional extra headers" },
        timeout_ms: { type: "number", description: "Timeout in milliseconds" },
      },
      required: ["url", "query"],
    },
  },
  {
    name: "duplicate_environment",
    description: "Duplicate an environment with all its variables",
    inputSchema: {
      type: "object",
      properties: { env_id: { type: "string", description: "The environment ID to duplicate" } },
      required: ["env_id"],
    },
  },
  {
    name: "reorder_requests",
    description:
      "Reorder requests inside a collection by providing the full ordered list of request IDs",
    inputSchema: {
      type: "object",
      properties: {
        collection_id: { type: "string", description: "The collection ID" },
        ordered_request_ids: {
          type: "array",
          description: "Array of request IDs in the desired order",
          items: { type: "string" },
        },
      },
      required: ["collection_id", "ordered_request_ids"],
    },
  },
  {
    name: "run_collection_with_assertions",
    description:
      "Run all requests in a collection sequentially, evaluate assertions, and return a test report",
    inputSchema: {
      type: "object",
      properties: {
        collection_id: { type: "string", description: "The ID of the collection to run" },
        timeout_ms: { type: "number", description: "Per-request timeout in milliseconds" },
        env_name: { type: "string", description: "Environment name for variable interpolation" },
      },
      required: ["collection_id"],
    },
  },
  {
    name: "export_collection_to_junit",
    description: "Export the last run record of a collection as JUnit XML",
    inputSchema: {
      type: "object",
      properties: { collection_id: { type: "string", description: "The collection ID" } },
      required: ["collection_id"],
    },
  },
  {
    name: "get_request_history",
    description: "Get execution history for a specific request",
    inputSchema: {
      type: "object",
      properties: {
        request_id: { type: "string", description: "The request ID" },
        limit: { type: "number", description: "Maximum number of runs to return" },
      },
      required: ["request_id"],
    },
  },
  {
    name: "get_run_history",
    description: "Get recent collection run history, optionally filtered by collection",
    inputSchema: {
      type: "object",
      properties: {
        collection_id: { type: "string", description: "Optional collection ID filter" },
        limit: { type: "number", description: "Maximum number of runs to return" },
      },
    },
  },
  {
    name: "generate_tests",
    description:
      "Generate edge-case test requests from an OpenAPI spec (auth missing, invalid payloads, wrong types, 4xx scenarios)",
    inputSchema: {
      type: "object",
      properties: {
        spec: { type: "string", description: "OpenAPI 3 JSON or YAML spec content" },
        base_url: {
          type: "string",
          description: "Optional base URL override (defaults to spec's servers[0])",
        },
        save_collection_id: {
          type: "string",
          description: "Optional collection ID to save the generated tests into",
        },
      },
      required: ["spec"],
    },
  },
  {
    name: "openapi_sync",
    description:
      "Fetch an OpenAPI spec from a live server URL (or use provided content), import as a collection, optionally diff against a baseline spec",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            "URL to fetch the OpenAPI spec from (e.g. http://localhost:4000/openapi.json)",
        },
        spec_content: {
          type: "string",
          description: "Raw OpenAPI JSON/YAML content (alternative to url)",
        },
        save_collection_id: {
          type: "string",
          description: "Optional collection ID to save the imported requests",
        },
        diff_spec: {
          type: "string",
          description:
            "Optional baseline OpenAPI spec to diff against (shows added/removed/changed endpoints)",
        },
      },
    },
  },
];

export function listTools(): Tool[] {
  return TOOLS;
}
