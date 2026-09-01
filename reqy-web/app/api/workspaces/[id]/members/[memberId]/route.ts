/**
 * Proxy workspace member management calls to the sync server.
 *
 * PATCH /api/workspaces/:id/members/:memberId → change a member's role
 * DELETE /api/workspaces/:id/members/:memberId → remove a member
 */
import { NextRequest } from "next/server";
import { proxyToSync } from "@/lib/workspace-proxy";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  const { id, memberId } = await params;
  const path = `/api/workspaces/${encodeURIComponent(id)}/members/${encodeURIComponent(memberId)}`;
  return proxyToSync(path, request);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  const { id, memberId } = await params;
  const path = `/api/workspaces/${encodeURIComponent(id)}/members/${encodeURIComponent(memberId)}`;
  return proxyToSync(path, request);
}
