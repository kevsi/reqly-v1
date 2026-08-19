import { describe, expect, it } from "vitest";
import { extractWsProtocolToken, SYNC_WS_AUTH_PROTOCOL } from "../routes/ws.js";

describe("WebSocket authentication protocol", () => {
  it("extracts the token only from the fixed protocol position", () => {
    expect(extractWsProtocolToken(`${SYNC_WS_AUTH_PROTOCOL}, signed-token`)).toBe("signed-token");
  });

  it("accepts array-shaped Node headers", () => {
    expect(extractWsProtocolToken([SYNC_WS_AUTH_PROTOCOL, "signed-token"])).toBe("signed-token");
  });

  it("does not treat an arbitrary protocol as a credential", () => {
    expect(extractWsProtocolToken("chat, signed-token")).toBeUndefined();
    expect(extractWsProtocolToken(SYNC_WS_AUTH_PROTOCOL)).toBeUndefined();
    expect(extractWsProtocolToken(undefined)).toBeUndefined();
  });
});
