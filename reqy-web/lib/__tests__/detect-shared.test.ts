/**
 * Unit tests for the route-detection pipeline (lib/detect-shared*).
 *
 * Converted from the former standalone script (lib/project-analyzer.test.ts)
 * which was never run by vitest — its custom harness ran only via
 * `npx tsx`. Now runs in CI.
 *
 * Note: in jsdom, `typeof window !== "undefined"`, so tree-sitter and the
 * Python AST subprocess are both disabled — every `detectRoutes` call
 * exercises the regex fallback path, matching server behavior when the
 * optional parsers are absent.
 */

import { describe, it, expect } from "vitest";
import {
  detectRoutes,
  detectFastAPI,
  detectFlask,
  detectDjango,
  detectSpring,
  detectExpress,
  detectTornado,
  detectStarlette,
  detectAiohttp,
  detectLanguage,
  detectFramework,
  detectPort,
  defaultPortForFramework,
  normalizePath,
  makeRoute,
  scanFrontendApiCalls,
  correlateWithFrontendCall,
  detectNextJsRoutesFromTree,
  detectDynamicRoutes,
  findEntryPoint,
  analyzeMiddlewareChain,
  stripLanguageCommentsAndStrings,
  isNonRouteFile,
} from "@/lib/detect-shared";

function expectRoute(routes: { method: string; path: string }[], method: string, path: string) {
  expect(
    routes.some((r) => r.method === method && r.path === path),
    `expected ${method} ${path} in ${JSON.stringify(routes)}`,
  ).toBe(true);
}

