export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limiter";

const rateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });

function getRateLimitKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "127.0.0.1";
}

interface ExportRequest {
  name: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

interface ExportBody {
  name?: string;
  description?: string;
  requests: ExportRequest[];
}

function buildPostmanItem(request: ExportRequest) {
  const headers = Object.entries(request.headers || {}).map(([key, value]) => ({
    key,
    value: String(value),
  }));

  const requestBody: Record<string, unknown> = {
    method: request.method || "GET",
    header: headers,
    url: {
      raw: request.url || "/",
    },
  };

  if (request.body) {
    requestBody.body = {
      mode: "raw",
      raw: request.body,
      options: {
        raw: {
          language: "json",
        },
      },
    };
  }

  return {
    name: request.name || `${request.method} ${request.url}`,
    request: requestBody,
  };
}

export async function POST(request: NextRequest) {
  const rateKey = getRateLimitKey(request);
  const rateResult = await rateLimiter.check(rateKey);
  if (!rateResult.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  try {
    const body: ExportBody = await request.json();

    if (!body.requests || !Array.isArray(body.requests)) {
      return NextResponse.json(
        { error: "Missing or invalid requests array", code: "INVALID_INPUT" },
        { status: 400 },
      );
    }

    const collectionName = body.name || "Reqly Export";
    const description = body.description || "Export from Reqly";

    const postmanCollection = {
      info: {
        name: collectionName,
        description,
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      },
      item: body.requests.map(buildPostmanItem),
    };

    return NextResponse.json({
      collection: postmanCollection,
      message: `Collection "${collectionName}" prepared with ${body.requests.length} request(s)`,
      exported: true,
      totalRequests: body.requests.length,
    });
  } catch {
    return NextResponse.json(
      { error: "Invalid request body", code: "PARSE_ERROR" },
      { status: 400 },
    );
  }
}
