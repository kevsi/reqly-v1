import { describe, it, expect } from "vitest"
import { isBlockedIp, isPrivateHost, ipToBigInt, ipInCidr } from "../ssrf"

/**
 * SSRF protection primitives — unit tests.
 *
 * These cover the helper layer that `app/api/proxy/route.ts` uses to decide
 * whether an outbound URL is safe to fetch. The full route is harder to
 * test in isolation (Next.js request/response mocking), so we lock in the
 * decision logic here. A regression in any of these helpers means the
 * proxy is one URL literal away from bypassing the SSRF guard.
 */
describe("ipToBigInt", () => {
  it("converts an IPv4 address to its numeric form", () => {
    // 192.168.1.1 = 3232235777
    expect(ipToBigInt("192.168.1.1")).toBe(BigInt(3232235777))
  })

  it("converts an IPv6 address without :: compression", () => {
    // 2001:db8::1
    expect(ipToBigInt("2001:db8::1") > BigInt(0)).toBe(true)
  })

  it("handles IPv4-mapped IPv6 (::ffff:x.x.x.x)", () => {
    expect(ipToBigInt("::ffff:10.0.0.1") > BigInt(0)).toBe(true)
  })
})

describe("ipInCidr", () => {
  it("matches an IPv4 inside a /8 block", () => {
    expect(ipInCidr("10.5.6.7", ["10.0.0.0", 8])).toBe(true)
  })

  it("rejects an IPv4 outside a /8 block", () => {
    expect(ipInCidr("11.0.0.1", ["10.0.0.0", 8])).toBe(false)
  })

  it("matches RFC1918 boundaries", () => {
    expect(ipInCidr("172.16.0.1", ["172.16.0.0", 12])).toBe(true)
    expect(ipInCidr("172.31.255.254", ["172.16.0.0", 12])).toBe(true)
    expect(ipInCidr("172.32.0.1", ["172.16.0.0", 12])).toBe(false)
  })

  it("matches IPv6 ULA (fc00::/7)", () => {
    expect(ipInCidr("fc00::1", ["fc00::", 7])).toBe(true)
    expect(ipInCidr("fd00::1", ["fc00::", 7])).toBe(true)
    expect(ipInCidr("fb00::1", ["fc00::", 7])).toBe(false)
  })

  it("returns false when IP family does not match CIDR family", () => {
    expect(ipInCidr("10.0.0.1", ["fc00::", 7])).toBe(false)
    expect(ipInCidr("fc00::1", ["10.0.0.0", 8])).toBe(false)
  })

  it("handles exact-match CIDRs (prefix /32 for IPv4 or /128 for IPv6)", () => {
    expect(ipInCidr("8.8.8.8", ["8.8.8.8", 32])).toBe(true)
    expect(ipInCidr("8.8.8.9", ["8.8.8.8", 32])).toBe(false)
  })
})

describe("isBlockedIp", () => {
  it("blocks IPv4 loopback", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true)
    expect(isBlockedIp("127.255.255.254")).toBe(true)
  })

  it("blocks IPv4 RFC1918 (10/8, 172.16/12, 192.168/16)", () => {
    expect(isBlockedIp("10.0.0.1")).toBe(true)
    expect(isBlockedIp("172.20.5.6")).toBe(true)
    expect(isBlockedIp("192.168.1.1")).toBe(true)
  })

  it("blocks IPv4 CGNAT (100.64.0.0/10)", () => {
    expect(isBlockedIp("100.64.0.1")).toBe(true)
    expect(isBlockedIp("100.127.255.254")).toBe(true)
    expect(isBlockedIp("100.128.0.0")).toBe(false)
  })

  it("blocks IPv4 link-local (169.254.0.0/16)", () => {
    expect(isBlockedIp("169.254.169.254")).toBe(true) // AWS metadata!
  })

  it("blocks IPv4 TEST-NET ranges", () => {
    expect(isBlockedIp("192.0.2.1")).toBe(true)
    expect(isBlockedIp("198.51.100.1")).toBe(true)
    expect(isBlockedIp("203.0.113.1")).toBe(true)
  })

  it("blocks IPv4 multicast and broadcast", () => {
    expect(isBlockedIp("224.0.0.1")).toBe(true)
    expect(isBlockedIp("255.255.255.255")).toBe(true)
  })

  it("allows legitimate public IPv4", () => {
    expect(isBlockedIp("8.8.8.8")).toBe(false)
    expect(isBlockedIp("1.1.1.1")).toBe(false)
    expect(isBlockedIp("93.184.216.34")).toBe(false)
  })

  it("blocks IPv6 loopback", () => {
    expect(isBlockedIp("::1")).toBe(true)
  })

  it("blocks IPv6 ULA (fc00::/7)", () => {
    expect(isBlockedIp("fc00::1")).toBe(true)
    expect(isBlockedIp("fd12:3456:789a::1")).toBe(true)
  })

  it("blocks IPv6 link-local (fe80::/10)", () => {
    expect(isBlockedIp("fe80::1")).toBe(true)
  })

  it("blocks IPv4-mapped IPv6 of a private IPv4", () => {
    // ::ffff:10.0.0.1 — attacker trying to bypass the v4 check via v6
    expect(isBlockedIp("::ffff:10.0.0.1")).toBe(true)
    expect(isBlockedIp("::ffff:127.0.0.1")).toBe(true)
  })

  it("allows legitimate public IPv6", () => {
    expect(isBlockedIp("2001:4860:4860::8888")).toBe(false) // Google DNS
  })

  it("fails closed on unknown literal", () => {
    expect(isBlockedIp("not-an-ip")).toBe(true)
    expect(isBlockedIp("")).toBe(true)
  })
})

describe("isPrivateHost", () => {
  it("treats 'localhost' as private", () => {
    expect(isPrivateHost("localhost")).toBe(true)
    expect(isPrivateHost("LOCALHOST")).toBe(true)
  })

  it("delegates to isBlockedIp for IP literals", () => {
    expect(isPrivateHost("10.0.0.1")).toBe(true)
    expect(isPrivateHost("8.8.8.8")).toBe(false)
    expect(isPrivateHost("::1")).toBe(true)
  })

  it("fails closed on bare hostnames (must be DNS-resolved first)", () => {
    // Without DNS resolution we cannot know if 'example.com' is safe.
    // The function returns true so the caller is forced to resolve.
    expect(isPrivateHost("example.com")).toBe(true)
    expect(isPrivateHost("internal.corp")).toBe(true)
  })
})