describe("detectRoutes — tree-sitter path falls back to regex in jsdom", () => {
  it("FastAPI via detectRoutes", async () => {
    const content = `
from fastapi import FastAPI, APIRouter, Depends
router = APIRouter()
@router.get("/items")
async def list_items(): return {"items": []}
@router.get("/protected", dependencies=[Depends(security)])
async def protected_route(): return {"data": "secret"}
@router.post("/create")
async def create_item(item: dict): return {"created": item}
`;
    const routes = await detectRoutes(content, "routers/items.py", "fastapi");
    expect(routes.length).toBeGreaterThanOrEqual(3);
    expectRoute(routes, "GET", "/items");
    expectRoute(routes, "GET", "/protected");
    expectRoute(routes, "POST", "/create");
  });

  it("Flask via detectRoutes", async () => {
    const content = `
from flask import Flask
app = Flask(__name__)
@app.route("/")
def index(): return "ok"
@app.get("/login")
def login(): return "login"
`;
    const routes = await detectRoutes(content, "app.py", "flask");
    expect(routes.length).toBeGreaterThanOrEqual(2);
    expectRoute(routes, "GET", "/");
    expectRoute(routes, "GET", "/login");
  });

  it("Spring via detectRoutes", async () => {
    const content = `
@RestController
@RequestMapping("/users")
public class UserController {
    @GetMapping
    public List<User> getAll() { return List.of(); }
    @PostMapping
    public User create(@RequestBody User u) { return u; }
    @PutMapping("/{id}")
    public User update(@PathVariable Long id, @RequestBody User u) { return u; }
    @DeleteMapping("/{id}")
    public void delete(@PathVariable Long id) {}
}
`;
    const routes = await detectRoutes(content, "UserController.java", "spring");
    expect(routes.length).toBeGreaterThanOrEqual(4);
    expectRoute(routes, "GET", "/users");
    expectRoute(routes, "POST", "/users");
    expectRoute(routes, "PUT", "/users/:id");
    expectRoute(routes, "DELETE", "/users/:id");
  });

  it("ASP.NET via detectRoutes", async () => {
    const content = `
[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase {
    [HttpGet]
    public IActionResult GetAll() { return Ok(); }
    [HttpGet("{id}")]
    public IActionResult Get(int id) { return Ok(); }
    [HttpPost]
    public IActionResult Post() { return Ok(); }
}
`;
    const routes = await detectRoutes(content, "UsersController.cs", "aspnet");
    expect(routes.length).toBeGreaterThanOrEqual(3);
    expectRoute(routes, "GET", "/");
    expectRoute(routes, "GET", "/:id");
    expectRoute(routes, "POST", "/");
  });

  it("Express fallback when tree-sitter yields nothing", async () => {
    const content = `
const express = require('express')
const router = express.Router()
router.get('/status', (req, res) => res.json({ ok: true }))
router.post('/login', (req, res) => res.json({ token: 'x' }))
`;
    const routes = await detectRoutes(content, "routes/api.ts", "express");
    expect(routes.length).toBeGreaterThanOrEqual(2);
    expectRoute(routes, "GET", "/status");
    expectRoute(routes, "POST", "/login");
  });

  it("Unknown framework still finds routes via multi-detector fallback", async () => {
    const routes = await detectRoutes(
      `
from fastapi import FastAPI
app = FastAPI()
@app.get("/health")
def health(): return "ok"
`,
      "routes.py",
      "unknown",
    );
    expect(routes.length).toBeGreaterThanOrEqual(1);
    expectRoute(routes, "GET", "/health");
  });

  it("Go Gin via detectRoutes", async () => {
    const content = `
package main
import "github.com/gin-gonic/gin"
func main() {
    r := gin.Default()
    r.GET("/ping", func(c *gin.Context) { c.JSON(200, gin.H{"message": "pong"}) })
    r.POST("/users", func(c *gin.Context) { c.JSON(200, gin.H{}) })
    r.PUT("/users/:id", func(c *gin.Context) { c.JSON(200, gin.H{}) })
    r.DELETE("/users/:id", func(c *gin.Context) { c.JSON(200, gin.H{}) })
    r.GET("/protected", func(c *gin.Context) { c.JSON(200, gin.H{}) })
}
`;
    const routes = await detectRoutes(content, "main.go", "gin");
    expect(routes.length).toBeGreaterThanOrEqual(4);
    expectRoute(routes, "GET", "/ping");
    expectRoute(routes, "POST", "/users");
    expectRoute(routes, "PUT", "/users/:id");
    expectRoute(routes, "DELETE", "/users/:id");
  });

  it("Ruby Rails via detectRoutes", async () => {
    const content = `
Rails.application.routes.draw do
  get "users", to: "users#index"
  post "users", to: "users#create"
  put "users/:id", to: "users#update"
  delete "users/:id", to: "users#destroy"
  resources :articles
end
`;
    const routes = await detectRoutes(content, "routes.rb", "rails");
    // Regex fallback (jsdom): explicit routes are detected; `resources`
    // expansion is only handled by the tree-sitter path in Node.
    expect(routes.length).toBeGreaterThanOrEqual(4);
    expectRoute(routes, "GET", "/users");
    expectRoute(routes, "POST", "/users");
  });

  it("PHP Laravel via detectRoutes", async () => {
    const content = `
<?php
use App\\Http\\Controllers\\UserController;
use Illuminate\\Support\\Facades\\Route;

Route::get('/users', [UserController::class, 'index']);
Route::post('/users', [UserController::class, 'store']);
Route::put('/users/{id}', [UserController::class, 'update']);
Route::delete('/users/{id}', [UserController::class, 'destroy']);
Route::get('/profile', [ProfileController::class, 'show']);
`;
    const routes = await detectRoutes(content, "web.php", "laravel");
    expect(routes.length).toBeGreaterThanOrEqual(5);
    expectRoute(routes, "GET", "/users");
    expectRoute(routes, "POST", "/users");
    expectRoute(routes, "PUT", "/users/:id");
    expectRoute(routes, "DELETE", "/users/:id");
    expectRoute(routes, "GET", "/profile");
  });
});

describe("detectRoutes — edge cases", () => {
  it("empty file returns no routes", async () => {
    const routes = await detectRoutes("", "empty.py", "fastapi");
    expect(routes.length).toBe(0);
  });

  it("source without route annotations returns no routes", async () => {
    const routes = await detectRoutes(
      `
from fastapi import FastAPI
app = FastAPI()
def helper():
    return 42
`,
      "no_routes.py",
      "fastapi",
    );
    expect(routes.length).toBe(0);
  });

  it("deduplicates routes (no fallback leakage)", async () => {
    const content = `
from fastapi import APIRouter
router = APIRouter()
@router.get("/items")
async def list(): return []
@router.post("/create")
async def create(): return {}
`;
    const r1 = await detectRoutes(content, "routers/items.py", "fastapi");
    const r2 = detectFastAPI(content);
    expect(r1.length).toBeGreaterThanOrEqual(2);
    expect(r2.length).toBeGreaterThanOrEqual(2);
    const seen = new Set(r1.map((r) => `${r.method}|${r.path}`));
    expect(seen.size).toBe(r1.length);
  });
});

