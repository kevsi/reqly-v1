/**
 * SSRF (Server-Side Request Forgery) protection primitives.
 *
 * Extracted from `app/api/proxy/route.ts` so the helpers can be unit-tested
 * without spinning up Next.js. The proxy route uses these to validate every
 * outgoing URL before issuing the fetch.
 *
 * ISOMORPHIC : ce module n'importe AUCUN builtin Node (`node:net` a été
 * remplacé par une implémentation locale de `isIP`), il peut donc être
 * importé aussi bien côté serveur (routes API) que côté client (browser).
 *
 * Threat model:
 *   - Attacker provides a URL that resolves to a private IP (e.g. 10.0.0.1)
 *     to scan the internal network or hit cloud metadata endpoints.
 *   - Attacker provides a hostname that resolves to a public IP at check
 *     time but a private IP at fetch time (DNS rebinding). Mitigated by
 *     the proxy caller pinning the resolved IP in the outbound URL.
 *
 * Algorithm:
 *   1. Reject URL literals (IP strings) that match a blocked CIDR.
 *   2. Resolve the hostname via DNS.
 *   3. Re-check the resolved address against the CIDR list.
 *   4. Rewrite the outbound URL to use the literal IP so DNS rebinding
 *      between check and fetch cannot redirect to a private IP.
 */

const PRIVATE_CIDRS_V4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT (RFC 6598)
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved / broadcast
];

const PRIVATE_CIDRS_V6: Array<[string, number]> = [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96], // NAT64
  ["100::", 64],
  ["2001::", 32],
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4 — peut encapsuler une IPv4 privée (2002:0a00:0001:: = 10.0.0.1)
  ["fc00::", 7], // ULA
  ["fe80::", 10], // link-local
];

/** IPv4 strict (mêmes règles que `net.isIP`) : 4 octets décimaux ≤ 255. */
function isIPv4(s: string): boolean {
  const parts = s.split(".");
  if (parts.length !== 4) return false;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return false;
    if (Number(p) > 255) return false;
  }
  return true;
}

/** IPv6 strict (mêmes règles que `net.isIP`) : 8 groupes hex, `::` unique,
 *  queue IPv4 éventuelle (`::ffff:10.0.0.1`). */
function isIPv6(s: string): boolean {
  let head = s;
  let tailGroups = 0;

  // Queue IPv4 : « …:10.0.0.1 » compte pour 2 groupes
  const dot = s.lastIndexOf(".");
  if (dot !== -1) {
    const lastColon = s.lastIndexOf(":");
    if (lastColon === -1) return false;
    const v4 = s.slice(lastColon + 1);
    if (!isIPv4(v4)) return false;
    tailGroups = 2;
    head = s.slice(0, lastColon);
  }

  const doubleColon = head.indexOf("::");
  if (doubleColon !== -1) {
    if (head.indexOf("::", doubleColon + 1) !== -1) return false; // « :: » unique
    const [a, b] = head.split("::");
    const ga = a === "" ? [] : a.split(":");
    const gb = b === "" ? [] : b.split(":");
    if (ga.length + gb.length + tailGroups > 7) return false;
    for (const g of [...ga, ...gb]) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return false;
    }
    return true;
  }

  const groups = head.split(":");
  if (groups.length + tailGroups !== 8) return false;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return false;
  }
  return true;
}

/** Équivalent isomorphe de `net.isIP` : 4 = IPv4, 6 = IPv6, 0 = rien. */
export function isIP(ip: string): 0 | 4 | 6 {
  if (isIPv4(ip)) return 4;
  if (isIPv6(ip)) return 6;
  return 0;
}

export function ipToBigInt(ip: string): bigint {
  const v = isIP(ip);
  if (v === 4) {
    const parts = ip.split(".").map(Number);
    const n =
      ((parts[0] << 24) >>> 0) + ((parts[1] << 16) >>> 0) + ((parts[2] << 8) >>> 0) + parts[3];
    return BigInt(n >>> 0);
  }
  const groups = ip.split(":");
  const head: number[] = [];
  const tail: number[] = [];
  let hasEmpty = false;
  for (const g of groups) {
    if (g === "") {
      hasEmpty = true;
    } else if (g.includes(".")) {
      // groupe IPv4-mappé : convertir en 2 groupes hex
      const v4 = g.split(".").map(Number);
      const n = ((v4[0] << 8) >>> 0) + v4[1];
      const m = ((v4[2] << 8) >>> 0) + v4[3];
      (hasEmpty ? tail : head).push(n, m);
    } else {
      (hasEmpty ? tail : head).push(parseInt(g, 16));
    }
  }
  const fill = 8 - head.length - tail.length;
  const full = hasEmpty ? [...head, ...new Array(fill).fill(0), ...tail] : [...head, ...tail];
  let acc = BigInt(0);
  for (const g of full) acc = (acc << BigInt(16)) + BigInt(g);
  return acc;
}

export function ipInCidr(ip: string, cidr: [string, number]): boolean {
  const v = isIP(ip);
  const v6 = isIP(cidr[0]);
  if (v !== v6) return false;
  const ipN = ipToBigInt(ip);
  const netN = ipToBigInt(cidr[0]);
  const bits = BigInt(v === 4 ? 32 - cidr[1] : 128 - cidr[1]);
  if (bits === BigInt(0)) return ipN === netN;
  return ipN >> bits === netN >> bits;
}

export function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return PRIVATE_CIDRS_V4.some((c) => ipInCidr(ip, c));
  if (v === 6) {
    if (ip.toLowerCase().startsWith("::ffff:")) {
      const v4 = ip.substring(7);
      if (isIP(v4) === 4 && isBlockedIp(v4)) return true;
    }
    return PRIVATE_CIDRS_V6.some((c) => ipInCidr(ip, c));
  }
  return true; // unknown literal — fail-closed
}

export function isPrivateHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === "localhost") return true;
  if (isIP(lower)) return isBlockedIp(lower);
  return true; // hostname literal — must be DNS-resolved by caller; fail-closed here
}
