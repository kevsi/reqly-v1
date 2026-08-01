export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limiter";
import { runCollection } from "@/lib/test-runner/runner";
import { toJUnitXml } from "@/lib/test-runner/junit-export";
import { loadJsonDataset, loadCsvDataset } from "@/lib/test-runner/data-driven";
import type { Collection } from "@/hooks/request-types";

async function proxyFetch(req: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}) {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  const proxyRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ""}/api/proxy`, {
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

function getRateLimitKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "127.0.0.1";
}

interface RunBody {
  collection: Collection;
  environment?: Record<string, string>;
  dataset?: { format: "json" | "csv"; content: string };
}

export async function POST(req: NextRequest) {
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
    { executor: proxyFetch, iterations },
  );

  const url = new URL(req.url);
  if (url.searchParams.get("format") === "junit") {
    return new NextResponse(toJUnitXml(report), {
      status: 200,
      headers: { "content-type": "application/xml" },
    });
  }
  return NextResponse.json(report);
}