describe("direct detector calls (regex path)", () => {
  it("detectFastAPI finds GET + POST routes", () => {
    const routes = detectFastAPI(`
from fastapi import FastAPI
app = FastAPI()
@app.get("/ping")
def ping(): return "pong"
`);
    expectRoute(routes, "GET", "/ping");
  });

  it("detectFlask finds route decorators", () => {
    const routes = detectFlask(`
from flask import Flask
app = Flask(__name__)
@app.route("/health")
def health(): return "ok"
`);
    expectRoute(routes, "GET", "/health");
  });

  it("detectDjango finds path() entries", () => {
    const routes = detectDjango(`
from django.urls import path
urlpatterns = [
    path("users/", views.index),
]
`);
    expect(routes.length).toBeGreaterThanOrEqual(1);
  });

  it("detectExpress finds router methods", () => {
    const routes = detectExpress(`
const express = require('express')
const router = express.Router()
router.get('/items', (req, res) => res.json([]))
`);
    expectRoute(routes, "GET", "/items");
  });

  it("detectTornado finds Application route tuples (regex fallback)", () => {
    const routes = detectTornado(`
import tornado.web
class MainHandler(tornado.web.RequestHandler):
    def get(self): self.write("ok")
app = tornado.web.Application([
    (r"/", MainHandler),
    (r"/users", MainHandler),
])
`);
    expectRoute(routes, "GET", "/");
    expectRoute(routes, "GET", "/users");
  });

  it("detectStarlette finds Route entries (regex fallback)", () => {
    const routes = detectStarlette(`
from starlette.routing import Route
routes = [
    Route("/ping", endpoint=ping),
    Route("/health", endpoint=health, methods=["POST"]),
]
`);
    expectRoute(routes, "GET", "/ping");
    expectRoute(routes, "POST", "/health");
  });

  it("detectAiohttp finds decorator and router.add_ routes (regex fallback)", () => {
    const routes = detectAiohttp(`
from aiohttp import web
routes = web.RouteTableDef()
@routes.get("/items")
async def items(request): return web.Response(text="[]")
app.router.add_post("/create", create)
`);
    expectRoute(routes, "GET", "/items");
    expectRoute(routes, "POST", "/create");
  });

  it("detectSpring falls back to regex when java-parser is absent", async () => {
    const routes = await detectSpring(`
import org.springframework.web.bind.annotation.*;
@RestController
@RequestMapping
public class TestController {
    @GetMapping(value = "/items")
    public String items() { return "[]"; }
}
`);
    expect(routes.length).toBeGreaterThanOrEqual(1);
    expectRoute(routes, "GET", "/items");
  });

  it("detectSpring ignores non-path annotation args and bare annotations", async () => {
    const routes = await detectSpring(`
@RestController
@RequestMapping(method = RequestMethod.GET)
public class C {
    @GetMapping(params = "debug")
    public String x() { return ""; }
    @GetMapping("/ok")
    public String ok() { return ""; }
}
`);
    expect(routes.length).toBeGreaterThanOrEqual(1);
    expectRoute(routes, "GET", "/ok");
    for (const r of routes) {
      expect(r.path).not.toContain("method");
      expect(r.path).not.toContain("params");
      expect(r.path).not.toContain("RequestMethod");
    }
  });
});

