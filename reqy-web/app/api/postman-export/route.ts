export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limiter";
import { postmanFetchJson, PostmanApiError } from "@/lib/postman";
import { getApiKeyFromRequest } from "../postman-auth/cookies";

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

interface CreateCollectionResponse {
  collection?: { uid?: string; id?: string };
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

  let body: ExportBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body", code: "PARSE_ERROR" },
      { status: 400 },
    );
  }

  if (!body.requests || !Array.isArray(body.requests)) {
    return NextResponse.json(
      { error: "Missing or invalid requests array", code: "INVALID_INPUT" },
      { status: 400 },
    );
  }

  // The PMAK key lives in an httpOnly cookie set by /api/postman-auth.
  // Without it (desktop statique / non connecté) there is no export.
  const apiKey = getApiKeyFromRequest(request);
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "postman_not_connected",
        message: "Connectez-vous à Postman avant d'exporter vos collections.",
      },
      { status: 409 },
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

  try {
    const data = await postmanFetchJson<CreateCollectionResponse>(apiKey, "/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collection: postmanCollection }),
    });

    const postmanUid = data?.collection?.uid ?? data?.collection?.id ?? null;
    return NextResponse.json({
      exported: true,
      totalRequests: body.requests.length,
      message: `Collection "${collectionName}" créée dans Postman (${body.requests.length} requête(s))`,
      ...(postmanUid
        ? { postmanUid, url: `https://go.postman.co/workspace/~?collection=${postmanUid}` }
        : {}),
    });
  } catch (err) {
    if (err instanceof PostmanApiError) {
      if (err.status === 401 || err.status === 403) {
        return NextResponse.json(
          {
            error: "postman_invalid_key",
            message: "Clé API Postman invalide ou expirée, reconnectez-vous.",
          },
          { status: err.status },
        );
      }
      if (err.status === 429) {
        return NextResponse.json(
          {
            error: "postman_rate_limited",
            message: "Limite de requêtes Postman atteinte, réessayez plus tard.",
          },
          { status: 429 },
        );
      }
      if (err.status === 0) {
        return NextResponse.json(
          {
            error: "postman_network_error",
            message: "Postman est injoignable, vérifiez votre connexion et réessayez.",
          },
          { status: 502 },
        );
      }
      return NextResponse.json(
        { error: "postman_api_error", message: err.message },
        {
          status: err.status >= 400 ? err.status : 502,
        },
      );
    }
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json(
        {
          error: "postman_network_error",
          message: "Postman n'a pas répondu à temps, réessayez.",
        },
        { status: 504 },
      );
    }
    // Non-Postman failures reaching this point are transport-level
    // (fetch rejects with TypeError on DNS/socket errors).
    return NextResponse.json(
      {
        error: "postman_network_error",
        message: "Postman est injoignable, vérifiez votre connexion et réessayez.",
      },
      { status: 502 },
    );
  }
}
