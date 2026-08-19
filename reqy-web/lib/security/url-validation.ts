/**
 * URL security validation utilities
 * Blocks SSRF attacks by rejecting private/reserved IP ranges and domains
 */

export interface BlockedIpCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Check if hostname/IP is allowed (not private/reserved)
 * Blocks:
 *   - 10.0.0.0/8 (private)
 *   - 172.16.0.0/12 (private)
 *   - 192.168.0.0/16 (private)
 *   - 127.0.0.0/8 (loopback)
 *   - 169.254.0.0/16 (link-local, AWS metadata service)
 *   - 0.0.0.0/8 (broadcast)
 *   - 255.255.255.255/32 (broadcast)
 *   - ::1 (IPv6 loopback)
 *   - fe80::/10 (IPv6 link-local)
 */
export function isBlockedIp(hostname: string): BlockedIpCheckResult {
  try {
    // Parse hostname/IP
    const url = new URL("http://" + hostname);
    const ip = url.hostname;

    // IPv6 loopback
    if (ip === "::1" || ip === "::") {
      return { allowed: false, reason: "IPv6 loopback" };
    }

    // IPv6 link-local (fe80::)
    if (ip.startsWith("fe80:")) {
      return { allowed: false, reason: "IPv6 link-local" };
    }

    // IPv4 checks
    const parts = ip.split(".").map(Number);
    if (parts.length === 4 && parts.every((p) => p >= 0 && p <= 255)) {
      const [a, b] = parts;

      // 127.0.0.0/8 - Loopback
      if (a === 127) {
        return { allowed: false, reason: "Loopback (127.0.0.0/8)" };
      }

      // 10.0.0.0/8 - Private
      if (a === 10) {
        return { allowed: false, reason: "Private (10.0.0.0/8)" };
      }

      // 172.16.0.0/12 - Private
      if (a === 172 && b >= 16 && b <= 31) {
        return { allowed: false, reason: "Private (172.16.0.0/12)" };
      }

      // 192.168.0.0/16 - Private
      if (a === 192 && b === 168) {
        return { allowed: false, reason: "Private (192.168.0.0/16)" };
      }

      // 169.254.0.0/16 - Link-local (AWS metadata service!)
      if (a === 169 && b === 254) {
        return { allowed: false, reason: "Link-local/AWS metadata (169.254.0.0/16)" };
      }

      // 0.0.0.0/8 - Broadcast
      if (a === 0) {
        return { allowed: false, reason: "Broadcast (0.0.0.0/8)" };
      }

      // 255.255.255.255/32 - Broadcast
      if (a === 255) {
        return { allowed: false, reason: "Broadcast (255.255.255.255)" };
      }

      // 224.0.0.0/4 - Multicast
      if (a >= 224 && a <= 239) {
        return { allowed: false, reason: "Multicast (224.0.0.0/4)" };
      }

      // 240.0.0.0/4 - Reserved
      if (a >= 240 && a <= 255) {
        return { allowed: false, reason: "Reserved (240.0.0.0/4)" };
      }
    }

    return { allowed: true };
  } catch (_e) {
    return { allowed: false, reason: "Invalid hostname format" };
  }
}

/**
 * Check if domain is blocked (localhost, local, Tauri IPC, etc)
 */
export function isBlockedDomain(hostname: string): BlockedIpCheckResult {
  const normalizedHost = hostname.toLowerCase();

  const blockedDomains = ["localhost", "local", "ipc.localhost", "tauri.localhost", "app.local"];

  for (const blocked of blockedDomains) {
    // Exact match or subdomain match
    if (normalizedHost === blocked || normalizedHost.endsWith("." + blocked)) {
      return { allowed: false, reason: `Blocked domain: ${blocked}` };
    }
  }

  return { allowed: true };
}

/**
 * Validate that a base URL is safe for external API calls
 * Returns first error found (IP check takes precedence)
 */
export function validateProxyUrl(baseUrl: string): BlockedIpCheckResult {
  try {
    const url = new URL(baseUrl);

    // Check IP restrictions
    const ipCheck = isBlockedIp(url.hostname);
    if (!ipCheck.allowed) {
      return ipCheck;
    }

    // Check domain restrictions
    const domainCheck = isBlockedDomain(url.hostname);
    if (!domainCheck.allowed) {
      return domainCheck;
    }

    return { allowed: true };
  } catch (_e) {
    return { allowed: false, reason: "Invalid URL format" };
  }
}
