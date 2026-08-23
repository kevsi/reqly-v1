import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, type AuthContext } from "../auth.js";
import {
  getChangesSince,
  POLL_PAGE_LIMIT_DEFAULT,
  isMember,
  canWrite,
  pushChanges,
  type LocalChange,
} from "../sync-engine.js";
import { broadcastToWorkspace } from "../ws-hub.js";
import { safeParseJson } from "../validation.js";

const sync = new Hono<{ Variables: { auth: AuthContext } }>();
sync.use("*", requireAuth);

const PushSchema = z.object({
  workspaceId: z.string(),
  changes: z.array(
    z.object({
      entityType: z.enum(["collection", "environment", "folder"]),
      id: z.string(),
      data: z.record(z.any()),
      updatedAt: z.number(),
      updatedBy: z.string(),
      baseVersion: z.number().optional(),
      deleted: z.boolean().optional(),
    }),
  ),
});

sync.get("/poll", (c) => {
  const auth = c.get("auth") as AuthContext;
  const workspaceId = c.req.query("workspaceId");
  const sinceRaw = c.req.query("since");
  // Validate since: must be a non-negative integer string if provided
  if (sinceRaw !== undefined && sinceRaw !== null && !/^\d+$/.test(sinceRaw)) {
    return c.json({ error: "Invalid 'since' parameter; expected a non-negative integer" }, 400);
  }
  const since = Number(sinceRaw ?? "0");
  if (!workspaceId) return c.json({ error: "Missing workspaceId" }, 400);
  if (!isMember(workspaceId, auth.userId)) return c.json({ error: "Not a member" }, 403);

  // Optional keyset cursor from the previous page (`${updatedAt}|${id}`).
  const cursorRaw = c.req.query("cursor") ?? null;
  if (cursorRaw !== null && !/^\d+\|.+$/.test(cursorRaw)) {
    return c.json({ error: "Invalid 'cursor' parameter; expected '<updatedAt>|<id>'" }, 400);
  }
  // Optional page size; the engine clamps it into [1, POLL_PAGE_LIMIT_MAX].
  const limitRaw = c.req.query("limit");
  let limit: number | undefined = POLL_PAGE_LIMIT_DEFAULT;
  if (limitRaw !== undefined) {
    if (!/^\d+$/.test(limitRaw) || Number(limitRaw) < 1) {
      return c.json({ error: "Invalid 'limit' parameter; expected a positive integer" }, 400);
    }
    limit = Number(limitRaw);
  }

  const { changes, nextCursor, hasMore } = getChangesSince(workspaceId, since, cursorRaw, limit);
  return c.json({ changes, nextCursor, hasMore, serverTime: Date.now() });
});

sync.post("/push", async (c) => {
  const auth = c.get("auth") as AuthContext;
  const parsed = await safeParseJson(c, PushSchema);
  if (!parsed.success) return parsed.response;
  const body = parsed.data;
  if (!isMember(body.workspaceId, auth.userId)) {
    return c.json({ error: "Not a member" }, 403);
  }
  if (!canWrite(body.workspaceId, auth.userId)) {
    return c.json({ error: "Viewers cannot push changes" }, 403);
  }
  const result = pushChanges(body.workspaceId, auth.userId, body.changes as LocalChange[]);
  // Broadcast to all connected clients in this workspace so they can fetch
  // the change immediately rather than waiting for their next poll.
  // Per-entity broadcast is intentionally collapsed to a single signal: the
  // receiving client treats it as a hint to re-poll and applies the diff.
  if (result.accepted.length > 0) {
    broadcastToWorkspace(body.workspaceId, {
      type: "change",
      workspaceId: body.workspaceId,
      entityIds: result.accepted,
      timestamp: Date.now(),
    });
  }
  return c.json(result);
});

export default sync;
