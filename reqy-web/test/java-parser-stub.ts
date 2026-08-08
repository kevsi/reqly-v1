// Stub for the optional `java-parser` package.
// In unit tests the package is not installed, so `getJavaParser()` resolves to
// `{}`, `parse()` is undefined, and the Java AST detectors fall back to regex —
// matching production behavior when the parser is absent.
export {};
