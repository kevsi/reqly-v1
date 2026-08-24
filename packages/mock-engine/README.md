# @reqly/mock-engine

Moteur de mock server local-first de Reqly — zéro dépendance runtime (Node ≥ 18), réutilisable par le CLI (`recli mock`), le desktop et les tests.

## Usage programmatique

```ts
import { createMockServer, type MockConfig } from "@reqly/mock-engine";

const config: MockConfig = {
  version: 1,
  port: 4015,
  cors: true,
  routes: [
    {
      id: "users",
      method: "GET",
      path: "/api/users/:id",
      responses: [
        {
          id: "ok",
          statusCode: 200,
          schema: {
            type: "object",
            properties: {
              id: { type: "string", format: "uuid" },
              email: { type: "string", format: "email" },
            },
            required: ["id", "email"],
          },
        },
      ],
      stateful: { enabled: true },
      latency: { minMs: 50, maxMs: 200 },
    },
  ],
};

const handle = createMockServer(config, { onRequest: (r) => console.log(r) });
await new Promise((r) => handle.server.listen(config.port, r));
// handle.replaceConfig(cfg) · handle.reset() · handle.recordings() · await handle.close()
```

## CLI

```bash
recli mock init                # scaffold mock.config.json
recli mock start               # démarre sur :4015
recli mock start cfg.yml --watch --port 5000   # hot-reload YAML/JSON
```

## Fonctions couvertes (spec MVP + v1.5)

- Matching méthode + path (`:param`, `*splat`) · conditions query/header/body (`equals|exists|missing|contains|regex`, dot-paths)
- Réponses multiples par route avec règles de sélection + `defaultResponseId`
- Données réalistes auto par schéma **et par nom de champ** (email/date/uuid/prix…), objets imbriqués, tableaux bornés, enums
- Corps statiques avec templating : `{{request.path.id}}`, `{{request.query.x}}`, `{{request.body.a.b}}`, `{{uuid}}`, `{{nowIso}}`, `{{int 1 10}}`, `{{faker.city}}`…
- Latence fixe/aléatoire ; pannes probabilistes : status, timeout (socket détruit), connexion reset, réponse malformée
- Stateful-lite CRUD en mémoire (+ `POST /mock/reset`)
- Transforms JS sandboxés (node:vm, 250 ms, pas d'IO)
- Hot-reload de config sans restart (`replaceConfig`)
- Recording des requêtes + logs temps réel via callback

## Hors scope v1 (roadmap)

Génération auto depuis le scanner de code / OpenAPI / Postman (tranche suivante), mode proxy, enregistrement de trafic réel, mocks GraphQL/WebSocket, sync équipe.
