# analyser-api

Analyse un backend et extrait ses routes API (méthode, path, auth, body, params) dans plusieurs formats. Multi-langage, basé sur ast-grep, extensible par détecteurs.

## Langages & frameworks

| Langage               | Frameworks                       |
| --------------------- | -------------------------------- |
| JavaScript/TypeScript | express, fastify, nestjs, nextjs |
| Rust                  | axum, actix-web                  |
| Python                | fastapi, flask, django           |
| Go                    | gin, echo                        |

## Usage

Prérequis : Node.js >= 22.18, pnpm.

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
```

### CLI

```sh
node packages/cli/src/index.ts scan <chemin> [--format json|md|openapi|reqly] [--lang javascript|rust|python|go] [--out <fichier>] [--diff <scan-precedent.json>]
```

Exemples :

```sh
# Rapport markdown (routes + section sécurité)
node packages/cli/src/index.ts scan ./src --format md

# Spec OpenAPI v3 importable dans Swagger/Postman
node packages/cli/src/index.ts scan ./src --format openapi --out spec.json

# Diff entre deux scans (added / removed / changed)
node packages/cli/src/index.ts scan ./src --format json --out v1.json
node packages/cli/src/index.ts scan ./src --format json --diff v1.json
```

### Bibliothèque

```ts
import { analyze, toOpenApi } from "@analyser/core";
import { detectorJs } from "@analyser/detector-js";

const result = await analyze({ rootPath: "./src", detectors: [detectorJs] });
const spec = toOpenApi(result);
```

## Configuration

- `.gitignore` du repo est respecté lors du scan (plus `node_modules`, `target`, `dist`… par défaut).
- `.analyserrc` (JSON) à la racine, `{ "ignore": ["dossier"] }` pour exclure des dossiers en plus.

## Formats de sortie

| Format    | Description                                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------- |
| `json`    | Données brutes : method, path, framework, auth (required/middleware/confidence), body, params, query, fichier, ligne |
| `md`      | Rapport lisible avec section Security listant les endpoints exposés                                                  |
| `openapi` | Spec OpenAPI 3.0.3 (paths, paramètres, security, requestBody)                                                        |
| `reqly`   | Objets de collection Reqly                                                                                           |

## Résolution des préfixes

- Express : `app.use("/api", router)` monté dans le même fichier que les routes.
- FastAPI : `include_router(...)` cross-fichiers (imports, constantes `settings.X`, `APIRouter(prefix=...)`) résolu par un graphe de montage.
- Gin/Echo : préfixes de groupes résolus en chaîne (`r.Group("/api")`, imbriqués inclus) ; auth requise uniquement si un middleware est réellement passé (`Group(path, mw)`, `.Use(...)`, ou handler intermédiaire entre le path et le handler final).

## Limites connues

- Authentification détectée par heuristique de noms de symboles (`auth`, `jwt`, `guard`…) : faux positifs/négatifs possibles.
- Préfixes de routers JS déclarés dans un autre fichier non résolus.
- Manifestes détectés à la racine + 1 niveau.
- Frameworks non supportés (hono, koa, fiber, chi…) : si leur usage est détecté mais qu'aucune route (ou seulement des routes `unknown`) n'est extraite, un warning le signale dans le rapport.

## Architecture

```
packages/
  core/       analyse (orchestrator), règles ast-grep, formatters (json/md/openapi/reqly)
  cli/        interface commander
  detector-js detector-python detector-rust detector-go
```

Un nouveau framework = un `Detector` (règles ast-grep + `assemble`) + un fixture `expected.json`, découvert automatiquement.
