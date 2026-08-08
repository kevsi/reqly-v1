import net from "node:net";
import dns from "node:dns";

// IPv4 private/reserved ranges as [start, end] 32-bit integers. Covers RFC1918,
// loopback, link-local, CGNAT, documentation, benchmarking and multicast so the
// metadata endpoint (169.254.169.254) is included without a special case.
const PRIVATE_IPV4: Array<[number, number]> = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8 — "this network"
  [0x0a000000, 0x0affffff], // 10.0.0.0/8
  [0x64400000, 0x647fffff], // 100.64.0.0/10 — CGNAT
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8 — loopback
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 — link-local (cloud metadata)
  [0xac100000, 0xac1fffff], // 172.16.0.0/12
  [0xc0000000, 0xc00000ff], // 192.0.0.0/24
  [0xc0000200, 0xc00002ff], // 192.0.2.0/24 — documentation
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
  [0xc6120000, 0xc613ffff], // 198.18.0.0/15 — benchmarking
  [0xe0000000, 0xffffffff], // 224.0.0.0/4 — multicast + reserved
];

// Parse any IPv4 literal form (dotted, short-dotted, decimal, hex, octal) into
// its 32-bit value, following inet_aton semantics (the last component may hold
// multiple octets: 127.1 === 127.0.0.1, 2130706433 === 127.0.0.1). Returns null
// when the input is not an IPv4 literal.
function parseIpv4Int(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (!/^[0-9a-fx.]+$/.test(s)) return null;
  const parts = s.includes(".") ? s.split(".") : [s];
  if (parts.length > 4 || parts.some((p) => p === "")) return null;
  let value = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    let n: number;
    if (/^0x[0-9a-f]+$/.test(p)) n = parseInt(p, 16);
    else if (p.length > 1 && p.startsWith("0")) n = parseInt(p, 8);
    else if (/^\d+$/.test(p)) n = parseInt(p, 10);
    else return null;
    if (Number.isNaN(n)) return null;
    if (i === parts.length - 1) {
      const bytes = 4 - i;
      if (n >= 2 ** (bytes * 8)) return null;
      value = value * 2 ** (bytes * 8) + n;
    } else {
      if (n > 255) return null;
      value = value * 256 + n;
    }
  }
  return value >>> 0;
}

// Expand an IPv6 literal (compressed "::", IPv4-mapped "::ffff:a.b.c.d", …)
// into its 16 bytes, or null when not a valid IPv6 address.
function ipv6ToBytes(addr: string): number[] | null {
  let s = addr.toLowerCase();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  const idx = s.indexOf("::");
  const split = idx !== -1;
  const head = split ? s.slice(0, idx) : s;
  const tail = split ? s.slice(idx + 2) : "";

  const parseGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const groups: number[] = [];
    for (const g of part.split(":")) {
      if (g === "") return null;
      if (g.includes(".")) {
        const int = parseIpv4Int(g);
        if (int === null) return null;
        groups.push(int >>> 24, (int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff);
      } else if (/^[0-9a-f]{1,4}$/.test(g)) {
        const n = parseInt(g, 16);
        groups.push((n >> 8) & 0xff, n & 0xff);
      } else {
        return null;
      }
    }
    return groups;
  };

  const headBytes = parseGroups(head);
  const tailBytes = parseGroups(tail);
  if (headBytes === null || tailBytes === null) return null;
  const total = headBytes.length + tailBytes.length;
  if (total > 16) return null;
  if (!split && total !== 16) return null;

  const bytes: number[] = [];
  bytes.push(...headBytes);
  if (split) for (let i = 0; i < 16 - total; i++) bytes.push(0);
  bytes.push(...tailBytes);
  return bytes;
}

function matchesPrefix(bytes: number[], prefix: number[], bits: number): boolean {
  const whole = bits >> 3;
  for (let i = 0; i < whole; i++) if (bytes[i] !== prefix[i]) return false;
  const rem = bits & 7;
  if (rem > 0) {
    const mask = (0xff << (8 - rem)) & 0xff;
    if ((bytes[whole] & mask) !== (prefix[whole] & mask)) return false;
  }
  return true;
}

function isPrivateIpv4(hostname: string): boolean {
  const int = parseIpv4Int(hostname);
  if (int === null) return false;
  return PRIVATE_IPV4.some(([lo, hi]) => int >= lo && int <= hi);
}

function isPrivateIpv6(hostname: string): boolean {
  const bytes = ipv6ToBytes(hostname);
  if (bytes === null) return false;
  // IPv4-mapped (::ffff:a.b.c.d) / IPv4-compatible (::a.b.c.d): check the
  // embedded IPv4.
  const leadingZeros =
    bytes[0] === 0 &&
    bytes[1] === 0 &&
    bytes[2] === 0 &&
    bytes[3] === 0 &&
    bytes[4] === 0 &&
    bytes[5] === 0 &&
    bytes[6] === 0 &&
    bytes[7] === 0 &&
    bytes[8] === 0 &&
    bytes[9] === 0;
  if (
    leadingZeros &&
    (bytes[10] === 0xff || bytes[11] === 0xff || (bytes[10] === 0 && bytes[11] === 0))
  ) {
    const quad = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
    return isPrivateIpv4(quad);
  }
  if (bytes.every((b) => b === 0)) return true; // :: (unspecified)
  if (matchesPrefix(bytes, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], 128)) return true; // ::1
  if (matchesPrefix(bytes, [0xfc, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 7)) return true; // fc00::/7 ULA
  if (matchesPrefix(bytes, [0xfe, 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 10)) return true; // fe80::/10 link-local
  if (matchesPrefix(bytes, [0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 8)) return true; // ff00::/8 multicast
  return false;
}

export function isPrivateIp(hostname: string): boolean {
  // Strip IPv6 brackets and trailing dots ("127.0.0.1." == 127.0.0.1).
  const h = hostname.replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "").toLowerCase();
  if (net.isIP(h) === 6 || h.includes(":")) return isPrivateIpv6(h);
  return isPrivateIpv4(h);
}

export async function isUrlAllowed(
  url: string,
  allowLocalHosts?: boolean,
): Promise<{ allowed: boolean; reason?: string }> {
  if (allowLocalHosts) {
    return { allowed: true };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, reason: "Invalid URL" };
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    return { allowed: false, reason: `Unsupported protocol: ${parsed.protocol}` };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (isPrivateIp(hostname)) {
    return { allowed: false, reason: `Private/local address blocked: ${hostname}` };
  }

  // DNS rebinding: the hostname may resolve to a private address even though
  // the literal name looks public. Resolve now and check every returned
  // address. // ponytail: check-then-connect — a hostile DNS could swap
  // between check and connect; pin the resolved IP in a custom agent if the
  // threat model demands it.
  if (net.isIP(hostname) === 0) {
    try {
      // Wrap in a timeout: dns.promises.lookup has no AbortSignal and a
      // slow/unresponsive resolver must not hang the SSRF check forever.
      const addrs = await Promise.race([
        dns.promises.lookup(hostname, { all: true }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("DNS lookup timed out")), 5000),
        ),
      ]);
      for (const a of addrs) {
        if (isPrivateIp(a.address)) {
          return {
            allowed: false,
            reason: `Host ${hostname} resolves to private address ${a.address}`,
          };
        }
      }
    } catch {
      // Unresolvable host — the request itself will fail naturally.
    }
  }

  return { allowed: true };
}
