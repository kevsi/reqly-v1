import { NextResponse } from "next/server";

export function passthroughSSE(upstreamRes: Response): NextResponse {
  if (!upstreamRes.body) {
    return NextResponse.json({ error: "Upstream returned no body" }, { status: 502 });
  }
  return new NextResponse(upstreamRes.body, {
    status: upstreamRes.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  }) as NextResponse;
}
