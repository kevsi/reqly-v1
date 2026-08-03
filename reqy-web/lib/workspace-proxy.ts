/**
 * Shared proxy helper for workspace API routes.
 *
 * All 5 Next.js workspace route files do the same thing: forward a request
 * to the sync server (`NEXT_PUBLIC_SYNC_URL`) preserving auth and method.
 * This helper eliminates that duplication.
 */
import { NextRequest, NextResponse } from "next/server";

const SYNC_URL =
  (process.env.NEXT_PUBLIC_SYNC_URL ?? "https://reqly.duckdns.org").replace(/\/$/, "");

/**
 * Forward a request to the sync server.
 *
 * @param syncPath  Path on the sync server, e.g. `/api/workspaces` or
 *                  `/api/workspaces/:id/members`.
 * @param request   The incoming NextRequest whose auth + method + body are
 *                  forwarded.
 * @param init      Optional overrides (method, body). When omitted the
 *                  original request method and body are used.
 */
export async function proxyToSync(
  syncPath: string,
  request: NextRequest,
  init?: { method?: string; body?: string },
): Promise<NextResponse> {
  const url = `${SYNC_URL}${syncPath}`;
  const headers = new Headers();

  // Forward the user's Authorization header (session token) to the sync server
  const auth = request.headers.get("authorization");
  if (auth) headers.set("authorization", auth);

  const ct = request.headers.get("content-type");
  if (ct) headers.set("content-type", ct);

  try {
    const res = await fetch(url, {
      method: init?.method ?? request.method,
      headers,
      body:
        init?.body ??
        (request.method !== "GET" && request.method !== "HEAD"
          ? await request.text()
          : undefined),
    });

    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync server unreachable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/**
 * Build a sync server path by interpolating an :id parameter.
 * Ensures the id is URI-encoded to prevent path traversal.
 */
export function workspacePath(
  template: string,
  params: { id?: string },
): string {
  let path = template;
  if (params.id) {
    path = path.replace(":id", encodeURIComponent(params.id));
  }
  return path;
}
