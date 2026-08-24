import type { MatchRule, MockRoute, RequestContext } from "./types.js";
/** Match a request path against a route pattern. Returns path params or null. */
export declare function matchPath(pattern: string, actualPath: string): Record<string, string> | null;
/** Find the first matching route for a method + path. */
export declare function findRoute(routes: MockRoute[], method: string, actualPath: string): {
    route: MockRoute;
    params: Record<string, string>;
} | null;
type RuleContext = Pick<RequestContext, "query" | "headers" | "body" | "rawBody">;
export declare function evaluateRule(rule: MatchRule, ctx: RuleContext): boolean;
export declare function evaluateRules(rules: MatchRule[] | undefined, ctx: RuleContext): boolean;
/** Select a response: first whose rules all pass, else defaultId, else first. */
export declare function selectResponse(route: MockRoute, ctx: RuleContext): MockRoute["responses"][number] | null;
export {};
//# sourceMappingURL=matcher.d.ts.map