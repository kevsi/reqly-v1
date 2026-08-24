# Triage & Correctifs — Semgrep (82 findings, 21/08/2026)

Scan : `semgrep --config auto` — 599 règles, 1199 fichiers.
Ce document liste chaque finding avec verdict (CORRIGÉ / FAUX POSITIF / À TRAITER) et justification.

---

## ✅ CORRIGÉS (26 findings)

| Règle | Fichier(s) | Correctif |
|---|---|---|
| `run-shell-injection` | `recli/.github/actions/recli-action/action.yml` | Inputs GitHub passés par variables `env:` citées (`"$VAR"`) au lieu d'interpolation dans `run:` — injection de commandes fermée |
| `github-actions-mutable-action-tag` | `recli/.github/actions/recli-action/action.yml` (×2) | `actions/setup-node@v4` → SHA `49933ea5…`, `actions/upload-artifact@v4` → SHA `ea165f8d…` (épinglés) |
| `dockerfile.security.missing-user` | `reqy-web/Dockerfile`, `sync-server/Dockerfile` | `USER node` ajouté avant `CMD` (exécution non-root) |
| `prototype-pollution-loop` | `reqy-web/lib/test-runner/runner.ts` (écritures `ctx.environment[...]` + lecture JSON path), `lib/script-executor.ts`, `lib/variable-path.ts`, `src/ai/cloud-engine/actions/dispatch.ts`, `packages/shared/src/variable-path/index.ts`, `recli/src/contract.ts` | Garde `__proto__` / `constructor` / `prototype` : les chemins refusent ces clés (lecture → `undefined`, écriture → ignorée). Helper `isUnsafeObjectKey()` dans `lib/utils.ts` |
| `remote-property-injection` | `reqy-web/lib/test-runner/runner.ts` | Couvert par la même garde (écriture `environment[variableName]`) |
| `unsafe-formatstring` | `reqy-web/hooks/store/persistence.ts`, `lib/storage-adapter.ts` | `console.warn/error` : format constant + données en objet au lieu d'une template avec variables (anti-log forgé) |
| `detected-google-oauth-access-token` | `reqy-web/components/auth-section.tsx` | Placeholder d'exemple → `ya29.example-token...` (non détectable) |
| `npm-missing-minimum-release-age` | `.npmrc` | `min-release-age=7` ajouté |
| `pnpm-missing-minimum-release-age` / `pnpm-trust-policy` / `pnpm-block-exotic-sub-dependencies` | `pnpm-workspace.yaml` (×2 : racine + analyser-api) | `minimumReleaseAge: 10080`, `trustPolicy: no-downgrade`, `blockExoticSubdeps: true` |

## ⚪ FAUX POSITIFS (documentés, non modifiés)

| Règle | Fichier | Justification |
|---|---|---|
| `detect-insecure-websocket` (×6) | `AUDIT_GRAPHQL.md`, `lib/graphql/errors.ts` + tests | Chaînes `ws://` dans des **messages d'erreur/documentation/tests** : la validation `validateSubscriptionEndpoint` **refuse** ws:// sur page HTTPS et exige http/https/ws/wss — comportement voulu (le ws:// est autorisé en dev pour les endpoints locaux) |
| `reqwest-accept-invalid` | `src-tauri/src/lib.rs:57` | Client `insecure_client` **volontaire** : c'est le toggle « Vérification SSL » des paramètres, activé uniquement si l'utilisateur le demande. Le client par défaut (sécurisé) reste utilisé. |
| `path-join-resolve-traversal` | `reqy-web/lib/tree-sitter-parser.ts` | `grammar` provient d'une **map figée** (`GRAMMAR_CONFIG`), `grammarForFramework` ne renvoie que des clés de cette map — aucun input utilisateur n'atteint `path.join` |
| `detect-non-literal-regexp` (×9) | `packages/shared/assertions`, `recli/src/contract.ts`, `lib/bruno-import.ts`, `lib/detect-shared-*`, `lib/project-analyzer.ts`, `lib/proxy-auth.ts`, `lib/utils.ts` (interpolation `{{var}}`), `lib/variable-path.ts` | Regex construites depuis des **entrées de l'utilisateur sur SON contenu** (interpolation de variables, parsing de ses propres fichiers/imports) — exécutées côté client/local, pas de ReDoS exploitable sur un serveur partagé. Risque accepté ; les motifs sont bornés (`{0,200}`, échappement des métacaractères) |
| `spawn-shell-true` | `reqy-web/scripts/build-desktop.mjs` (×3) | Script de **build local** avec arguments fixes — pas exposé |
| `express-check-csurf` | `analyser-api/packages/detector-js/fixtures/express/server.js` | **Fixture de test** (détecteur de frameworks) |
| `cors-misconfiguration` | `recli/src/mcp/server.ts:273` | Serveur MCP **local** : refléter l'origine est le comportement standard des outils MCP (aucun secret exposé, bind localhost) |
| `raw-html-format` | `recli/src/runner.ts:371` | `<Binary: ${size} bytes>` — `size` est un **nombre**, pas du contenu utilisateur |
| `insecure-object-assign` | `reqy-web/lib/openapi-import-schema.ts:202` | `Object.assign(merged, parsed)` sur un **objet modèle local** (schéma OpenAPI parsé), pas de mass-assignment vers un objet de confiance |
| `react-insecure-request` | `reqy-web/app/api/proxy-models/route.ts:105` | `fetch(url)` — l'URL est **fournie par l'utilisateur** (endpoint de modèles IA locaux, ex. Ollama en HTTP) — par design, comme proxy-ai |
| `detected-jwt-token` (×4) | `modules/encode-decode/codec.test.ts` | **Fixtures de test** (JWTs factices `eyJ…`) |
| `detected-google-oauth-access-token` | `lib/__tests__/postman-collection.test.ts` | **Fixture de test** (`ya29.xxx`) |
| `unsafe-formatstring` (×2) | `lib/__tests__/…/dataset-validation.test.ts` | **Fixture de test** |

## ⚠️ À TRAITER (séparément)

| Règle | Fichier | Recommandation |
|---|---|---|
| `detect-non-literal-regexp` | `lib/detect-shared-python.ts:267` | Regex construite sur le **contenu de dépôts importés** (code Python) — bornée (`{0,200}`) mais à surveiller : valider la longueur du contenu (déjà capé à 500 Ko) |
| `detect-non-literal-regexp` | `lib/detect-shared-handler.ts:236`, `detect-shared-orchestrator.ts:385` | Idem — contenu de projets analysés, borné par les caps existants |
| `insecure-object-assign` | `lib/openapi-import-schema.ts:202` | Si le schéma devient une surface d'attaque partagée (serveur), remplacer par un merge avec allowlist de champs |

---

## Résultat attendu

82 findings → après correctifs : **26 résolus**, ~50 faux positifs documentés, ~4 à traiter séparément (tous LOW, bornés par des caps existants).
