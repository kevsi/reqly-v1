/**
 * Mock engine data model — a versionable JSON/YAML file is the source of truth
 * (committable in Git per the Reqly mock-server spec).
 */
export declare const MOCK_CONFIG_VERSION = 1;
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
/** How a request condition is checked. */
export interface MatchRule {
    /** Where to look. `body` uses a dot-path into the parsed JSON body. */
    target: "query" | "header" | "body";
    /** Parameter/field name. Dot-paths allowed for body ("user.address.city"). */
    name?: string;
    op: "equals" | "exists" | "missing" | "contains" | "regex";
    /** Expected value for equals/contains/regex. */
    value?: string;
}
export type SchemaFormat = "email" | "name" | "firstName" | "lastName" | "city" | "country" | "phone" | "url" | "uuid" | "date" | "date-time" | "price" | "ipv4" | "slug";
/**
 * Minimal schema description powering automatic realistic data generation.
 * Field names are ALSO inferred when `type`/`format` are absent
 * (e.g. a field called "email" generates an email).
 */
export interface BodySchema {
    type: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
    properties?: Record<string, BodySchema>;
    items?: BodySchema;
    required?: string[];
    enum?: Array<string | number | boolean>;
    format?: SchemaFormat;
    example?: unknown;
    /** String length bounds, number bounds, or array item-count bounds. */
    min?: number;
    max?: number;
    minItems?: number;
    maxItems?: number;
    pattern?: string;
}
export interface MockResponse {
    id: string;
    /** Human label shown in logs/UI. */
    name?: string;
    statusCode: number;
    headers?: Record<string, string>;
    /** Static body (string). Templating tokens are resolved per-request. */
    body?: string;
    /** Dynamic body generated from this schema (ignored when `body` is set). */
    schema?: BodySchema;
    /** When ALL rules pass, this response wins over the route default. */
    rules?: MatchRule[];
}
export interface LatencySpec {
    /** Fixed latency when min === max. Random uniform otherwise. */
    minMs: number;
    maxMs: number;
}
export type FailureKind = "status" | "timeout" | "reset" | "malformed";
export interface FailureSpec {
    /** Probability [0..1] that a request to this route fails. */
    probability: number;
    kind: FailureKind;
    /** For kind="status". Default 500. */
    statusCode?: number;
    /** For kind="timeout": how long to hang before destroying the socket. */
    timeoutMs?: number;
}
export interface StatefulSpec {
    enabled: boolean;
    /**
     * Resource bucket name. Defaults to the first non-param path segment
     * (e.g. `/api/users/:id` → "users").
     */
    resource?: string;
    /** Field carrying the resource id. Default "id". */
    idField?: string;
}
export interface MockRoute {
    id: string;
    /** Disabled routes are skipped by the matcher entirely. Default: true. */
    enabled?: boolean;
    method: Uppercase<HttpMethod> | Lowercase<HttpMethod>;
    /**
     * Path pattern supporting `:param` segments and a trailing `*splat`
     * (e.g. "/api/users/:id", "/files/*splat").
     */
    path: string;
    responses: MockResponse[];
    /** Used when no response rules match. Defaults to responses[0].id. */
    defaultResponseId?: string;
    latency?: LatencySpec;
    failure?: FailureSpec;
    stateful?: StatefulSpec;
    /**
     * JS transform executed (sandboxed VM, 250ms) receiving
     * `{ request, body }` and returning the replacement body.
     */
    transform?: string;
    meta?: Record<string, unknown>;
}
export interface MockConfig {
    version: typeof MOCK_CONFIG_VERSION;
    name?: string;
    port?: number;
    host?: string;
    /** Strip this prefix before matching (e.g. "/api/v2"). */
    basePath?: string;
    /** Echo permissive CORS headers + auto-answer preflights. */
    cors?: boolean;
    routes: MockRoute[];
}
export interface RecordedRequest {
    id: string;
    at: number;
    method: string;
    url: string;
    matchedRouteId: string | null;
    responseStatus: number | null;
    durationMs: number;
    requestHeaders: Record<string, string>;
    requestBodyPreview?: string;
    responseBodyPreview?: string;
    note?: string;
}
/** Runtime context handed to templating + transforms for one request. */
export interface RequestContext {
    method: string;
    /** Matched path params ({id: "42"}). */
    path: Record<string, string>;
    query: Record<string, string>;
    headers: Record<string, string>;
    body: unknown;
    rawBody: string;
}
//# sourceMappingURL=types.d.ts.map