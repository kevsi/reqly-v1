/**
 * Guard SSRF pour les requêtes sortantes des routes serveur.
 *
 * Toute URL externe est validée AVANT la requête : protocole http/https
 * uniquement, hôte présent, refus des hôtes localhost/loopback/.internal,
 * et refus des adresses IP privées ou réservées après résolution DNS
 * (127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 0/8, 100.64/10,
 * ::1, fc00::/7, fe80::/10, 2001:db8::/32).
 *
 * Contrainte produit : ce module est réservé au runtime Node des routes
 * API (l'app web n'a d'autres dépendances serveur sortantes).
 */
import { lookup } from "node:dns/promises";

class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("2001:db8:")) return true;
  // Mappé IPv4 (::ffff:10.0.0.1)
  const v4 = lower.split(":").pop();
  if (v4 && v4.includes(".")) return isPrivateIpv4(v4);
  return false;
}

function assertPublicAddress(address: string): void {
  if (address.includes(":") ? isPrivateIpv6(address) : isPrivateIpv4(address)) {
    throw new UnsafeUrlError(`Adresse IP non autorisée : ${address}`);
  }
}

/** Valide l'URL : protocole + hôte. Ne résout pas le DNS. */
export function assertSafeExternalUrl(input: string | URL): URL {
  let url: URL;
  try {
    url = input instanceof URL ? input : new URL(input);
  } catch {
    throw new UnsafeUrlError("URL invalide");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UnsafeUrlError(`Protocole interdit : ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw new UnsafeUrlError("Hôte absent");
  if (
    BLOCKED_HOSTNAMES.has(host) ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  ) {
    throw new UnsafeUrlError(`Hôte non autorisé : ${host}`);
  }
  return url;
}

/**
 * fetch durci : valide l'URL, résout le DNS et refuse les IP
 * privées/réservées avant d'émettre la requête.
 */
export async function safeFetch(
  input: string | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = assertSafeExternalUrl(input);
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new UnsafeUrlError(`Hôte introuvable : ${url.hostname}`);
  }
  for (const { address } of addresses) {
    assertPublicAddress(address);
  }
  return fetch(url.toString(), init);
}

/** URL GitHub : même garde, adaptée aux hôtes GitHub fixes. */
export const GITHUB_SAFE_HOSTS = new Set(["api.github.com", "github.com", "objects.githubusercontent.com", "raw.githubusercontent.com"]);

/** Valide une URL GitHub (hôte restreint) sans résolution DNS. */
export function assertGithubUrl(input: string | URL): URL {
  const url = assertSafeExternalUrl(input);
  if (!GITHUB_SAFE_HOSTS.has(url.hostname.toLowerCase())) {
    throw new UnsafeUrlError(`Hôte GitHub inattendu : ${url.hostname}`);
  }
  return url;
}

export { UnsafeUrlError };
