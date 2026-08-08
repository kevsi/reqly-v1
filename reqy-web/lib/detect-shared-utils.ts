/**
 * Language, framework, and port detection utilities.
 */

import { stripLanguageCommentsAndStrings, LANGUAGE_EXTENSION_MAP } from "@/lib/detect-shared-types";

// ── Language detection ──────────────────────────────────────────────────────

export function detectLanguage(files: { path: string; content: string }[]): string {
  const counts: Record<string, number> = {};
  for (const file of files) {
    const ext = file.path.split(".").pop()?.toLowerCase() || "";
    for (const [language, exts] of Object.entries(LANGUAGE_EXTENSION_MAP)) {
      if (exts.includes(ext)) {
        counts[language] = (counts[language] || 0) + 1;
        break;
      }
    }
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 0 && sorted[0][1] > (sorted[1]?.[1] ?? 0)) return sorted[0][0];
  const all = files.map((f) => f.content).join("\n");
  const sanitized = stripLanguageCommentsAndStrings(all);

  if (/from\s+fastapi\s+import|FastAPI\s*\(|@app\.get|@router\.post/.test(all)) return "Python";
  if (/from\s+flask\s+import|@app\.route|Flask\(/.test(all)) return "Python";
  if (/from\s+django\.|from\s+rest_framework|urlpatterns\s*=\s*\[|@login_required/.test(all))
    return "Python";
  if (/from\s+tornado\\.web|RequestHandler/.test(all)) return "Python";
  if (
    /from\s+sanic\.|Sanic\(|from\s+litestar\.|Litestar\s*\(|from\s+starlette\.|uvicorn\.|asgi\//.test(
      all,
    )
  )
    return "Python";
  if (/Rails\.application\.routes\.draw|class.*<\s*ApplicationController|def\s+create/.test(all))
    return "Ruby";
  if (/Sinatra::|get\s+['"]\//.test(all)) return "Ruby";
  if (
    /package\s+main/.test(all) &&
    /func\s+main\(\)|http\.HandleFunc|mux\.HandleFunc|router\.GET/.test(all)
  )
    return "Go";
  if (/gin\.|echo\.|fiber\.|chi\./.test(all)) return "Go";
  if (
    /(?:@RestController|@RequestMapping|@GetMapping|@PostMapping|@PutMapping|@DeleteMapping)/.test(
      sanitized,
    ) &&
    /(?:org\.springframework|spring\.boot\.)/.test(sanitized)
  )
    return "Java";
  if (/@SpringBootApplication|spring\.boot\./.test(sanitized)) return "Java";
  if (
    /(?:io\.micronaut\.|@MicronautApplication|micronaut\.http\.|@Controller\(|@(Get|Post|Put|Delete|Patch)\b)/.test(
      sanitized,
    ) &&
    /(?:io\.micronaut\.|micronaut\.)/.test(sanitized)
  )
    return "Java";
  if (
    /(?:io\.quarkus\.|quarkus\.|@QuarkusMain|@Path\(|(?:javax|jakarta)\.ws\.rs\.)/.test(sanitized)
  )
    return "Java";
  if (
    /WebApplication\.CreateBuilder\(|MapGet\(|MapPost\(|app\.MapControllers|namespace.*Microsoft/.test(
      all,
    )
  )
    return "CSharp";
  if (/\.NET|ASP\.NET|IActionResult|[Cc]ontroller\s*:\s*Controller/.test(all)) return "CSharp";
  if (/fun\s+main\(/.test(all) && /val\s+|var\s+/.test(all) && /object|class/.test(all))
    return "Kotlin";
  if (/ktor\.|routing\s*\{/.test(all)) return "Kotlin";
  if (
    /import\s+Vapor|Vapor\.|Application\(|app\.http|app\.(?:get|post|put|delete|patch)\s*\(/.test(
      all,
    )
  )
    return "Swift";
  if (/func\s+routes\(|router\.(?:get|post|put|delete|patch)|AsyncHTTPServer/.test(all))
    return "Swift";
  if (/fn\s+main\(\)|use\s+axum|use\s+actix|use\s+rocket|axum::|actix_web::|rocket::/.test(all))
    return "Rust";
  if (/#\[tokio::main\]|#\[actix_web::|#\[rocket::main\]/.test(all)) return "Rust";
  if (/Route::|Laravel|Illuminate|app\/Http\/Controllers/.test(all)) return "PHP";
  if (/@php\/framework|<?php|function\s+store\(Request/.test(all)) return "PHP";
  if (/\bconsole\.log\(|\bimport\s+React|export\s+default|require\(/.test(sanitized))
    return "JavaScript";
  if (/from\s+['"](express|next|fastify|koa)['"]|app\.get\(|app\.post\(/.test(sanitized))
    return "JavaScript";
  if (/mix\.exs|Phoenix\.Router|use\s+Phoenix|plug\.|phoenix\./i.test(all)) return "Elixir";
  if (/import\s+Network\.Wai|import\s+Servant|servant-server|warp\.|wai\./i.test(all))
    return "Haskell";
  return "Unknown";
}

// ── Framework detection ────────────────────────────────────────────────────

export function detectFramework(files: { path: string; content: string }[]): string {
  if (files.length === 0) return "unknown";

  const pkgJson = files.find((f) => f.path.endsWith("package.json"));
  if (pkgJson) {
    try {
      const pkg = JSON.parse(pkgJson.content);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.next || deps["next-auth"]) return "nextjs";
      if (deps.express) return "express";
      if (deps.fastify) return "fastify";
      if (deps.koa) return "koa";
      if (deps["@hapi/hapi"]) return "hapi";
      if (deps["@nestjs/core"] || deps["@nestjs/common"]) return "nestjs";
      if (deps.fastapi) return "fastapi";
      if (deps.flask) return "flask";
      if (deps.django) return "django";
      if (deps.tornado) return "tornado";
      if (deps.sanic) return "sanic";
      if (deps.starlette) return "starlette";
      if (deps.litestar || deps.starlite) return "litestar";
      if (deps.aiohttp) return "aiohttp";
      if (deps.falcon) return "falcon";
      if (deps.rails) return "rails";
      if (deps.sinatra) return "sinatra";
      if (deps["@phoenix/phoenix"]) return "phoenix";
      if (deps["spring-boot"]) return "spring";
      if (deps.micronaut) return "micronaut";
      if (deps.quarkus) return "quarkus";
      if (deps["asp.net"] || deps["dotnet"]) return "aspnet";
      if (deps.gin || deps.echo || deps.fiber || deps.chi || deps["github.com/gin-gonic/gin"])
        return "go";
      if (deps.ktor) return "kotlin";
      if (deps.vapor) return "swift";
      if (deps.axum || deps.actix || deps.rocket) return "rust";
      if (deps.servant || deps.warp) return "haskell";
      if (deps.laravel || deps["laravel/framework"]) return "laravel";
    } catch {}
  }

  const paths = files.map((f) => f.path.replace(/\\/g, "/")).join("\n");
  const all = files.map((f) => f.content).join("\n");
  const sanitized = stripLanguageCommentsAndStrings(all);

  if (/next\.config\.(js|ts|mjs)/.test(paths)) return "nextjs";
  if (/composer\.json/.test(paths) && /laravel/.test(all)) return "laravel";
  if (/mix\.exs/.test(paths)) return "phoenix";
  if (/go\.mod|go\.sum/.test(paths)) return "go";
  if (/Cargo\.toml/.test(paths)) return "rust";
  if (/Gemfile|\.rb$/.test(paths)) return "rails";
  if (/pom\.xml|build\.gradle/.test(paths)) return "spring";
  if (/\.kt$/.test(paths)) return "kotlin";
  if (/pyproject\.toml|requirements\.txt|setup\.py/.test(paths)) return "fastapi";

  if (/from\s+['"]?next['"]?|next\/(?:server|router|link)|next\.config/.test(sanitized))
    return "nextjs";
  if (
    /require\s*\(\s*['"]express['"]|from\s+['"]express['"]|app\s*\.\s*(?:get|post|put|patch|delete)\s*\(|router\s*\.\s*(?:get|post)\s*\(/.test(
      sanitized,
    )
  )
    return "express";
  if (/from\s+['"]fastify['"]|fastify\s*\(|fastify\s*\.\s*(?:get|post|put|delete)/.test(sanitized))
    return "fastify";
  if (/from\s+['"]koa['"]|new\s+Koa\s*\(/.test(sanitized)) return "koa";
  if (/@hapi\/hapi|Hapi\s*\.\s*server\(|server\s*\.\s*(?:start|route)\(/.test(sanitized))
    return "hapi";
  if (/@nestjs\/|@Controller\s*\(|@Get\s*\(|@Post\s*\(|@UseGuards|@UseMiddleware/.test(all))
    return "nestjs";
  if (
    /from\s+fastapi|FastAPI\s*\(|@app\s*\.\s*(?:get|post|put|delete|patch)|@router\s*\.\s*(?:get|post|put|delete|patch)/.test(
      all,
    )
  )
    return "fastapi";
  if (
    /from\s+flask|@(?:[A-Za-z_][\w.]*\s*\.\s*)?(?:route|get|post|put|delete|patch)\s*\(|Flask\s*\(/.test(
      all,
    )
  )
    return "flask";
  if (
    /from\s+django|from\s+rest_framework|urlpatterns\s*=\s*\[|@(?:login_required|permission_required|user_passes_test)/.test(
      all,
    )
  )
    return "django";
  if (/from\s+tornado\\.web|RequestHandler\b/.test(all)) return "tornado";
  if (/from\s+(?:litestar|starlite)|(?:Litestar|Starlite)\s*\(/.test(all)) return "litestar";
  if (/from\s+starlette|Route\s*\(|Mount\s*\(/.test(all)) return "starlette";
  if (/from\s+sanic|Sanic\s*\(/.test(all)) return "sanic";
  if (/from\s+aiohttp|aiohttp\\.web\.Application|app\s*\.\s*router\s*\.\s*add_/.test(all))
    return "aiohttp";
  if (
    /from\s+falcon|falcon\.API|app\s*\.\s*add_route|on_(?:get|post|put|patch|delete)\s*\(/.test(all)
  )
    return "falcon";
  if (/Rails\.application\.routes\.draw|class\s+\w+\s*<\s*ApplicationController/.test(all))
    return "rails";
  if (/Sinatra\s*::|^get\s+['"]\/|^post\s+['"]\//.test(all)) return "sinatra";
  if (/Phoenix\.Router|use\s+Phoenix|plug\s*\.|phoenix\./.test(all)) return "phoenix";
  if (
    /(?:@RestController|@RequestMapping|@GetMapping|@PostMapping)\s*\(/.test(sanitized) &&
    /org\.springframework/.test(sanitized)
  )
    return "spring";
  if (/io\.micronaut\.|@MicronautApplication|@Controller\s*\(/.test(sanitized)) return "micronaut";
  if (/io\.quarkus\.|@QuarkusMain|@Path\s*\(|javax\.ws\.rs|jakarta\.ws\.rs/.test(sanitized))
    return "quarkus";
  if (/(?:@RestController|@Controller|@GetMapping|@PostMapping)\s*\(/.test(sanitized))
    return "spring";
  if (
    /WebApplication\.CreateBuilder|MapGet\s*\(|MapPost\s*\(|app\.MapControllers|Microsoft\.AspNetCore/.test(
      sanitized,
    )
  )
    return "aspnet";
  if (
    /package\s+main\b/.test(all) &&
    /(?:func\s+main\(\)|http\.HandleFunc|mux\.HandleFunc)/.test(all)
  )
    return "go";
  if (
    /(?:gin\.|echo\.|fiber\.|chi\.|gorilla\/mux\.Router)/.test(all) &&
    /func\s+main\(\)/.test(all)
  )
    return "go";
  if (/fun\s+main\s*\(/.test(all) && /(?:ktor\.|routing\s*\{)/.test(all)) return "kotlin";
  if (/import\s+Vapor|Application\s*\(|app\.http|routes\s*\(/.test(all)) return "swift";
  if (
    /fn\s+main\s*\(|#\[tokio::main\]|use\s+(?:axum|actix|rocket)|(?:axum|actix_web|rocket)\s*::/.test(
      all,
    )
  )
    return "rust";
  if (/import\s+(?:Servant|Wai\.Application)|servant\-server|warp\s*::/.test(all)) return "haskell";
  if (/Route::|Illuminate\\\\|app\/Http\/Controllers|Laravel/.test(all)) return "laravel";

  return "unknown";
}

// ── Port detection ─────────────────────────────────────────────────────────

const PORT_PATTERNS: RegExp[] = [
  /\.listen\(\s*(\d{4,5})(?:\s*,|\s*\))/,
  /\.listen\(\s*process\.env\.PORT\s*\|\|\s*(\d{4,5})(?:\s*,|\s*\))/,
  /process\.env\.PORT\s*\|\|\s*(\d{4,5})/,
  /uvicorn\.run\([\s\S]*?port\s*[:=]\s*(\d{4,5})/,
  /app\.run\([\s\S]*?port\s*[:=]\s*(\d{4,5})/,
  /PORT\s*=\s*(\d{4,5})/,
];

export function detectPort(files: { path: string; content: string }[]): number | undefined {
  const all = files.map((f) => f.content).join("\n");
  for (const p of PORT_PATTERNS) {
    p.lastIndex = 0;
    const m = p.exec(all);
    if (m) return parseInt(m[1], 10);
  }
  return undefined;
}

export function defaultPortForFramework(framework: string): number | undefined {
  const ports: Record<string, number> = {
    fastapi: 8000,
    flask: 5000,
    django: 8000,
    express: 3000,
    nextjs: 3000,
    nestjs: 3000,
    laravel: 8000,
    rails: 3000,
    spring: 8080,
    quarkus: 8080,
    micronaut: 8080,
    aspnet: 5000,
    go: 8080,
  };
  return ports[framework];
}
