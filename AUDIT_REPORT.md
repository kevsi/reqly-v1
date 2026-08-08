# AUDIT REPORT — Monorepo reqly (apiPlayground)

Audit du **code réel** (lecture + greps + exécution des commandes), sans dépendre des fichiers `.md`.
Périmètre : `reqy-web`, `recli`, `reqly-landing`, `mcp-docs`, `hooklet-mobile`, `src-tauri`, `sync-server`, `packages/shared`, `scripts`, `.github/workflows`.

Date : 2026-08-07. Node v22.23.1, pnpm 11.10.0.

---

## RÉSUMÉ EXÉCUTIF

- **Typecheck, lint, tests : TOUT PASSE** (codes de sortie réels vérifiés, voir § VERIFICATION). Zéro erreur de lint, zéro test rouge.
- **Mais :** 1 faille de sécurité sérieuse (exécution de code arbitraire côté serveur via la route de test-runner, protégée seulement par un token « visiteur » auto-distribué + un rate-limit contournable), 1 SSRF non protégé, 1 endpoint webhook public sans rate-limit, et 14 vulnérabilités de dépendances (dont la moitié **non couvertes par les overrides** existants).
- Les contrôles CI ne couvrent qu'une partie du workspace : seul `reqy-web` est linté, `hooklet-mobile` et `mcp-docs` ne sont ni lintés ni testés, pas d'E2E en CI, pas de scan de secrets dans le workflow principal.

---

## 1. SÉCURITÉ

### CRITICAL

**C1 — Exécution de code arbitraire dans le process serveur, atteignable par n'importe quel visiteur.**

