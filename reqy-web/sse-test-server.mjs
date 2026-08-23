import http from "node:http";

const PORT = 3001;

http.createServer((req, res) => {
  // Entêtes CORS universels
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  // Traiter la requête Preflight OPTIONS du navigateur
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  console.log(`🔌 Connexion SSE reçue (${req.method} ${req.url})`);
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  let i = 0;
  const timer = setInterval(() => {
    i++;
    console.log(`→ Événement #${i} envoyé`);
    const data = JSON.stringify({ count: i, timestamp: new Date().toISOString(), message: `Test Event #${i}` });
    res.write(`id: ${i}\nevent: ping\ndata: ${data}\n\n`);
  }, 1000);

  req.on("close", () => {
    console.log("🔌 Connexion fermée par le client");
    clearInterval(timer);
  });
}).listen(PORT, () => {
  console.log(`🚀 Serveur SSE de test démarré sur http://localhost:${PORT}`);
  console.log(`💡 Pour tester dans Reqly, entrez l'URL : http://localhost:${PORT}`);
});