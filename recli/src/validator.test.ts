import { describe, it, expect } from "vitest";
import { validateExportBundle, isValidExportBundle, findUnresolvedVariables } from "./validator.js";
import type { ExportBundle } from "./types.js";

function validBundle(): ExportBundle {
  return {
    version: "1.0",
    collections: [
      {
        name: "Test Collection",
        requests: [
          {
            name: "Get Users",
            method: "GET",
            url: "https://api.example.com/users",
            endpoint: "/users",
          },
        ],
      },
    ],
    environments: [
      {
        name: "Production",
        variables: [{ key: "baseUrl", value: "https://api.example.com", enabled: true }],
      },
    ],
  };
}

describe("validator", () => {
  describe("validateExportBundle", () => {
    it("returns no errors for a valid bundle", () => {
      const errors = validateExportBundle(validBundle());
      expect(errors).toHaveLength(0);
    });

    it("rejects null", () => {
      const errors = validateExportBundle(null);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].path).toBe("root");
    });

    it("rejects non-object", () => {
      const errors = validateExportBundle("invalid");
      expect(errors.length).toBeGreaterThan(0);
    });

    it("rejects missing collections", () => {
      const errors = validateExportBundle({});
      expect(errors.some((e) => e.path === "collections")).toBe(true);
    });

    it("rejects non-array collections", () => {
      const errors = validateExportBundle({ collections: "not-array" });
      expect(errors.some((e) => e.path === "collections")).toBe(true);
    });

    it("rejects empty collections array", () => {
      const errors = validateExportBundle({ collections: [] });
      expect(
        errors.some((e) => e.path === "collections" && e.message.includes("At least one")),
      ).toBe(true);
    });

    it("rejects collection without name", () => {
      const bundle = validBundle();
      bundle.collections[0].name = "";
      const errors = validateExportBundle(bundle);
      expect(errors.some((e) => e.path.includes(".name"))).toBe(true);
    });

    it("rejects request without name", () => {
      const bundle = validBundle();
      bundle.collections[0].requests[0].name = "";
      const errors = validateExportBundle(bundle);
      expect(errors.some((e) => e.path.includes(".name"))).toBe(true);
    });

    it("rejects request without method", () => {
      const bundle = validBundle();
      (bundle.collections[0].requests[0] as any).method = "INVALID";
      const errors = validateExportBundle(bundle);
      expect(errors.some((e) => e.path.includes(".method"))).toBe(true);
    });

    it("rejects request without url", () => {
      const bundle = validBundle();
      (bundle.collections[0].requests[0] as any).url = "";
      const errors = validateExportBundle(bundle);
      expect(errors.some((e) => e.path.includes(".url"))).toBe(true);
    });

    it("rejects invalid headers type", () => {
      const bundle = validBundle();
      (bundle.collections[0].requests[0] as any).headers = "not-an-object";
      const errors = validateExportBundle(bundle);
      expect(errors.some((e) => e.path.includes(".headers"))).toBe(true);
    });

    it("accepts valid headers", () => {
      const bundle = validBundle();
      bundle.collections[0].requests[0].headers = { Authorization: "Bearer token" };
      const errors = validateExportBundle(bundle);
      expect(errors.some((e) => e.path.includes(".headers"))).toBe(false);
    });

    it("rejects invalid queryParams type", () => {
      const bundle = validBundle();
      (bundle.collections[0].requests[0] as any).queryParams = "not-array";
      const errors = validateExportBundle(bundle);
      expect(errors.some((e) => e.path.includes(".queryParams"))).toBe(true);
    });

    it("accepts valid queryParams", () => {
      const bundle = validBundle();
      bundle.collections[0].requests[0].queryParams = [{ key: "page", value: "1" }];
      const errors = validateExportBundle(bundle);
      expect(errors.some((e) => e.path.includes(".queryParams"))).toBe(false);
    });

    it("rejects invalid environments type", () => {
      const bundle = validBundle();
      (bundle as any).environments = "not-array";
      const errors = validateExportBundle(bundle);
      expect(errors.some((e) => e.path === "environments")).toBe(true);
    });

    it("accepts valid scripts", () => {
      const bundle = validBundle();
      bundle.collections[0].requests[0].scripts = {
        pre: "vars.set('a', 'b')",
        post: "expect(response.status).toBe(200)",
      };
      const errors = validateExportBundle(bundle);
      expect(errors.length).toBe(0);
    });

    it("rejects invalid scripts type", () => {
      const bundle = validBundle();
      (bundle.collections[0].requests[0] as any).scripts = "not-an-object";
      const errors = validateExportBundle(bundle);
      expect(errors.some((e) => e.path.includes(".scripts"))).toBe(true);
    });

    it("accepts string assertions (text format)", () => {
      const bundle = validBundle();
      (bundle.collections[0].requests[0] as any).assert = ["status == 200"];
      const errors = validateExportBundle(bundle);
      expect(errors).toHaveLength(0);
    });

    it("accepts object assertions with expr/type/schema", () => {
      const bundle = validBundle();
      (bundle.collections[0].requests[0] as any).assert = [
        { expr: "status == 200" },
        { type: "status", expect: 200 },
        { type: "json-path", target: "$.user", operator: "exists" },
        { schema: { type: "object" } },
      ];
      const errors = validateExportBundle(bundle);
      expect(errors).toHaveLength(0);
    });

    it("rejects assertion entries that are neither strings nor usable objects", () => {
      const bundle = validBundle();
      (bundle.collections[0].requests[0] as any).assert = [{ name: "no expr/type/schema" }];
      const errors = validateExportBundle(bundle);
      expect(
        errors.some((e) => e.path.includes(".assert[0]") && e.message.includes('"expr"')),
      ).toBe(true);
    });

    it("rejects non-string non-object assertion entries", () => {
      const bundle = validBundle();
      (bundle.collections[0].requests[0] as any).assert = [42];
      const errors = validateExportBundle(bundle);
      expect(errors.some((e) => e.path.includes(".assert[0]"))).toBe(true);
    });
  });

  describe("findUnresolvedVariables", () => {
    it("returns no warnings when every placeholder is defined", () => {
      const bundle = validBundle();
      bundle.collections[0].requests[0].url = "https://{{baseUrl}}/users";
      const warnings = findUnresolvedVariables(bundle);
      expect(warnings).toHaveLength(0);
    });

    it("flags placeholders defined nowhere in the bundle", () => {
      const bundle = validBundle();
      (bundle.collections[0].requests[0] as any).url = "https://api.example.com/{{UNSET_VAR}}/1";
      const warnings = findUnresolvedVariables(bundle);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain("UNSET_VAR");
    });

    it("does not flag dynamic variables", () => {
      const bundle = validBundle();
      (bundle.collections[0].requests[0] as any).url = "https://api.example.com/{{$randomInt}}";
      const warnings = findUnresolvedVariables(bundle);
      expect(warnings).toHaveLength(0);
    });

    it("does not flag variables assigned by scripts or captures", () => {
      const bundle = validBundle();
      bundle.collections[0].requests[0].scripts = {
        pre: 'postman.setEnvironmentVariable("access_token", res.json().token)',
      };
      bundle.collections[0].requests[1] = {
        name: "Uses token",
        method: "GET",
        url: "https://api.example.com/{{access_token}}",
        endpoint: "/{{access_token}}",
      } as any;
      const warnings = findUnresolvedVariables(bundle);
      expect(warnings).toHaveLength(0);
    });
  });

  describe("isValidExportBundle", () => {
    it("returns true for valid bundle", () => {
      expect(isValidExportBundle(validBundle())).toBe(true);
    });

    it("returns false for invalid bundle", () => {
      expect(isValidExportBundle(null)).toBe(false);
    });
  });
});
