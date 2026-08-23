export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limiter";
import { postmanFetchJson, PostmanApiError, extractPostmanCollection } from "@/lib/postman";
import { getApiKeyFromRequest } from "../../postman-auth/cookies";

const rateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });

function getRateLimitKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "127.0.0.1";
}

const bodySchema = {
  parse(input: unknown): { collectionId: string } {
    if (!input || typeof input !== "object") {
      throw new Error("collectionId requis");
    }
    const id = (input as { collectionId?: unknown }).collectionId;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("collectionId requis");
    }
    return { collectionId: id };
  },
};

export async function POST(request: NextRequest) {
  const rateKey = getRateLimitKey(request);
  const rateResult = await rateLimiter.check(rateKey);
  if (!rateResult.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ message: "Body JSON invalide" }, { status: 400 });
  }

  let parsed: { collectionId: string };
  try {
    parsed = bodySchema.parse(raw);
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "collectionId requis" },
      { status: 400 },
    );
  }

  const apiKey = getApiKeyFromRequest(request);
  if (!apiKey) {
    return NextResponse.json({ message: "Non connecté à Postman" }, { status: 401 });
  }

  try {
    const data = await postmanFetchJson<{
      collection: { info?: { name?: string; description?: string }; item?: unknown[] };
    }>(apiKey, `/collections/${parsed.collectionId}`);
    const collection = data.collection;
    const { folders, requests } = extractPostmanCollection(collection?.item ?? []);
    const name =
      typeof collection?.info?.name === "string" ? collection.info.name : "Postman Collection";

    return NextResponse.json({
      collectionId: parsed.collectionId,
      name,
      folders,
      requests,
    });
  } catch (error) {
    if (error instanceof PostmanApiError) {
      return NextResponse.json(
        { message: error.message },
        { status: error.status === 401 ? 401 : 400 },
      );
    }
    return NextResponse.json(
      { message: "Erreur lors de la récupération de la collection" },
      { status: 500 },
    );
  }
}
