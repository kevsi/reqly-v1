import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();
  let count = 0;

  const stream = new ReadableStream({
    start(controller) {
      // Envoyer un premier évènement d'accueil immédiatement
      const initData = JSON.stringify({
        message: "Connexion au serveur SSE de démonstration Reqly réussie !",
        timestamp: new Date().toISOString(),
        clientIp: req.headers.get("x-forwarded-for") || "127.0.0.1",
        status: "connected",
      });
      controller.enqueue(encoder.encode(`id: evt-0\nevent: welcome\ndata: ${initData}\n\n`));

      const interval = setInterval(() => {
        count++;
        const eventData = JSON.stringify({
          message: `Mise à jour en direct #${count}`,
          timestamp: new Date().toISOString(),
          cpuUsage: Math.floor(20 + Math.random() * 60),
          memoryUsageMb: Math.floor(120 + Math.random() * 50),
          activeRequests: Math.floor(5 + Math.random() * 25),
        });

        const eventType = count % 3 === 0 ? "ping" : "metrics";
        const sseFormatted = `id: evt-${count}\nevent: ${eventType}\ndata: ${eventData}\n\n`;

        try {
          controller.enqueue(encoder.encode(sseFormatted));
        } catch {
          clearInterval(interval);
        }

        if (count >= 300) {
          clearInterval(interval);
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        }
      }, 1500);

      req.signal.addEventListener("abort", () => {
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
    },
  });
}
