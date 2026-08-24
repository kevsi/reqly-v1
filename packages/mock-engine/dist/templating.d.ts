import type { RequestContext } from "./types.js";
/**
 * Resolve {{...}} tokens in a static body against the current request.
 * Unknown tokens are left untouched so users can keep literal braces.
 */
export declare function resolveTemplate(template: string, ctx: RequestContext): string;
//# sourceMappingURL=templating.d.ts.map