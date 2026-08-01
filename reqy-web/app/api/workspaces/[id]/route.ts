/**
 * Proxy workspace-by-ID API calls to the sync server.
 *
 * DELETE /api/workspaces/:id  → delete a workspace (owner only)
 * PUT    /api/workspaces/:id  → rename a workspace (owner only)
 */
import { NextRequest } from "next/server";
import { proxyToSync, workspacePath } from "@/lib/workspace-proxy";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyToSync(workspacePath("/api/workspaces/:id", { id }), request);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyToSync(workspacePath("/api/workspaces/:id", { id }), request);
}
