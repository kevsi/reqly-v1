export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limiter";
import { runCollection } from "@/lib/test-runner/runner";
import { toJUnitXml } from "@/lib/test-runner/junit-export";
import { loadJsonDataset, loadCsvDataset } from "@/lib/test-runner/data-driven";
import { isPublicWebDeployment, isOriginAllowedForDesktopCSRF } from "@/lib/environment";
import type { Collection, RequestItem } from "@/hooks/request-types";

async function proxyFetch(
  req: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
  },
  baseUrl: string,
) {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  const proxyRes = await fetch(`${baseUrl}/api/proxy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: req.url,
      method: req.method,
      headers: req.headers,
      body: req.body,
    }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));
  const proxyResult = await proxyRes.json();
  const text = proxyResult.body ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return {
    statusCode: proxyResult.status ?? proxyRes.status,
    responseTimeMs: Date.now() - started,
    body: parsed,
    headers: proxyResult.headers || {},
  };
}

const rateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 10 });

// Caps so a single anonymous request cannot trigger a large collection scan
// or megabytes of user code/iterations (CPU DoS guard on the shared runtime).
const MAX_REQUESTS_PER_COLLECTION = 100;
const MAX_SCRIPT_BYTES = 200_000;
const MAX_DATASET_BYTES = 1_000_000;

function scriptBytes(req: RequestItem): number {
  const pre = (req as unknown as { preRequestScript?: string }).preRequestScript ?? "";
  const post = (req as unknown as { postResponseScript?: string }).postResponseScript ?? "";
  return pre.length + post.length;
}

function getRateLimitKey(request: NextRequest): string {
  if (process.env.TRUSTED_PROXY === "true") {
    const forwarded = request.headers.get("x-forwarded-for");
    return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "127.0.0.1";
  }
  return "unknown";
}

interface RunBody {
  collection: Collection;
  environment?: Record<string, string>;
  dataset?: { format: "json" | "csv"; content: string };
}

export async function POST(req: NextRequest) {
  // 🔐 SECURITY: Block test runner on public web deployment
  // Test runner accepts arbitrary code via scripts, only safe on desktop
  if (isPublicWebDeployment()) {
    return NextResponse.json(
      { error: "Test runner is not available on web deployment. Use the desktop application." },
      { status: 403 },
    );
  }

  // 🔐 SECURITY (audit 2026-09-03): CSRF guard desktop.
  if (!isOriginAllowedForDesktopCSRF(req.headers.get("origin"))) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }

  const rateKey = getRateLimitKey(req);
  const rateResult = await rateLimiter.check(rateKey);
  if (!rateResult.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let body: RunBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.collection) {
    return NextResponse.json({ error: "Missing collection" }, { status: 400 });
  }

  if (!Array.isArray(body.collection.requests) || body.collection.requests.length === 0) {
    return NextResponse.json(
      { error: "Collection must contain at least one request" },
      { status: 400 },
    );
  }
  if (body.collection.requests.length > MAX_REQUESTS_PER_COLLECTION) {
    return NextResponse.json(
      { error: `Collection exceeds ${MAX_REQUESTS_PER_COLLECTION} requests` },
      { status: 400 },
    );
  }
  const totalScriptBytes = body.collection.requests.reduce((n, r) => n + scriptBytes(r), 0);
  if (totalScriptBytes > MAX_SCRIPT_BYTES) {
    return NextResponse.json(
      { error: "Collection scripts exceed the size limit" },
      { status: 400 },
    );
  }
  if (body.dataset && body.dataset.content.length > MAX_DATASET_BYTES) {
    return NextResponse.json({ error: "Dataset exceeds the size limit" }, { status: 400 });
  }

  let iterations;
  if (body.dataset) {
    const rows =
      body.dataset.format === "json"
        ? loadJsonDataset(body.dataset.content)
        : loadCsvDataset(body.dataset.content);
    iterations = rows.map((row, i) => ({
      environment: body.environment ?? {},
      iterationData: row,
      iterationIndex: i,
      log: () => {},
    }));
  }

  const report = await runCollection(
    body.collection,
    { environment: body.environment ?? {}, iterationData: {}, iterationIndex: 0, log: () => {} },
    {
      executor: (r) => proxyFetch(r, process.env.NEXT_PUBLIC_API_URL || new URL(req.url).origin),
      iterations,
      scriptTimeoutMs: 3000,
      disableScripts: true,
    },
  );

  const hasScripts = body.collection.requests.some(
    (r) => r.preRequestScript?.trim() || r.postResponseScript?.trim(),
  );
  const warnings = hasScripts ? ["scripts_disabled_server"] : [];

  const url = new URL(req.url);
  if (url.searchParams.get("format") === "junit") {
    return new NextResponse(toJUnitXml(report), {
      status: 200,
      headers: { "content-type": "application/xml" },
    });
  }
  return NextResponse.json(warnings.length > 0 ? { ...report, warnings } : report);
}
