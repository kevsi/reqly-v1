/** Scaffold written by `recli mock init` — a working starting point. */
export const EXAMPLE_MOCK_CONFIG = {
    version: 1,
    name: "reqly-mock-example",
    port: 4015,
    cors: true,
    routes: [
        {
            id: "users-list",
            method: "GET",
            path: "/api/users",
            responses: [
                {
                    id: "list-ok",
                    statusCode: 200,
                    schema: {
                        type: "object",
                        properties: {
                            data: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        id: { type: "string", format: "uuid" },
                                        email: { type: "string", format: "email" },
                                        displayName: { type: "string", format: "name" },
                                        role: { type: "string", enum: ["admin", "editor", "viewer"] },
                                        createdAt: { type: "string", format: "date-time" },
                                    },
                                    required: ["id", "email", "displayName"],
                                },
                                minItems: 2,
                                maxItems: 5,
                            },
                            total: { type: "integer", min: 20, max: 400 },
                        },
                        required: ["data", "total"],
                    },
                },
            ],
            stateful: { enabled: true, resource: "users" },
        },
        {
            id: "user-create",
            method: "POST",
            path: "/api/users",
            responses: [{ id: "created", statusCode: 201 }],
            stateful: { enabled: true, resource: "users" },
            latency: { minMs: 120, maxMs: 300 },
        },
        {
            id: "user-item",
            method: "GET",
            path: "/api/users/:id",
            responses: [{ id: "item-ok", statusCode: 200 }],
            stateful: { enabled: true, resource: "users" },
        },
        {
            id: "flaky-payment",
            method: "POST",
            path: "/api/payments",
            responses: [
                {
                    id: "card-declined",
                    name: "Carte refusée (si amount > 10000)",
                    statusCode: 402,
                    rules: [
                        { target: "body", name: "amount", op: "regex", value: "^\\d{5,}" },
                    ],
                    body: '{"error":"card_declined","message":"Montant {{request.body.amount}} refusé"}',
                },
                { id: "ok", statusCode: 200, body: '{"authorized":true,"tx":"{{uuid}}"}' },
            ],
            latency: { minMs: 50, maxMs: 250 },
            failure: { probability: 0.15, kind: "status", statusCode: 500 },
        },
    ],
};
//# sourceMappingURL=example-config.js.map