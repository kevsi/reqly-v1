/**
 * WS sync tickets — short-lived, single-purpose authentication for the
 * WebSocket upgrade.
 *
 * Pourquoi : le navigateur ne peut pas poser d'en-tête `Authorization` sur
 * un WebSocket ; le token de session était donc passé dans le subprotocol
 * `Sec-WebSocket-Protocol`, visible dans les logs des proxys/load-balancers.
 * Un ticket est signé (HMAC), expire en 30 s et est lié au workspace :
 * une fuite dans un log est inutilisable après expiration.
 *
 * Note : la vérification de révocation de session (token_version) est faite
 * à l'upgrade (`isSessionRevoked`), pas ici — le ticket ne prouve que
 * « signé par le serveur, non expiré ».
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const TICKET_TTL_MS = 30_000;

export interface WsTicketPayload {
  uid: string;
  ver?: number;
  exp: number;
  wid: string;
}

function ticketSecret(): string {
  const s = process.env.AUTH_SIGNING_SECRET || "";
  if (!s) throw new Error("AUTH_SIGNING_SECRET env variable not set");
  return s;
}

export function createWsTicket(
  userId: string,
  ver: number | undefined,
  workspaceId: string,
): string {
  const payload: WsTicketPayload = {
    uid: userId,
    ver,
    exp: Date.now() + TICKET_TTL_MS,
    wid: workspaceId,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", ticketSecret()).update(encoded).digest("base64url");
  return `t.${encoded}.${signature}`;
}

/** Valide un ticket (signature + expiration). `null` si invalide. */
export function verifyWsTicket(ticket: string): WsTicketPayload | null {
  if (!ticket.startsWith("t.")) return null;
  const [, payloadBase64, signature] = ticket.split(".");
  if (!payloadBase64 || !signature) return null;

  const expected = createHmac("sha256", ticketSecret()).update(payloadBase64).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(payloadBase64, "base64url").toString("utf-8"),
    ) as WsTicketPayload;
    if (typeof payload.uid !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp < Date.now()) return null; // expiré
    return payload;
  } catch {
    return null;
  }
}
