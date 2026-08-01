/**
 * Proxy workspace API calls to the sync server.
 *
 * GET  /api/workspaces  → list workspaces for the current user
 * POST /api/workspaces  → create a new workspace (owner)
 */
import { NextRequest } from "next/server";
import { proxyToSync } from "@/lib/workspace-proxy";

export async function GET(request: NextRequest) {
  return proxyToSync("/api/workspaces", request);
}

export async function POST(request: NextRequest) {
  return proxyToSync("/api/workspaces", request);
}
