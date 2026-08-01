/**
 * Proxy workspace members API calls to the sync server.
 *
 * GET /api/workspaces/:id/members → list members of a workspace
 */
import { NextRequest } from "next/server";
import { proxyToSync, workspacePath } from "@/lib/workspace-proxy";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyToSync(workspacePath("/api/workspaces/:id/members", { id }), request);
}
