import { describe, it, expect } from "vitest";
import { detectExpress, analyzeHandlerBody } from "../detect-shared";
import type { DetectedRoute } from "../detect-shared";
import type { HttpMethod } from "@/lib/types";

function makeRoute(method: HttpMethod = "PUT"): DetectedRoute {
  return {
    name: "test",
    method,
    path: "/test",
    headers: [],
    body: "",
    bodyType: "json",
    authRequired: false,
    description: "",
    sourceFile: "test.js",
  };
}

describe("PUT body detection", () => {
  it("detects body on PUT route with destructuring (same as POST)", () => {
    const code = `
const express = require("express")
const app = express()
app.put("/api/users/:id", async (req, res) => {
  const { name, email } = req.body
  await db.update(req.params.id, { name, email })
  res.json({ ok: true })
})
`;
    const routes = detectExpress(code);
    expect(routes.length).toBe(1);
    expect(routes[0].method).toBe("PUT");
    expect(routes[0].bodyType).toBe("json");
    expect(routes[0].body).toContain("name");
    expect(routes[0].body).toContain("email");
  });

  it("sets body to {} when req.body is used without extractable fields (Object.assign)", () => {
    const code = `
app.put("/api/users/:id", (req, res) => {
  const user = users.find(u => u.id === req.params.id)
  if (!user) return res.status(404).json({ error: "Not found" })
  Object.assign(user, req.body)
  res.json({ message: "Updated", data: user })
})
`;
    const route = makeRoute("PUT");
    route.bodyType = "json";
    analyzeHandlerBody(code, route, code);
    expect(route.bodyType).toBe("json");
    expect(route.body).toBe("{}");
    expect(route.reasonings!.some((s) => s.includes("pass-through"))).toBe(true);
  });

  it("sets body to {} for PUT routes in simple-api style", () => {
    const code = `
const express = require('express');
const app = express();
app.use(express.json());

app.put('/api/users/:id', (req, res) => {
  const user = users.find(u => u.id === parseInt(req.params.id));
  if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });
  Object.assign(user, req.body);
  res.json({ message: 'Utilisateur mis à jour', data: user });
});

app.put('/api/products/:id', (req, res) => {
  Object.assign(product, req.body);
  res.json({ message: 'Produit mis à jour' });
});
`;
    const routes = detectExpress(code);
    expect(routes.length).toBe(2);
    for (const r of routes) {
      expect(r.bodyType).toBe("json");
      expect(r.body).toBe("{}");
    }
  });
});
