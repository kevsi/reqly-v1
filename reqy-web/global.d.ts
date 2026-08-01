// Allow vitest's `?fresh` query imports (forces a fresh module instance for
// isolated store tests). Without this, `tsc` cannot resolve the `*?fresh`
// specifier used in store-initializer.test.tsx.
declare module "*?fresh";

// `java-parser` was removed from dependencies but `detect-shared-java.ts` still
// lazy-imports it behind a runtime try/catch (graceful degradation to `null`
// when unavailable). The ambient module keeps `tsc --noEmit` green.
declare module "java-parser";
