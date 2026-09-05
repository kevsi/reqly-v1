/**
 * Mapping des assertions runner Reqly vers un script de test Bruno
 * (syntaxe `test()` / `expect()` — chai style, comme attendu par
 * `tests { }` dans les fichiers .bru et `runtime.scripts` OpenCollection).
 */

import type { Assertion } from "@/lib/test-runner/types";

function quote(value: unknown): string {
  return JSON.stringify(value === undefined ? null : value);
}

/** Traduit une assertion en une ou plusieurs lignes `expect(...)` Bruno. */
export function assertionToBrunoTest(assertion: Assertion): string | null {
  switch (assertion.type) {
    case "status": {
      if (typeof assertion.expected === "number") {
        return `test("status is ${assertion.expected}", function() {
  expect(res.getStatus()).to.equal(${assertion.expected});
});`;
      }
      if ("in" in assertion.expected && Array.isArray(assertion.expected.in)) {
        return `test("status is one of ${assertion.expected.in.join(", ")}", function() {
  expect([${assertion.expected.in.join(", ")}]).to.include(res.getStatus());
});`;
      }
      if ("not" in assertion.expected) {
        return `test("status is not ${assertion.expected.not}", function() {
  expect(res.getStatus()).to.not.equal(${assertion.expected.not});
});`;
      }
      return null;
    }
    case "responseTime": {
      const op = assertion.operator === "<" ? "below" : assertion.operator === "<=" ? "most" : assertion.operator === ">" ? "above" : "least";
      return `test("response time ${assertion.operator} ${assertion.valueMs}ms", function() {
  expect(res.getResponseTime()).to.be.${op}(${assertion.valueMs});
});`;
    }
    case "jsonPath": {
      const body = `res.getBody()`;
      switch (assertion.operator) {
        case "equals":
          return `test("jsonPath ${assertion.path} equals", function() {
  expect(${body}).to.nested.property(${quote(assertion.path)}, ${quote(assertion.value)});
});`;
        case "contains":
          return `test("jsonPath ${assertion.path} contains", function() {
  expect(String(${quote(assertion.value)})).to.include(String(${body}?.${assertion.path}));
});`;
        case "exists":
          return `test("jsonPath ${assertion.path} exists", function() {
  expect(${body}).to.nested.property(${quote(assertion.path)});
});`;
        case "notExists":
          return `test("jsonPath ${assertion.path} does not exist", function() {
  expect(${body}).to.not.nested.property(${quote(assertion.path)});
});`;
        default:
          return null;
      }
    }
    case "header": {
      switch (assertion.operator) {
        case "exists":
          return `test("header ${assertion.name} exists", function() {
  expect(res.getHeaders()).to.have.property(${quote(assertion.name.toLowerCase())});
});`;
        case "equals":
          return `test("header ${assertion.name} equals", function() {
  expect(res.getHeaders()[${quote(assertion.name.toLowerCase())}]).to.equal(${quote(assertion.value)});
});`;
        case "contains":
          return `test("header ${assertion.name} contains", function() {
  expect(String(res.getHeaders()[${quote(assertion.name.toLowerCase())}])).to.include(${quote(assertion.value)});
});`;
        default:
          return null;
      }
    }
    case "schema":
      // Les schémas JSON n'ont pas d'équivalent chai natif — non exporté.
      return null;
    default:
      return null;
  }
}

/** Compile les assertions d'une requête en bloc `tests` ; null si rien. */
export function assertionsToTestsBlock(assertions?: Assertion[]): string | null {
  const chunks = (assertions ?? [])
    .map(assertionToBrunoTest)
    .filter((c): c is string => c !== null);
  if (chunks.length === 0) return null;
  return chunks.join("\n\n");
}
