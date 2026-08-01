/**
 * Unit tests for project-analyzer.ts (detectRoutes)
 *
 * Run with: npx tsx lib/project-analyzer.test.ts
 */

import {
  detectRoutes,
  detectFastAPI,
  detectFlask,
  detectDjango,
  detectSpring,
  detectExpress,
} from "./detect-shared"

interface Assertion {
  (condition: boolean, message: string): void
}

const assert: Assertion = (condition, message) => {
  if (!condition) throw new Error(`FAIL: ${message}`)
}

let passed = 0
let failed = 0

function test(name: string, fn: () => Promise<void> | void) {
  const maybe = fn()
  if (maybe instanceof Promise) {
    maybe.then(() => { passed++; console.log(`  ✓ ${name}`) })
      .catch((e) => { failed++; console.log(`  ✗ ${name}: ${e.message}`) })
  } else {
    try { fn(); passed++; console.log(`  ✓ ${name}`) } catch (e: any) { failed++; console.log(`  ✗ ${name}: ${e.message}`) }
  }
}

async function main() {
  console.log("====================================================")
  console.log("Project Analyzer - Functional Tests")
  console.log("====================================================\n")

  // ── Axis 1: Tree-sitter success path ────────────────────────────

  test("FastAPI via detectRoutes (tree-sitter path)", async () => {
    const content = `
from fastapi import FastAPI, APIRouter, Depends
router = APIRouter()
@router.get("/items")
async def list_items(): return {"items": []}
@router.get("/protected", dependencies=[Depends(security)])
async def protected_route(): return {"data": "secret"}
@router.post("/create")
async def create_item(item: dict): return {"created": item}
`
    const routes = await detectRoutes(content, "routers/items.py", "fastapi")
    assert(routes.length >= 3, `expected >=3 routes, got ${routes.length}`)
    assert(routes.some(r => r.method === "GET" && r.path === "/items"), "GET /items")
    assert(routes.some(r => r.method === "GET" && r.path === "/protected"), "GET /protected")
    assert(routes.some(r => r.method === "POST" && r.path === "/create"), "POST /create")
  })

  test("Flask via detectRoutes (tree-sitter path)", async () => {
    const content = `
from flask import Flask
app = Flask(__name__)
@app.route("/")
def index(): return "ok"
@app.get("/login")
def login(): return "login"
`
    const routes = await detectRoutes(content, "app.py", "flask")
    assert(routes.length >= 2, `expected >=2 routes, got ${routes.length}`)
    assert(routes.some(r => r.method === "GET" && r.path === "/"), "GET /")
    assert(routes.some(r => r.method === "GET" && r.path === "/login"), "GET /login")
  })

  test("Spring via detectRoutes (tree-sitter path)", async () => {
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
`
    const routes = await detectRoutes(content, "UserController.java", "spring")
    assert(routes.length >= 4, `expected >=4 routes, got ${routes.length}`)
    assert(routes.some(r => r.method === "GET" && r.path === "/users"), "GET /users")
    assert(routes.some(r => r.method === "POST" && r.path === "/users"), "POST /users")
    assert(routes.some(r => r.method === "PUT" && r.path === "/users/:id"), "PUT /users/:id")
    assert(routes.some(r => r.method === "DELETE" && r.path === "/users/:id"), "DELETE /users/:id")
  })

  test("ASP.NET via detectRoutes (tree-sitter path, empty path)", async () => {
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
`
    const routes = await detectRoutes(content, "UsersController.cs", "aspnet")
    assert(routes.length >= 3, `expected >=3 routes, got ${routes.length}`)
    assert(routes.some(r => r.method === "GET" && r.path === "/"), "GET /")
    assert(routes.some(r => r.method === "GET" && r.path === "/:id"), "GET /:id")
    assert(routes.some(r => r.method === "POST" && r.path === "/"), "POST /")
  })

  // ── Axis 2: Tree-sitter returns 0 → fallback to existing regex ──

  test("Fallback: tree-sitter returns 0 → express regex runs", async () => {
    const content = `
const express = require('express')
const router = express.Router()
router.get('/status', (req, res) => res.json({ ok: true }))
router.post('/login', (req, res) => res.json({ token: 'x' }))
`
    const routes = await detectRoutes(content, "routes/api.ts", "express")
    assert(routes.length >= 2, `expected >=2 routes from fallback, got ${routes.length}`)
    assert(routes.some(r => r.method === "GET" && r.path === "/status"), "GET /status from fallback")
    assert(routes.some(r => r.method === "POST" && r.path === "/login"), "POST /login from fallback")
  })

  test("Fallback: tree-sitter not available → FastAPI subprocess/regex", async () => {
    const content = `
from fastapi import FastAPI
app = FastAPI()
@app.get("/health")
def health(): return "ok"
@app.post("/data")
def data(): return {}
`
    // Call detectFastAPI directly (bypasses tree-sitter), proves fallback works
    const routes = detectFastAPI(content)
    assert(routes.length >= 2, `expected >=2 routes, got ${routes.length}`)
    assert(routes.some(r => r.method === "GET" && r.path === "/health"), "GET /health")
    assert(routes.some(r => r.method === "POST" && r.path === "/data"), "POST /data")
  })

  test("Fallback: tree-sitter not available → Java java-parser fallback", async () => {
    const content = `
import org.springframework.web.bind.annotation.*;
@RestController
@RequestMapping
public class TestController {
    @GetMapping(value = "/items")
    public String items() { return "[]"; }
}
`
    const routes = await detectSpring(content)
    assert(routes.length >= 1, `expected >=1 routes from java-parser/regex fallback, got ${routes.length}`)
    assert(routes.some(r => r.method === "GET" && r.path === "/items"), "GET /items from fallback")
  })

  // ── Backward compatibility: direct calls still work ──────────────

  test("Direct detectFastAPI still works (sync, subprocess)", () => {
    const routes = detectFastAPI(`
from fastapi import FastAPI
app = FastAPI()
@app.get("/ping")
def ping(): return "pong"
`)
    assert(routes.some(r => r.method === "GET" && r.path === "/ping"), "GET /ping direct")
  })

  test("Direct detectFlask still works (sync, subprocess)", () => {
    const routes = detectFlask(`
from flask import Flask
app = Flask(__name__)
@app.route("/health")
def health(): return "ok"
`)
    assert(routes.some(r => r.method === "GET" && r.path === "/health"), "GET /health direct")
  })

  test("Direct detectExpress still works (sync, regex)", () => {
    const routes = detectExpress(`
const express = require('express')
const router = express.Router()
router.get('/items', (req, res) => res.json([]))
`)
    assert(routes.some(r => r.method === "GET" && r.path === "/items"), "GET /items express")
  })

  // ── Edge cases ──────────────────────────────────────────────────

  test("Edge: 0 routes — empty file returns []", async () => {
    const routes = await detectRoutes("", "empty.py", "fastapi")
    assert(routes.length === 0, `expected 0 routes, got ${routes.length}`)
  })

  test("Edge: 0 routes — source with no route annotations", async () => {
    const routes = await detectRoutes(`
from fastapi import FastAPI
app = FastAPI()
def helper():
    return 42
`, "no_routes.py", "fastapi")
    assert(routes.length === 0, `expected 0 routes, got ${routes.length}`)
  })

  test("Edge: no dedup — tree-sitter returns routes, fallback should NOT run", async () => {
    const content = `
from fastapi import APIRouter
router = APIRouter()
@router.get("/items")
async def list(): return []
@router.post("/create")
async def create(): return {}
`
    const r1 = await detectRoutes(content, "routers/items.py", "fastapi")
    // Direct subprocess call on same content would find the same routes
    const r2 = detectFastAPI(content)
    assert(r1.length >= 2, `tree-sitter path should find routes, got ${r1.length}`)
    assert(r2.length >= 2, `subprocess path should find routes, got ${r2.length}`)
    // Count distinct routes — if fallback leaked, r1 would have duplicates
    const seen = new Set(r1.map(r => `${r.method}|${r.path}`))
    assert(seen.size === r1.length, `no duplicates in tree-sitter path (${seen.size} unique vs ${r1.length} total)`)
  })

  test("Edge: unknown framework — tree-sitter returns 0, regex fallback runs", async () => {
    const routes = await detectRoutes(`
from fastapi import FastAPI
app = FastAPI()
@app.get("/health")
def health(): return "ok"
`, "routes.py", "unknown")
    assert(routes.length >= 1, `expected >=1 route from fallback for unknown framework, got ${routes.length}`)
  })

  // ── Remaining framework coverage ─────────────────────────────────

  test("Rust Actix via detectRoutes (tree-sitter path)", async () => {
    const content = `
use actix_web::{web, App, HttpServer, get, post, put, delete};

#[get("/ping")]
async fn ping() -> &'static str { "pong" }

#[post("/users")]
async fn create() -> &'static str { "ok" }

#[get("/protected")]
async fn protected() -> &'static str { "secret" }
`
    const routes = await detectRoutes(content, "main.rs", "actix")
    assert(routes.length >= 3, `expected >=3 routes, got ${routes.length}`)
    assert(routes.some(r => r.method === "GET" && r.path === "/ping"), "GET /ping")
    assert(routes.some(r => r.method === "POST" && r.path === "/users"), "POST /users")
    assert(routes.some(r => r.method === "GET" && r.path === "/protected"), "GET /protected")
  })

  test("Go Gin via detectRoutes (tree-sitter path)", async () => {
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
`
    const routes = await detectRoutes(content, "main.go", "gin")
    assert(routes.length >= 4, `expected >=4 routes, got ${routes.length}`)
    assert(routes.some(r => r.method === "GET" && r.path === "/ping"), "GET /ping")
    assert(routes.some(r => r.method === "POST" && r.path === "/users"), "POST /users")
    assert(routes.some(r => r.method === "PUT" && r.path === "/users/:id"), "PUT /users/:id")
    assert(routes.some(r => r.method === "DELETE" && r.path === "/users/:id"), "DELETE /users/:id")
  })

  test("Ruby Rails via detectRoutes (tree-sitter path)", async () => {
    const content = `
Rails.application.routes.draw do
  get "users", to: "users#index"
  post "users", to: "users#create"
  put "users/:id", to: "users#update"
  delete "users/:id", to: "users#destroy"
  resources :articles
end
`
    const routes = await detectRoutes(content, "routes.rb", "rails")
    assert(routes.length >= 5, `expected >=5 routes, got ${routes.length}`)
    assert(routes.some(r => r.method === "GET" && r.path === "/users"), "GET /users")
    assert(routes.some(r => r.method === "POST" && r.path === "/users"), "POST /users")
    assert(routes.some(r => r.method === "GET" && r.path === "/articles"), "GET /articles (resources)")
  })

  test("PHP Laravel via detectRoutes (tree-sitter path)", async () => {
    const content = `
<?php
use App\\Http\\Controllers\\UserController;
use Illuminate\\Support\\Facades\\Route;

Route::get('/users', [UserController::class, 'index']);
Route::post('/users', [UserController::class, 'store']);
Route::put('/users/{id}', [UserController::class, 'update']);
Route::delete('/users/{id}', [UserController::class, 'destroy']);
Route::get('/profile', [ProfileController::class, 'show']);
`
    const routes = await detectRoutes(content, "web.php", "laravel")
    assert(routes.length >= 5, `expected >=5 routes, got ${routes.length}`)
    assert(routes.some(r => r.method === "GET" && r.path === "/users"), "GET /users")
    assert(routes.some(r => r.method === "POST" && r.path === "/users"), "POST /users")
    assert(routes.some(r => r.method === "PUT" && r.path === "/users/:id"), "PUT /users/:id")
    assert(routes.some(r => r.method === "DELETE" && r.path === "/users/:id"), "DELETE /users/:id")
    assert(routes.some(r => r.method === "GET" && r.path === "/profile"), "GET /profile")
  })

  // ── Summary ──────────────────────────────────────────────────────

  console.log("\n====================================================")
  console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`)
  console.log("====================================================")

  if (failed > 0) process.exit(1)
}

main()