describe("detectLanguage", () => {
  it("infers from file extensions", () => {
    expect(detectLanguage([{ path: "main.py", content: "" }])).toBe("Python");
    expect(
      detectLanguage([
        { path: "index.js", content: "const x = 1" },
        { path: "app.tsx", content: "import React from 'react'" },
      ]),
    ).toBe("JavaScript");
    expect(detectLanguage([{ path: "main.go", content: "" }])).toBe("Go");
    expect(detectLanguage([{ path: "Main.java", content: "" }])).toBe("Java");
  });

  it("falls back to content heuristics", () => {
    expect(detectLanguage([{ path: "f.txt", content: "from fastapi import FastAPI" }])).toBe(
      "Python",
    );
    expect(detectLanguage([{ path: "f.txt", content: "Rails.application.routes.draw do" }])).toBe(
      "Ruby",
    );
    expect(
      detectLanguage([
        {
          path: "f.txt",
          content: "@RestController\nimport org.springframework.web.bind.annotation.*",
        },
      ]),
    ).toBe("Java");
    expect(detectLanguage([{ path: "f.txt", content: "const express = require('express')" }])).toBe(
      "JavaScript",
    );
  });

  it("returns Unknown for unrecognizable content", () => {
    expect(detectLanguage([{ path: "a.xyz", content: "???" }])).toBe("Unknown");
  });
});

describe("detectFramework", () => {
  it("returns unknown for empty input", () => {
    expect(detectFramework([])).toBe("unknown");
  });

  it("detects from package.json dependencies", () => {
    const files = [
      { path: "package.json", content: JSON.stringify({ dependencies: { next: "^14" } }) },
    ];
    expect(detectFramework(files)).toBe("nextjs");
    const express = [
      { path: "package.json", content: JSON.stringify({ dependencies: { express: "^4" } }) },
    ];
    expect(detectFramework(express)).toBe("express");
  });

  it("detects from file paths (next.config)", () => {
    expect(detectFramework([{ path: "next.config.js", content: "" }])).toBe("nextjs");
    expect(detectFramework([{ path: "go.mod", content: "" }])).toBe("go");
    expect(detectFramework([{ path: "Cargo.toml", content: "" }])).toBe("rust");
  });

  it("detects from content heuristics", () => {
    expect(
      detectFramework([
        { path: "app.py", content: "from fastapi import FastAPI\napp = FastAPI()" },
      ]),
    ).toBe("fastapi");
    expect(
      detectFramework([
        { path: "app.js", content: "const express = require('express')\napp.get('/', h)" },
      ]),
    ).toBe("express");
    expect(detectFramework([{ path: "a.py", content: "def f(): return 1" }])).toBe("unknown");
  });
});

describe("detectPort / defaultPortForFramework", () => {
  it("extracts ports from listen / env / uvicorn patterns", () => {
    expect(detectPort([{ path: "a.js", content: "app.listen(3000)" }])).toBe(3000);
    expect(detectPort([{ path: "a.js", content: "const p = process.env.PORT || 8080" }])).toBe(
      8080,
    );
    expect(
      detectPort([{ path: "a.py", content: "uvicorn.run(app, host='0.0.0.0', port=8000)" }]),
    ).toBe(8000);
    expect(detectPort([{ path: "a.py", content: "no port here" }])).toBeUndefined();
  });

  it("maps known frameworks to default ports", () => {
    expect(defaultPortForFramework("express")).toBe(3000);
    expect(defaultPortForFramework("spring")).toBe(8080);
    expect(defaultPortForFramework("laravel")).toBe(8000);
    expect(defaultPortForFramework("unknown")).toBeUndefined();
  });
});

describe("path helpers", () => {
  it("normalizePath normalizes and parameterizes", () => {
    expect(normalizePath("users")).toBe("/users");
    expect(normalizePath("//a//b/")).toBe("/a/b");
    expect(normalizePath("/users/{id}")).toBe("/users/:id");
    expect(normalizePath("/users/:id")).toBe("/users/:id");
    expect(normalizePath("/users/${id}")).toBe("/users/:param");
    expect(normalizePath("")).toBe("/");
  });

  it("makeRoute builds a well-formed DetectedRoute", () => {
    const r = makeRoute("POST", "api/items", "create item");
    expect(r.method).toBe("POST");
    expect(r.path).toBe("/api/items");
    expect(r.description).toBe("create item");
    expect(r.authRequired).toBe(false);
    expect(Array.isArray(r.reasonings)).toBe(true);
    expect(r.sourceFile).toBe("");
  });

  it("stripLanguageCommentsAndStrings removes comments and string literals", () => {
    const out = stripLanguageCommentsAndStrings("const x = 'secret' // comment\n# py comment");
    expect(out).not.toContain("secret");
    expect(out).not.toContain("comment");
  });

  it("isNonRouteFile flags test/config paths", () => {
    expect(isNonRouteFile("src/api/users.test.ts")).toBe(true);
    expect(isNonRouteFile("src/api/vitest.config.ts")).toBe(true);
    expect(isNonRouteFile("src/api/users.ts")).toBe(false);
  });
});

