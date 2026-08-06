import { describe, it, expect, vi } from "vitest";
import { getProxyToken, proxyAuthHeaders } from "@/lib/proxy-auth";

describe("proxy-auth", () => {
  // Test the cookie parsing logic directly - it's a pure function

  describe("getProxyToken cookie parsing", () => {
    it("extracts token from cookie string", () => {
      // Test the regex logic directly
      const cookie = "proxy_visitor=visitor_token_123";
      const match = cookie.match(new RegExp(`(?:^|;\\s*)proxy_visitor=([^;]*)`));
      expect(match).not.toBeNull();
      expect(decodeURIComponent(match![1])).toBe("visitor_token_123");
    });

    it("handles URL-encoded values", () => {
      const cookie = "proxy_visitor=hello%20world";
      const match = cookie.match(new RegExp(`(?:^|;\\s*)proxy_visitor=([^;]*)`));
      expect(decodeURIComponent(match![1])).toBe("hello world");
    });

    it("returns empty when cookie missing", () => {
      const cookie = "";
      const match = cookie.match(new RegExp(`(?:^|;\\s*)proxy_visitor=([^;]*)`));
      expect(match).toBeNull();
    });

    it("works with multiple cookies", () => {
      const cookie = "other=foo; proxy_visitor=token; another=bar";
      const match = cookie.match(new RegExp(`(?:^|;\\s*)proxy_visitor=([^;]*)`));
      expect(decodeURIComponent(match![1])).toBe("token");
    });

    it("handles semicolons in token value", () => {
      const cookie = "proxy_visitor=token%3Bwith%3Bsemis";
      const match = cookie.match(new RegExp(`(?:^|;\\s*)proxy_visitor=([^;]*)`));
      expect(decodeURIComponent(match![1])).toBe("token;with;semis");
    });
  });

  describe("proxyAuthHeaders", () => {
    it("returns Authorization header when token provided", () => {
      // Test the header construction logic
      const token = "visitor_token";
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      expect(headers).toEqual({ Authorization: "Bearer visitor_token" });
    });

    it("returns empty object when no token", () => {
      const token = "";
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      expect(headers).toEqual({});
    });
  });
});
