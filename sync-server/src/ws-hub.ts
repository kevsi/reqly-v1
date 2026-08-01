import { WebSocketServer, WebSocket } from "ws"

interface Client {
  ws: WebSocket
  userId: string
  workspaceId: string
}

const clients = new Set<Client>()

export function addClient(client: Client) {
  clients.add(client)
}

export function removeClient(client: Client) {
  clients.delete(client)
}

export function broadcastToWorkspace(workspaceId: string, message: object) {
  const json = JSON.stringify(message)
  for (const client of clients) {
    if (client.workspaceId === workspaceId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(json)
    }
  }
}

export function getClientCount(): number {
  return clients.size
}

export function closeAll() {
  for (const client of clients) {
    try {
      client.ws.close()
    } catch {
      // ignore: client may already be closed
    }
  }
  clients.clear()
}

export type { Client }
