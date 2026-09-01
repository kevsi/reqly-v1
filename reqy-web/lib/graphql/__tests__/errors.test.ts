import { describe, it, expect } from "vitest";
import { friendlyGraphQLError, validateSubscriptionEndpoint } from "../errors";

describe("friendlyGraphQLError", () => {
  it("explique les erreurs d'authentification (401)", () => {
    const msg = friendlyGraphQLError(401, "Proxy request failed (HTTP 401)");
    expect(msg).toContain("Authentification requise");
    expect(msg).toContain("headers");
  });

  it("explique les endpoints introuvables (404)", () => {
    const msg = friendlyGraphQLError(404, "Proxy request failed (HTTP 404)");
    expect(msg).toContain("introuvable");
    expect(msg).toContain("URL");
  });

  it("explique le rate limiting (429)", () => {
    expect(friendlyGraphQLError(429)).toContain("patientez");
  });

  it("explique les erreurs serveur (5xx)", () => {
    const msg = friendlyGraphQLError(502);
    expect(msg).toContain("502");
    expect(msg).toContain("réessayez");
  });

  it("reste générique pour les autres statuts", () => {
    const msg = friendlyGraphQLError(0);
    expect(msg).toContain("Impossible de contacter");
  });

  it("garde le détail technique utile et ignore 'Invalid proxy response'", () => {
    expect(friendlyGraphQLError(500, "Invalid proxy response")).not.toContain("Invalid proxy");
    expect(friendlyGraphQLError(500, "real detail")).toContain("real detail");
  });
});

describe("validateSubscriptionEndpoint", () => {
  it("convertit http:// en ws://", () => {
    const r = validateSubscriptionEndpoint("http://api.example.com/graphql");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url).toBe("ws://api.example.com/graphql");
  });

  it("convertit https:// en wss://", () => {
    const r = validateSubscriptionEndpoint("https://api.example.com/graphql");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url).toBe("wss://api.example.com/graphql");
  });

  it("accepte ws:// et wss:// tels quels", () => {
    expect(validateSubscriptionEndpoint("ws://api.example.com/graphql").ok).toBe(true);
    expect(validateSubscriptionEndpoint("wss://api.example.com/graphql").ok).toBe(true);
  });

  it("bloque les hôtes privés (localhost, IP privées, *.local)", () => {
    expect(validateSubscriptionEndpoint("ws://localhost:4000/graphql").ok).toBe(false);
    expect(validateSubscriptionEndpoint("wss://192.168.1.1/graphql").ok).toBe(false);
    expect(validateSubscriptionEndpoint("wss://10.0.0.5/graphql").ok).toBe(false);
    expect(validateSubscriptionEndpoint("wss://myhost.local/graphql").ok).toBe(false);
    expect(validateSubscriptionEndpoint("wss://169.254.169.254/graphql").ok).toBe(false);
  });

  it("rejette les schémas inconnus", () => {
    const r = validateSubscriptionEndpoint("ftp://api.example.com/graphql");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("http://");
  });

  it("rejette les URL vides", () => {
    const r = validateSubscriptionEndpoint("  ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("manquante");
  });

  it("rejette les URL malformées", () => {
    const r = validateSubscriptionEndpoint("not a url at all");
    expect(r.ok).toBe(false);
  });

  it("refuse le mixed content (ws:// sur page https)", () => {
    // Simule une page servie en HTTPS
    Object.defineProperty(window, "location", {
      value: { protocol: "https:" },
      configurable: true,
    });
    const r = validateSubscriptionEndpoint("ws://api.example.com/graphql");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("wss://");
  });
});
