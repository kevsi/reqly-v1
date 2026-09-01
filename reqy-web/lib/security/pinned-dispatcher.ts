import { Agent } from "undici";
import { isIP } from "node:net";
import { isBlockedIp } from "./ssrf";
import { resolveCached } from "./dns-cache";

/** Resolve a public URL and pin future sockets to the validated address. */
export async function createPinnedDispatcher(
  rawUrl: string,
  options?: { allowLocal?: boolean },
): Promise<Agent | undefined> {
  const parsed = new URL(rawUrl);
  if (process.env.NODE_ENV === "development" || process.env.ALLOW_LOCAL_HOSTS === "true") {
    return undefined;
  }
  const allowLocal = options?.allowLocal === true;
  const localLiteral =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
  if (allowLocal && localLiteral) {
    return undefined;
  }
  const address = isIP(parsed.hostname) ? parsed.hostname : await resolveCached(parsed.hostname);
  if (!address || isBlockedIp(address)) {
    throw new Error("Requests to private/internal hosts are not allowed");
  }
  return new Agent({
    connect: {
      lookup(_hostname, _options, callback) {
        callback(null, address, isIP(address));
      },
    },
  });
}
