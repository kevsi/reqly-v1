export interface TransformInput {
    request: {
        method: string;
        path: string;
        query: Record<string, string>;
        headers: Record<string, string>;
    };
    body: unknown;
    state: unknown;
}
/**
 * Execute a user transform script in a hardened VM context.
 *
 * The script receives `{ request, body }` and returns the replacement body
 * (object → JSON-serialized by the server, or a raw string). No require,
 * no process, no network. 250 ms hard timeout.
 *
 * Throws on timeout or uncaught script error — callers turn that into a 500
 * with an X-Mock-Script-Error header.
 */
export declare function runTransform(code: string, input: TransformInput): unknown;
//# sourceMappingURL=scripts.d.ts.map