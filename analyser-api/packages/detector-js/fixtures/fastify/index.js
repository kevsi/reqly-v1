const fastify = require("fastify")();
const app = fastify;

app.route({
  method: "GET",
  url: "/health",
  handler: () => ({ ok: true }),
});

app.route({
  method: "POST",
  url: "/users",
  preHandler: [requireAuthHook],
  handler: async (request, reply) => request.body,
});

app.get("/ping", (request, reply) => ({ pong: true }));
