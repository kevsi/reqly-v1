/**
 * Proxy workspace join (via invitation link) to the sync server.
 *
 * POST /api/workspaces/join → POST /api/memberships (sync server)
 */
import { NextRequest } from "next/server";
import { proxyToSync } from "@/lib/workspace-proxy";

export async function POST(request: NextRequest) {
  return proxyToSync("/api/memberships", request);
}
