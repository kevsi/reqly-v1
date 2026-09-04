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
export declare function runTransform(code: string, input: TransformInput): Promise<unknown>;
//# sourceMappingURL=scripts.d.ts.map