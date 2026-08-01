/**
 * Proxy workspace invitation API calls to the sync server.
 *
 * POST /api/workspaces/:id/invitations → create an invitation link (owner only)
 */
import { NextRequest } from "next/server";
import { proxyToSync, workspacePath } from "@/lib/workspace-proxy";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyToSync(workspacePath("/api/workspaces/:id/invitations", { id }), request);
}