describe("scanFrontendApiCalls / correlateWithFrontendCall", () => {
  it("collects fetch/axios calls into normalized paths", () => {
    const calls = scanFrontendApiCalls([
      {
        path: "client.ts",
        content: `
fetch("/api/users")
axios.get("/users")
fetch("https://api.example.com/v1/data")
useSWR("/api/stats", fetcher)
`,
      },
    ]);
    expect(calls.has("/api/users")).toBe(true);
    expect(calls.has("/users")).toBe(true);
    expect(calls.has("/v1/data")).toBe(true);
    expect(calls.has("/api/stats")).toBe(true);
  });

  it("handles template-literal paths", () => {
    const calls = scanFrontendApiCalls([{ path: "c.ts", content: "fetch(`/api/${id}/items`)" }]);
    expect(calls.has("/api/:param/items")).toBe(true);
  });

  it("correlates route paths with frontend calls", () => {
    expect(correlateWithFrontendCall("/api/users", "/api/users")).toBe(true);
    expect(correlateWithFrontendCall("/api/users/:id", "/api/users/42")).toBe(true);
    expect(correlateWithFrontendCall("/api/orders/:id", "/api/users/42")).toBe(false);
  });
});

describe("Next.js / dynamic route helpers", () => {
  it("detectNextJsRoutesFromTree maps app/pages API files", () => {
    const routes = detectNextJsRoutesFromTree([
      "src/app/api/users/route.ts",
      "pages/api/admin/index.ts",
    ]);
    expectRoute(routes, "GET", "/api/users");
    expectRoute(routes, "GET", "/api/admin");
  });

  it("detectDynamicRoutes finds array and conditional routes", () => {
    const routes = detectDynamicRoutes([
      {
        path: "server.ts",
        content: `
const routes = ["/api/a", "/api/b"]
.forEach((r) => app.get(r, h))

if (process.env.FEATURE_X) { app.get("/admin", h) }
`,
      },
    ]);
    expectRoute(routes, "GET", "/api/a");
    expectRoute(routes, "GET", "/api/b");
    expectRoute(routes, "GET", "/admin");
  });
});

describe("findEntryPoint / analyzeMiddlewareChain", () => {
  it("findEntryPoint resolves package.json main and common entry files", () => {
    expect(
      findEntryPoint([
        { path: "package.json", content: JSON.stringify({ main: "src/index.js" }) },
        { path: "src/index.js", content: "" },
      ]),
    ).toBe("src/index.js");
    expect(findEntryPoint([{ path: "server.ts", content: "" }])).toBe("server.ts");
    expect(findEntryPoint([{ path: "main.py", content: "" }])).toBe("main.py");
    expect(findEntryPoint([{ path: "README.md", content: "" }])).toBeNull();
  });

  it("analyzeMiddlewareChain collects express global, path and route middleware", () => {
    const map = analyzeMiddlewareChain(
      [
        {
          path: "app.js",
          content: `
app.use(cors)
app.use("/api", authMiddleware)
app.get("/users", requireAuth, (req, res) => res.json([]))
`,
        },
      ],
      "express",
    );
    expect(map.get("/|*")).toContain("cors");
    expect(map.get("/api|*")).toContain("authMiddleware");
    expect(map.get("/users")).toEqual(["requireAuth"]);
  });

  it("analyzeMiddlewareChain surfaces django global MIDDLEWARE under /|*", () => {
    const map = analyzeMiddlewareChain(
      [
        {
          path: "settings.py",
          content: `MIDDLEWARE = ["django.middleware.security.SecurityMiddleware", "custom.AuthMW"]`,
        },
      ],
      "django",
    );
    expect(map.get("/|*")).toEqual(
      expect.arrayContaining(["django.middleware.security.SecurityMiddleware", "custom.AuthMW"]),
    );
  });
});
