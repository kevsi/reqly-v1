import { describe, expect, it } from "vitest";
import { captureSessionsToMockConfig } from "../capture-to-mock";
import { sanitizeConfig } from "@/components/mock/mock-utils";

function session(
  id: string,
  method: string,
  url: string,
  statusCode: number,
  body: string,
) {
  return {
    id,
    request: { method, url },
    response: { statusCode, body },
  };
}

describe("captureSessionsToMockConfig", () => {
  it("groupe par méthode+chemin et paramètre les ids numériques", () => {
    const config = captureSessionsToMockConfig([
      session("s1", "GET", "https://api.ex.com/api/users/42", 200, '{"id":42}'),
      session("s2", "GET", "https://api.ex.com/api/users/7", 200, '{"id":7}'),
      session("s3", "POST", "https://api.ex.com/api/users", 201, "{}"),
    ]);
    const paths = config.routes.map((r) => r.path);
    expect(paths).toContain("/api/users/:id");
    expect(paths).toContain("/api/users");
    expect(config.routes.find((r) => r.path === "/api/users/:id")?.method).toBe("GET");
  });

  it("déduplique les statuts d'une même route en réponses distinctes", () => {
    const config = captureSessionsToMockConfig([
      session("a", "GET", "https://x.io/items/1", 200, '{"ok":true}'),
      session("b", "GET", "https://x.io/items/999", 404, '{"error":"nf"}'),
    ]);
    const route = config.routes[0]!;
    expect(route.responses.map((r) => r.statusCode).sort()).toEqual([200, 404]);
  });

  // Le tri « plus récent gagne » repose sur l'ordre du tableau d'entrée après
  // stabilisation : le dernier élément de la liste est traité en dernier.
  it("garde la configuration moteur valide (sanitizeConfig)", () => {
    const config = captureSessionsToMockConfig([
      session("c1", "DELETE", "/api/things/12", 204, ""),
      session("c2", "PATCH", "/api/things/12", 200, '{"patched":true}'),
    ]);
    expect(sanitizeConfig(config)).not.toBeNull();
    expect(config.version).toBe(1);
    expect(config.cors).toBe(true);
  });

  it("tronque les corps trop volumineux", () => {
    const big = JSON.stringify({ pad: "x".repeat(20 * 1024) });
    const config = captureSessionsToMockConfig([
      session("big", "GET", "https://x.io/blob", 200, big),
    ]);
    const body = config.routes[0]!.responses[0]!.body ?? "";
    expect(body.length).toBeLessThan(10 * 1024);
  });
});
