import type { BodySchema } from "./types.js";
type Rng = () => number;
export declare function inferFormat(fieldName: string): BodySchema["format"] | undefined;
export declare function generateValue(format: NonNullable<BodySchema["format"]>, rng: Rng): string | number;
/**
 * Generate a realistic value for a schema node. `keyHint` is the property
 * name currently being generated (used for name-based inference when the
 * schema omits type/format).
 */
export declare function generate(schema: BodySchema | undefined, rng: Rng, keyHint?: string): unknown;
export {};
//# sourceMappingURL=generator.d.ts.map