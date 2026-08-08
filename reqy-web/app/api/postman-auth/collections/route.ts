export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rate-limiter";
import { postmanFetchJson, PostmanApiError } from "@/lib/postman";

const rateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });

function getRateLimitKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "127.0.0.1";
}

type CollectionItem = {
  request?: unknown;
  item?: CollectionItem[];
};

type CollectionData = {
  item?: CollectionItem[];
  summary?: { totalRequests?: number; requestCount?: number };
  requestCount?: number;
  totalRequests?: number;
};

async function fetchCollectionDetails(
  apiKey: string,
  collectionId: string,
): Promise<CollectionData | null> {
  try {
    const data = await postmanFetchJson<{ collection?: CollectionData }>(
      apiKey,
      `/collections/${collectionId}`,
    );
    return data?.collection ?? null;
  } catch {
    return null;
  }
}

function countCollectionItems(collection: CollectionData | null | undefined): number {
  if (!collection) return 0;
  const countItems = (items: CollectionItem[] | undefined): number => {
    if (!Array.isArray(items)) return 0;
    return items.reduce((total, item) => {
      if (item.request) return total + 1;
      if (item.item) return total + countItems(item.item);
      return total;
    }, 0);
  };
  if (Array.isArray(collection.item)) {
    return countItems(collection.item);
  }
  if (collection.summary?.totalRequests != null) return collection.summary.totalRequests;
  if (collection.summary?.requestCount != null) return collection.summary.requestCount;
  if (collection.requestCount != null) return collection.requestCount;
  if (collection.totalRequests != null) return collection.totalRequests;
  return 0;
}

export async function GET(request: NextRequest) {
  const rateKey = getRateLimitKey(request);
  const rateResult = await rateLimiter.check(rateKey);
  if (!rateResult.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const apiKey = request.cookies.get("postman_api_key")?.value;
  if (!apiKey) {
    return NextResponse.json({ message: "Non connecté à Postman" }, { status: 401 });
  }

  try {
    const rawData = await postmanFetchJson<{ collections?: Array<Record<string, unknown>> }>(
      apiKey,
      "/collections",
    );
    const collectionsData = Array.isArray(rawData?.collections) ? rawData!.collections! : [];
    const collections = await Promise.all(
      collectionsData.map(async (col) => {
        const id = (col.uid ?? col.id) as string | undefined;
        const name = col.name as string | undefined;
        let count = countCollectionItems(col as unknown as CollectionData);
        if (count === 0 && id) {
          const detailData = await fetchCollectionDetails(apiKey, id);
          count = countCollectionItems(detailData);
        }
        return { id, name: name ?? "Untitled", requests: count, items: count };
      }),
    );
    return NextResponse.json({ collections });
  } catch (error) {
    const status = error instanceof PostmanApiError ? error.status : 500;
    return NextResponse.json(
      { message: "Erreur lors de la récupération des collections" },
      { status },
    );
  }
}
