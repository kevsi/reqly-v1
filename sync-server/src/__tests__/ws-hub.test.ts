import { describe, it, expect, beforeEach, vi } from "vitest";
import { WebSocket } from "ws";
import {
  addClient,
  removeClient,
  broadcastToWorkspace,
  getClientCount,
  closeAll,
  type Client,
} from "../ws-hub.js";

/**
 * Build a mock WebSocket-like object that captures sent messages and lets
 * the test toggle its readyState. We avoid using a real WebSocket because
 * the hub is purely synchronous from the caller's perspective.
 */
function makeMockSocket() {
  const sent: string[] = [];
  const ws: {
    readyState: number;
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  } = {
    readyState: WebSocket.OPEN,
    send: vi.fn((data: string) => {
      sent.push(data);
    }),
    close: vi.fn(),
  };
  return { ws: ws as unknown as WebSocket, sent, mock: ws };
}

describe("ws-hub", () => {
  beforeEach(() => {
    closeAll();
  });

  describe("client registry", () => {
    it("starts empty", () => {
      expect(getClientCount()).toBe(0);
    });

    it("tracks clients added with addClient", () => {
      const a = makeMockSocket();
      const b = makeMockSocket();
      addClient({ ws: a.ws, userId: "u-1", workspaceId: "ws-1" });
      addClient({ ws: b.ws, userId: "u-2", workspaceId: "ws-2" });
      expect(getClientCount()).toBe(2);
    });

    it("removes clients with removeClient", () => {
      const a = makeMockSocket();
      const b = makeMockSocket();
      const clientA = { ws: a.ws, userId: "u-1", workspaceId: "ws-1" };
      const clientB = { ws: b.ws, userId: "u-2", workspaceId: "ws-2" };
      addClient(clientA);
      addClient(clientB);
      removeClient(clientA);
      expect(getClientCount()).toBe(1);
      removeClient(clientB);
      expect(getClientCount()).toBe(0);
    });

    it("removeClient is a no-op for an unknown client", () => {
      const a = makeMockSocket();
      addClient({ ws: a.ws, userId: "u-1", workspaceId: "ws-1" });
      const stranger = makeMockSocket();
      removeClient({ ws: stranger.ws, userId: "u-x", workspaceId: "ws-x" });
      expect(getClientCount()).toBe(1);
    });

    it("stores clients as Set entries (same object reference compares equal)", () => {
      const a = makeMockSocket();
      const client = { ws: a.ws, userId: "u-1", workspaceId: "ws-1" };
      addClient(client);
      // Remove using the same reference
      removeClient(client);
      expect(getClientCount()).toBe(0);
    });
  });

  describe("broadcastToWorkspace", () => {
    it("sends a JSON-stringified message to every client in the workspace", () => {
      const a = makeMockSocket();
      const b = makeMockSocket();
      addClient({ ws: a.ws, userId: "u-1", workspaceId: "ws-1" });
      addClient({ ws: b.ws, userId: "u-2", workspaceId: "ws-1" });

      broadcastToWorkspace("ws-1", { type: "ping", value: 1 });

      expect(a.mock.send).toHaveBeenCalledOnce();
      expect(b.mock.send).toHaveBeenCalledOnce();
      expect(a.sent[0]).toBe('{"type":"ping","value":1}');
      expect(b.sent[0]).toBe('{"type":"ping","value":1}');
    });

    it("does not send to clients in other workspaces", () => {
      const a = makeMockSocket();
      const b = makeMockSocket();
      addClient({ ws: a.ws, userId: "u-1", workspaceId: "ws-1" });
      addClient({ ws: b.ws, userId: "u-2", workspaceId: "ws-2" });

      broadcastToWorkspace("ws-1", { type: "ping" });

      expect(a.mock.send).toHaveBeenCalledOnce();
      expect(b.mock.send).not.toHaveBeenCalled();
    });

    it("skips clients whose socket is not OPEN", () => {
      const a = makeMockSocket();
      const b = makeMockSocket();
      const c = makeMockSocket();
      // CONNECTING, OPEN, CLOSED
      a.mock.readyState = WebSocket.CONNECTING;
      b.mock.readyState = WebSocket.OPEN;
      c.mock.readyState = WebSocket.CLOSED;
      addClient({ ws: a.ws, userId: "u-1", workspaceId: "ws-1" });
      addClient({ ws: b.ws, userId: "u-2", workspaceId: "ws-1" });
      addClient({ ws: c.ws, userId: "u-3", workspaceId: "ws-1" });

      broadcastToWorkspace("ws-1", { type: "ping" });

      expect(a.mock.send).not.toHaveBeenCalled();
      expect(b.mock.send).toHaveBeenCalledOnce();
      expect(c.mock.send).not.toHaveBeenCalled();
    });

    it("handles an empty hub gracefully", () => {
      expect(() => broadcastToWorkspace("any", { type: "noop" })).not.toThrow();
    });

    it("handles a workspace with no clients gracefully", () => {
      const a = makeMockSocket();
      addClient({ ws: a.ws, userId: "u-1", workspaceId: "ws-1" });
      expect(() => broadcastToWorkspace("ws-other", { type: "ping" })).not.toThrow();
      expect(a.mock.send).not.toHaveBeenCalled();
    });

    it("serializes objects with nested structures correctly", () => {
      const a = makeMockSocket();
      addClient({ ws: a.ws, userId: "u-1", workspaceId: "ws-1" });
      const payload = { type: "delta", changes: [{ id: "c-1", version: 2 }], ts: 1700000000 };
      broadcastToWorkspace("ws-1", payload);
      expect(a.sent[0]).toBe(JSON.stringify(payload));
    });
  });

  describe("closeAll", () => {
    it("closes every WebSocket and clears the registry", () => {
      const a = makeMockSocket();
      const b = makeMockSocket();
      addClient({ ws: a.ws, userId: "u-1", workspaceId: "ws-1" });
      addClient({ ws: b.ws, userId: "u-2", workspaceId: "ws-2" });
      expect(getClientCount()).toBe(2);

      closeAll();

      expect(a.mock.close).toHaveBeenCalledOnce();
      expect(b.mock.close).toHaveBeenCalledOnce();
      expect(getClientCount()).toBe(0);
    });

    it("tolerates clients whose close() throws", () => {
      const a = makeMockSocket();
      const broken = {
        readyState: WebSocket.OPEN,
        send: vi.fn(),
        close: vi.fn(() => {
          throw new Error("already closed");
        }),
      };
      addClient({ ws: a.ws, userId: "u-1", workspaceId: "ws-1" });
      addClient({ ws: broken as unknown as WebSocket, userId: "u-2", workspaceId: "ws-1" });

      expect(() => closeAll()).not.toThrow();
      expect(getClientCount()).toBe(0);
      expect(a.mock.close).toHaveBeenCalledOnce();
      expect(broken.close).toHaveBeenCalledOnce();
    });

    it("is a no-op when the hub is already empty", () => {
      expect(() => closeAll()).not.toThrow();
      expect(getClientCount()).toBe(0);
    });
  });

  describe("isolation between workspaces", () => {
    it("two users in the same workspace both receive the same broadcast", () => {
      const alice = makeMockSocket();
      const bob = makeMockSocket();
      addClient({ ws: alice.ws, userId: "alice", workspaceId: "team-1" });
      addClient({ ws: bob.ws, userId: "bob", workspaceId: "team-1" });

      broadcastToWorkspace("team-1", { type: "shared-update" });

      expect(alice.sent).toHaveLength(1);
      expect(bob.sent).toHaveLength(1);
      expect(alice.sent[0]).toBe(bob.sent[0]);
    });

    it("removing one client does not affect broadcasts to others", () => {
      const alice = makeMockSocket();
      const bob = makeMockSocket();
      const aliceClient: Client = { ws: alice.ws, userId: "alice", workspaceId: "team-1" };
      addClient(aliceClient);
      addClient({ ws: bob.ws, userId: "bob", workspaceId: "team-1" });

      removeClient(aliceClient);
      broadcastToWorkspace("team-1", { type: "ping" });

      expect(alice.mock.send).not.toHaveBeenCalled();
      expect(bob.mock.send).toHaveBeenCalledOnce();
    });
  });
});