- `reqy-web/app/api/test-runner/run/route.ts:53-105` accepte un `Collection` complet dans le body et le passe à `runCollection`.
- `reqy-web/lib/test-runner/runner.ts:54,83` extrait `preRequestScript`/`postResponseScript` directement de l'objet fourni par le client (cast `as unknown as { ... }`), sans aucune validation.
- `reqy-web/lib/test-runner/scripts.ts:141-157` compile ce code avec `new vm.Script(...)` et l'exécute dans `vm.createContext(...)`. **`vm` n'est pas une frontière de sécurité Node.** `codeGeneration: { strings:false, wasm:false }` et `timeout: 5000` atténuent (pas d'`eval`/`new Function`/`wasm`, CPU borné à 5 s), mais une évasion de `vm` ou un simple `while(true)` répété en boucle = DoS soutenu.
- Protection actuelle : rate-limiter 10 req/min dont la clé est dérivée de `x-forwarded-for` (route.ts:48-51), un en-tête **spoofable** par l'attaquant (`X-Forwarded-For: 1.2.3.4`), et le cookie `proxy_visitor` que `proxy.ts:70-80` délivre **gratuitement à tout anonyme**. Ce n'est pas une authentification.
- **Correctif recommandé** : exécuter ce chemin dans un worker isolé (sous-processus avec `--disable-code-generation-from-strings` ou `isolated-vm`), ou exiger une vraie authentification, ou désactiver les scripts côté serveur public et les exécuter côté client.

### HIGH

**H1 — SSRF dans `/api/proxy-models` (fetch vers un `baseUrl` client non validé).**

- `reqy-web/app/api/proxy-models/route.ts:172,184,199` : pour `custom`/`openai`, le `baseUrl` fourni par le client est passé tel quel à `fetchOpenAICompatible(baseUrl, apiKey)` (route.ts:18-31), l'`apiKey` étant envoyée en `Authorization: Bearer`.
- Aucune vérification `isBlockedIp`/résolution DNS, contrairement aux chemins parallèles protégés : `reqy-web/app/api/proxy/route.ts:226-264`, `reqy-web/app/api/proxy-ai/lib/url-utils.ts:50-57`.
- Un attaquant peut pointer `baseUrl` vers `169.254.169.254` (metadata cloud), RFC1918, etc. Même gating « visiteur » que C1.

**H2 — Endpoint webhook public sans rate-limit et croissance DB illimitée.**

- `sync-server/src/index.ts:63-77` : le rate-limit couvre `/api/workspaces/*`, `/api/memberships/*`, `/api/auth/*`, `/api/sync/*`, mais **pas** `/api/hooks/:slug` (public, non authentifié, `hooklet-hooks.ts:107`).
- `sync-server/src/routes/hooklet-hooks.ts:58-74` + `db.ts:108-121` : chaque body (jusqu'à 5 Mo) est stocké en intégralité dans `hooklet_events.body`. Quiconque devine un slug de 24 hex remplit le SQLite unique et spamme les push notifications.
- **Correctif** : appliquer `rateLimitMiddleware` à `/api/hooks/*` + borner le stockage.

### MEDIUM

- **M1 — Cookie de session sans flag `Secure` en production** : `sync-server/src/routes/auth.ts:51-56` (`issueSession`) ne met pas `secure: true`, alors que `logout` le met conditionnellement (auth.ts:311,316). Incohérent ; en HTTPS le cookie peut transiter en clair.
- **M2 — Path traversal dans `git_sync_collections` (Tauri)** : `src-tauri/src/git/commands.rs:859-867` construit `{safe_name}_{id}.json` avec un `id` **non sanitizé** → un `id` `../../...` écrit hors de `collections/`. Le chemin parallèle `git_write_collection_file` (commands.rs:810-811) sanitize bien les deux. Surface locale (l'utilisateur s'attaque à lui-même) mais vrai bug.
- **M3 — Secret de webhook persévé en clair dans la query string** : `sync-server/src/routes/hooklet-hooks.ts:32,69` accepte `?secret=` et persiste toute la query (incl. le secret) dans `hooklet_events.query`. La forme header `x-webhook-secret` est correctement masquée (:50).
- **M4 — Cibles de redirection SSRF non vérifiées sur `/api/proxy`** : `reqy-web/app/api/proxy/route.ts:348-361` valide le `Location` des 3xx avec `validateUrl` seulement (pas `isBlockedIp`, pas de résolution DNS-rebinding, pas de Host pinning). Le serveur ne suit pas la redirection (`redirect:"manual"`), mais remet une URI interne valide au client.
- **M5 — Bypass de rate-limit via `X-Forwarded-For` spoofé** : `app/api/test-runner/run/route.ts:48-51`, `app/api/proxy-models/route.ts:7-10`, `app/api/github-import/route.ts:31-34`, `app/api/embed/route.ts:9` lisent `x-forwarded-for` sans le garde `TRUSTED_PROXY` que `/api/proxy` implémente (route.ts:96-114). Amplifie C1/H1.
- **M6 — Fuite d'information via `String(err)`** : `reqy-web/app/api/proxy-ai/route.ts:115-117` renvoie l'erreur brute au client ; les erreurs upstream peuvent exposer hostname/paths internes (openai-compat.ts:86).
- **M7 — SSRF dans `/api/sdk-generate`** : `reqy-web/app/api/sdk-generate/route.ts:37-71` fetch `baseUrl` client puis fetch un `link` absolu issu de la réponse du générateur, sans allow-list. Impact réel limité (l'attaquant pilote les deux bouts).
- **M8 — URL de prod en dur + pas d'enforcement HTTPS (mobile)** : `hooklet-mobile/App.tsx:14` hardcode `https://reqly.duckdns.org` et l'impose aux flux SignUp/Verify (App.tsx:89,98). `src/screens/SignInScreen.tsx:101-110` accepte n'importe quelle URL ; `src/api.ts:17` POSTe les identifiants en clair si l'utilisateur tape `http://`.
- **M9 — Leg Windows de la CI cassé** : `.github/workflows/ci.yml:124` utilise `BUILD_TARGET=desktop pnpm generate` (syntaxe bash), sur `windows-latest` le shell par défaut est `pwsh` → échec. De plus **redondant** : `reqy-web/scripts/build-desktop.mjs:21` fixe déjà `process.env.BUILD_TARGET`.
- **M10 — Secrets de build dans les layers Docker** : `.github/workflows/ci.yml:146-147` + `Dockerfile:37-40` passent `AUTH_SIGNING_SECRET`/`NEXT_PUBLIC_SYNC_URL` en `--build-arg`/`ENV` ; récupérables via `docker history` sauf image squashed. `AUTH_SIGNING_SECRET` devrait être un secret runtime, pas build-time.

### LOW

- **L1** — `/api/proxy` en mode debug (`x-proxy-debug:1`) renvoie `targetUrl`/`hostname` (route.ts:435-474) — informationnel.
- **L2** — `dangerouslySetInnerHTML` dans `response-content-renderer.tsx:97-99` : DOMPurify allow-list `span`+`class` ; iframe preview `srcDoc={sanitize(...)} sandbox=""` (:139-144). **Correct.**
- **L3** — `Function('return require("child_process")')()` pour spawner `python` (`lib/detect-shared-python.ts:491-493`, `detect-shared-python-ast.ts:22-24`) : le contenu analysé passe par **stdin**, pas d'injection, mais dépend du `python` du PATH (surface supply-chain) — à remplacer par un vrai import si bundling le permet.
- **L4** — Comparaison du secret d'endpoint en `!==` non constant-time : `sync-server/src/routes/hooklet-hooks.ts:33` (syntétrie avec `auth.ts:206` qui utilise `timingSafeEqual`).
- **L5** — MCP HTTP de recli : bind loopback `127.0.0.1`, `authToken` par défaut undefined (`recli/src/mcp/server.ts:307-310`) ; limité à un process local qui spoofe un Origin autorisé.
- **L6** — CLI `recli openapi` : `fetch()` sans garde `isUrlAllowed` (`recli/src/commands/openapi.ts:12`), contrairement au chemin MCP (`import-export.ts:329`). Non attaquable (l'utilisateur lance le CLI lui-même).
- **L7** — `hooklet-mobile/src/api.ts:173` : token Expo push dans la query string `/api/hooklet/devices?token=...`.
- **L8** — `reqy-web/lib/env.ts:97-99` : `validateBuildTimeEnv()` est un no-op (« reserved for future ») alors que le code le commente comme garde-fou de build.
- **L9** — Lien GitHub stale : `mcp-docs/lib/shared.ts:7-9` pointe `kevsi/reqly-v1`, `reqly-landing/lib/links.ts:3` pointe `kevsi/apiPlayground` — un des deux fait 404.
- **L10** — `sync-server/fly.toml:9,13` : email perso réel (`roughikev@gmail.com`) committé comme `SMTP_USER`/`EMAIL_FROM`.
- **L11** — Artefacts morts à la racine : `reqly-mobile.zip`, `audit-opencode.log`, `rate_limiter.rs` (voir §2).

### Secrets / .env

- **Aucun secret committé.** `.env.local` (racine) est gitignoré (`git check-ignore` OK) ; seul `reqy-web/.env.example` est suivi. Le scan `scripts/check-secrets.mjs` gère correctement ce cas. Pas de `sk-`, `ghp_`, `AIza`, `AKIA`, etc. trouvés dans `src-tauri`, `sync-server`, `hooklet-mobile`.

---

## 2. QUALITÉ DE CODE

- **Lint (réel)** : `reqy-web lint` → **exit 0, mais 109 warnings**, dominés par `react-hooks/set-state-in-effect` (ex. `src/ai/hooks/use-ai-sidebar-history.ts:20,29,37`, `src/ai/components/assistant-steps-renderer.tsx:220`). Les règles critiques (`no-explicit-any`, `no-unused-vars`, `exhaustive-deps`) sont en erreur donc respectées. 1 warning auto-fixable.
- **Typecheck (réel)** : **passe partout** (reqy-web, sync-server, recli build, reqly-landing, mcp-docs `types:check`).
- **Catch vides (erreurs avalées)** : `lib/config.ts:40,58,76,90`, `lib/project-analyzer.ts:223,258,469`, `lib/tree-sitter-parser.ts:551,581`, `lib/detect-shared-utils.ts:137`, `proxy.ts:76`, `hooks/use-mcp-server.ts:106`. Certains masquent des échecs fail-closed (ex. `project-analyzer.ts:223` avale les erreurs de propagation de routes).
- **Casts `as unknown as` masquant des surfaces d'injection** : `lib/test-runner/runner.ts:54,83,95` (celui qui alimente C1), `app/api/proxy-ai/route.ts:96-109`, `lib/request-executor.ts:375`, `lib/secure-storage.ts:240`.
- **`as any`** : `packages/shared/src/openapi/index.ts:80,181-184` (type-unsafety Low).
- **`console.log` résiduels** (hors tests) : `lib/persistence.ts:148`, `lib/graphql/codegen.ts:32-33`.
- **Code mort / orphelin** :
  - `rate_limiter.rs` (racine) : implémentation TokenBucket **référencée nulle part** (seulement ses propres tests). Doublon total de `sync-server/src/rate-limiter.ts`. À supprimer ou à câbler dans src-tauri.
  - `sync-server/src/rate-limiter.ts:3` commente « sliding-window » mais le code est **fixed-window** (reset en bloc à `resetAt`, :54-57). Nom trompeur.
- **`unwrap`/`expect` runtime Rust** : `src-tauri/src/lib.rs:27-29,52,62,142` (setup rustls/reqwest — panic au démarrage, acceptable), `rate_limiter.rs:36`, `capture.rs:182`, `store.rs:185`. Pas de `unsafe`, pas de `transmute`, pas de TODO/FIXME en Rust.
- **Modules websocket supprimés propres** : la suppression de `src-tauri/src/websocket/*.rs` n'a laissé **aucun import cassé** (plus de déclaration de module ni de commande dans `lib.rs`).
- **Mojibake/encodage cassé** : `scripts/check-secrets.mjs:4-62`, `packages/shared/src/index.ts:1`, `packages/shared/package.json:1` (caractères « — » → `�?`). Cosmétique.

---

## 3. ARCHITECTURE

- **7 packages + 1 workspace réel** : `reqy-web` (648 fichiers), `recli` (68), `sync-server` (30), `reqly-landing` (19), `mcp-docs` (19), `hooklet-mobile` (13), `packages/shared` (13), `src-tauri` (15 .rs). **Il n'y a pas de `packages/core`** (l'hypothèse du prompt ne correspond pas à la réalité).
- **`@reqly/shared` n'est PAS du code mort** : consommé par `reqy-web` (curl-parser, variable-path, assertions) et `recli` (types, path-utils, assertions, curl-parser, contract). Buildé en CI (`recli-ci.yml:42`).
- **Dédoublonnage déjà fait proprement** : `recli/src/assertions.ts`, `reqy-web/lib/curl-parser.ts`, `lib/variable-path.ts` sont des **re-exports** vers `@reqly/shared` (commentés comme tels). Le moteur canonique est `packages/shared/src/assertions/index.ts` (686 lignes).
- **`hooklet-mobile` hors du monorepo** : absent de `pnpm-workspace.yaml`, utilise son propre **npm** `package-lock.json` (le reste est pnpm), et redéfinit `src/types.ts` au lieu d'importer `@reqly/shared`. Drift d'architecture (2 package managers + modèle de types dupliqué).
- **Lockfiles imbriqués** : `reqly-landing/pnpm-lock.yaml` et `sync-server/pnpm-lock.yaml` sont **suivis par git** alors que le workspace est rooté au pnpm-lock.yaml principal. Résolution divergente constatée (ex. vitest 3.2.7 / vite 7.3.6 côté sync-server). Source de drift — à supprimer.
- **Duplication de rate limiter** : implémentation TS (sync-server) + implémentation Rust orpheline (racine), zéro partage de design.
- **Deux copies de libs** : `lucide-react` 0.564.0 + 1.28.0 (mcp-docs), TypeScript 5.7.3 (reqy-web/recli) vs 6.0.3 (mcp-docs).

---

## 4. TESTS

Résultats **réels** (voir § VERIFICATION) :

| Package        | Suite  | Résultat                                                                                                                                                                                                    |
| -------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| reqy-web       | vitest | **exit 0** — couverture globée affichée ; quelques fichiers à 0% (ex. `src/ai/hooks/use-ai-engine.ts`, `src/ai/hooks/use-ai-sidebar-chat.ts`, `src/ai/cloud-engine/search-index.ts`, `test/parser-stub.ts`) |
| sync-server    | vitest | **exit 0** — 11 fichiers, **129 tests passés**                                                                                                                                                              |
| recli          | vitest | **exit 0** — 21 fichiers, **309 tests passés** (dont e2e CLI)                                                                                                                                               |
| reqly-landing  | —      | pas de script `test`                                                                                                                                                                                        |
| mcp-docs       | —      | pas de script `test`                                                                                                                                                                                        |
| hooklet-mobile | —      | pas de script `test`                                                                                                                                                                                        |

- **Trou noir de couverture CI** : `hooklet-mobile` et `mcp-docs` n'ont **aucun** lint/typecheck/test en CI. `reqly-landing` typecheck uniquement. Le script `test:e2e` (Playwright, `reqy-web/tests/e2e/*.spec.ts`) n'est **jamais** lancé en CI.
- **Couverture partielle localisée** : les gros hooks d'état (`use-request-store`, `use-ai-engine`, `use-ai-sidebar-chat`) sont à 0% — c'est le cœur applicatif le moins testé.
- L'assertion du prompt « les tests passent-ils ? » → **OUI, tous passent**, avec les codes de sortie vérifiés ci-dessous.

---

## 5. DÉPENDANCES

`pnpm audit` (racine, réel) : **14 vulnérabilités = 10 high + 4 moderate, exit 1**. Toutes sont des **transitives de dev** (eslint/minimatch→brace-expansion, vitest/jsdom→undici, js-yaml). Aucune en prod critique directe, mais :

- **`js-yaml@4.3.0` résolu** — dans la plage vulnérable (`<4.3.1`, CVE-2026-59870, CPU quadratic sur `!!omap`). **L'override workspace `js-yaml: ^4.3.0` (pnpm-workspace.yaml:19) est INSUFFISANT** : il verrouille précisément la version vulnérable au lieu de `^4.3.1`. C'est le seul cas où un override existant est contre-productif.
- `brace-expansion` : 6 advisories high (GHSA-3jxr, GHSA-mh99, GHSA-rgw5…), patched ≥1.1.18 / ≥2.1.4 / ≥5.0.9. Via `minimatch` (eslint, test-exclude, eslint-plugin-import…). Non overridé.
- `undici` : 6 advisories (high + moderate), patched ≥7.29.0. Via `jsdom` (vitest). Non overridé.
- **Overrides existants corrects** : fast-uri, hono, ip-address, lodash, postcss, sharp, js-yaml (à corriger), `@hono/node-server`. `allowBuilds` discipliné (esbuild désactivé, natives tree-sitter approuvées).

---

## 6. CI/CD (`.github/workflows/`)

2 workflows : `ci.yml` (154 lignes) + `recli-ci.yml` (52 lignes).

**Fonctionnel** : typecheck/lint/test via turbo en parallèle, build-web avec `ANALYZE=true` + bundle gate, build-desktop en matrice 3 OS, build-docker avec smoke test `docker run`+`curl`, concurrency cancel-in-progress, path-scope recli.

**Problèmes :**

- **H9 (CI)** : leg `windows-latest` de build-desktop **cassé** (`ci.yml:124`, syntaxe bash sur shell pwsh) — et le `BUILD_TARGET=desktop` est redondant (déjà fixé dans build-desktop.mjs:21).
- **H10 (CI)** : secrets de build dans les layers Docker (`ci.yml:146-147`, `Dockerfile:39-40`).
- **M (CI)** : aucun `permissions:` au niveau job, pas de `persist-credentials: false` (token GitHub trop large partout).
- **M (CI)** : actions tierces épinglées sur des **tags mouvants** (`@v4`), pas de SHA.
- **M (CI)** : `recli-ci.yml` dérive sur les versions — **Node 20 + pnpm 9** vs **Node 22 + pnpm 11** partout ailleurs, `pnpm install` **sans `--frozen-lockfile`** (peut muter le lockfile).
- **M (CI)** : gating incomplet — seul `reqy-web` définit `lint` ; `recli`, `sync-server`, `reqly-landing`, `mcp-docs`, `hooklet-mobile` ne sont **jamais lintés** par la CI principale ; `mcp-docs` définit `types:check` que turbo ignore ; pas d'E2E ; **scan de secrets uniquement dans recli-ci.yml**, absent de ci.yml.
- **M (CI)** : `NEXT_PUBLIC_SYNC_URL` passée comme `secrets.*` alors que c'est une variable publique inlinée par Next (`ci.yml:88`).
- **M (CI)** : lockfile racine **dirty** (modifié, non committé) + lockfiles imbriqués committés → un `pnpm install --frozen-lockfile` sur un clone frais échoue.
- **L (CI)** : `turbo.json` ne déclare pas `env: ["ANALYZE"]` → le cache peut servir un build sans rapport d'analyze et faire échouer le gate en faux positif (bundle-gate.mjs:19-21 hard-fail).

---

## 7. PERFORMANCE & CONFIG

- **Bundle gate** : `reqy-web/scripts/bundle-gate.mjs` — scan regex de `.next/analyze/client.html`, seuil **500 Ko gzip** sur les chunks initiaux de `main-app`. Câblé dans ci.yml après `pnpm build` (`ANALYZE=true`). **Fragile** : regex pure, exit 1 sur format changeant, et ne couvre **pas** l'export statique desktop (build-desktop.mjs le contourne).
- **`next.config.mjs`** : dual-build propre (toggle `BUILD_TARGET` env), `output: 'export'` + `trailingSlash` pour desktop. CSP **nonce + `strict-dynamic`** appliqué dans `reqy-web/proxy.ts:82-107` (bonne pratique), fallback headers() (nosniff/DENY/HSTS/permissions-policy). `images.unoptimized: true`. `optimizePackageImports: ["lucide-react"]`.
- **Docker** : `Dockerfile:64` installe **toute** la node_modules (incl. devDeps) parce que `next.config.mjs` importe `@next/bundle-analyzer` (devDep) au chargement → image pas « trimmed », tree-sitter natifs + tooling embarqués en prod.
- **build-desktop.mjs** : patch `force-dynamic→force-static` des route handlers, `pnpm deploy --legacy --prod` de recli dans `src-tauri/resources/recli` (réseau re-résolu au build, non hermétique, `node_modules` complet de recli embarqué) — best-effort seulement (warning mou si échec, l'app peut être packagée sans MCP silencieusement).
- Root `package.json` : **pas de champ `packageManager`** → turbo émet des warnings ; à ajouter (`"packageManager": "pnpm@11.10.0"`) pour la reproductibilité.

---

## 10 CHOSES À CORRIGER EN PRIORITÉ

1. **C1** — Exécution de code arbitraire serveur via `/api/test-runner/run` : worker isolé / vraie auth / exécution côté client.
2. **H1** — SSRF `/api/proxy-models` : appliquer `isBlockedIp` + résolution DNS (reprendre `url-utils.ts`).
3. **H2** — Rate-limit + borne de stockage sur `/api/hooks/:slug` (webhook public).
4. **Vulns** — Override `js-yaml ^4.3.1` ; forcer `minimatch`/`brace-expansion` et `undici >=7.29.0` en overrides ; ou `pnpm audit fix`.
5. **CI** — Réparer le leg Windows (`ci.yml:124`, retirer `BUILD_TARGET=desktop` du run), épingler les actions sur SHA, ajouter `permissions: contents: read`, `persist-credentials: false`.
6. **CI** — Aligner `recli-ci.yml` (Node 22, pnpm 11, `--frozen-lockfile`) et étendre le gating : lint partout, E2E, scan secrets dans ci.yml.
7. **Secrets** — Sortir `AUTH_SIGNING_SECRET` des build-args Docker (secret runtime), et `NEXT_PUBLIC_SYNC_URL` des `secrets.*`.
8. **Cookies** — Ajouter `secure: true` à la session cookie sync-server (auth.ts:51-56).
9. **Path traversal** — Sanitiser `id` dans `git_sync_collections` (commands.rs:859-867).
10. **Hygiène** — Supprimer `rate_limiter.rs` orphelin, lockfiles imbriqués committés, artefacts racine (`reqly-mobile.zip`, `audit-opencode.log`) ; committer le lockfile racine ; ajouter `packageManager`.

---

## VERIFICATION — commandes réellement exécutées

| Commande                                | Résultat réel                                                                                                  | Code sortie |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------- |
| `pnpm audit` (racine)                   | 14 vulns (10 high, 4 moderate) — brace-expansion ×6, undici ×6, js-yaml ×1                                     | **1**       |
| `pnpm --dir reqy-web typecheck`         | `tsc --noEmit` propre                                                                                          | **0**       |
| `pnpm --dir reqy-web lint`              | 0 erreurs, **109 warnings** (react-hooks/set-state-in-effect dominant)                                         | **0**       |
| `pnpm --dir reqy-web test`              | vitest : **exit 0** (couverture affichée)                                                                      | **0**       |
| `pnpm --dir sync-server typecheck`      | `tsc --noEmit` propre                                                                                          | **0**       |
| `pnpm --dir sync-server test`           | 11 fichiers, **129 tests passés**                                                                              | **0**       |
| `pnpm --dir recli test`                 | 21 fichiers, **309 tests passés** (dont e2e CLI)                                                               | **0**       |
| `pnpm --dir recli build`                | `tsc` propre                                                                                                   | **0**       |
| `pnpm --dir reqly-landing typecheck`    | `tsc --noEmit` propre                                                                                          | **0**       |
| `pnpm --dir mcp-docs types:check`       | `next typegen && tsc --noEmit` propre                                                                          | **0**       |
| `git check-ignore .env.local`           | **ignoré** (pas de secret committé)                                                                            | 0           |
| `git ls-files *.lock`                   | `src-tauri/Cargo.lock` + `pnpm-lock.yaml`, `reqly-landing/pnpm-lock.yaml`, `sync-server/pnpm-lock.yaml` suivis | —           |
| `pnpm why js-yaml`                      | **js-yaml@4.3.0** (vulnérable, patch ≥4.3.1)                                                                   | —           |
| `git status --porcelain pnpm-lock.yaml` | **` M`** (lockfile racine modifié, non committé)                                                               | —           |

> Note : `pnpm test`/`pnpm lint`/`pnpm typecheck` via turbo n'ont **pas** été exécutés tels quels (le champ `packageManager` absent du package.json racine produit des warnings turbo ; conformément au prompt, les scripts ont été lancés directement dans chaque package pour obtenir les vrais résultats). Ces résultats individuels sont ceux rapportés ci-dessus.
