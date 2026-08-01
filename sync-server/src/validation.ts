import type { Context } from "hono";
import type { ZodSchema, ZodError } from "zod";

/**
 * Safely parse a JSON request body against a Zod schema.
 *
 * Returns `{ success: true, data: T }` on success, or
 * `{ success: false, response: Response }` on failure — the Response is a
 * 400 JSON body that can be returned directly from the route handler.
 *
 * This prevents ZodError stack traces (which leak schema internals) from
 * propagating to the client or the default error handler.
 */
export async function safeParseJson<T>(
  c: Context,
  schema: ZodSchema<T>,
): Promise<{ success: true; data: T } | { success: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return {
      success: false,
      response: c.json({ error: "Invalid JSON in request body" }, 400),
    };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const message = firstIssue
      ? `${firstIssue.path.join(".")}: ${firstIssue.message}`
      : "Invalid request body";
    return {
      success: false,
      response: c.json({ error: message }, 400),
    };
  }

  return { success: true, data: result.data };
}
