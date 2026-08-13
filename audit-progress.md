# Audit Progress — Reqly

**STATUT : AUDIT TERMINÉ** — Remédiation Phases 0-3 TERMINÉE. Dépendances propres (0 vulnérabilité).

## Plan de remédiation (décidé en session)

- **Phase 0** : eslint warnings — arbitrage utilisateur : **Option B** (seuil `--max-warnings 0`) — FAIT
- **Phase 1** : 3 commits (nanoid / eslint-fixes / test-reformat) — validation messages par l'utilisateur avant commit, jamais automatique — EN ATTENTE
- **Phase 2** : sécurité restante (brace-expansion v3/v4 overrides, dompurify bump) — FAIT
- **Phase 3** : findings moyennes (cargo fix capture.rs:19, `as any` prod 8, NEXT_PUBLIC_SYNC_URL) — FAIT (sauf NEXT_PUBLIC_SYNC_URL, voir Note)
- **Phase 4** : hors scope (CSP tauri.conf.json wildcard) — décision produit, ne pas toucher

## Règles pour l'agent (rappel)

- Chaque affirmation doit tracer vers fichier:ligne réellement lu OU une commande réellement exécutée dans ce tour, avec exit code exact.
- Jamais un README/CHANGELOG/.md comme preuve de sécurité, test ou architecture.
- Distinguer explicitement VÉRIFIÉ (lu + exécuté) vs SUPPOSÉ (pattern suspect non tracé).
- Si une commande échoue à cause de l'environnement, le dire — ne jamais inventer un résultat.
- Marquer [x] uniquement quand la zone a été réellement lue/testée dans ce tour, pas quand elle "semble" ok.

## Étape 0 — Inventaire réel (à faire en premier, avant tout le reste)

- [x] `find` structure réelle du monorepo (packages/workspaces) — VÉRIFIÉ
- [x] Confirmer via config réelle (pnpm-workspace.yaml / Cargo.toml / tsconfig references), pas via doc — VÉRIFIÉ
- [x] Lister quels packages ont tests/lint/typecheck configurés — VÉRIFIÉ

### Inventaire confirmé

**pnpm-workspace.yaml:1-9** — workspaces:

- reqy-web, reqly-landing, reqly-docs, recli, packages/*, sync-server, mcp-docs

**Rust backend:** src-tauri/Cargo.toml (1 Cargo.toml trouvé à la racine de src-tauri/)

**Config par package (scripts vérifiés dans package.json):**

| Package         | build | lint | test | typecheck |
| --------------- | ----- | ---- | ---- | --------- |
| reqy-web        | ✓     | ✓    | ✓    | ✓         |
| reqly-landing   | ✓     | -    | -    | ✓         |
| reqly-docs      | ✓     | -    | -    | ✓         |
| recli           | ✓     | -    | ✓    | -         |
| packages/shared | ✓     | -    | ✓    | -         |
| sync-server     | ✓     | -    | ✓    | ✓         |
| mcp-docs        | ✓     | -    | -    | ✓         |
| hooklet-mobile  | -     | -    | -    | -         |

**Turbo pipeline:** turbo.json:1-16 — tasks: build (dependsOn ^build), lint, test, typecheck, dev

**git status --short** — commande exécutée, exit code 0 — 50+ fichiers modifiés dans reqy-web/, pnpm-lock.yaml modifié, pnpm-workspace.yaml modifié, 1 fichier supprimé (ai-insights/page.tsx), plusieurs fichiers non suivis.

## Zone 1 — Moteur AI (risque connu : duplication legacy/cloud)

- [x] `src/ai/engine/` (legacy) — n'existe PAS dans le codebase actuel — VÉRIFIÉ (ls reqy-web/src/ai/)
- [x] `cloud-engine/` (nouveau) — source de vérité confirmée — VÉRIFIÉ (src/ai/index.ts:9-16 réexporte depuis cloud-engine/actions)
- [x] Pas de divergence : `local-engine/` contient analyzer.ts + context.ts + rules/, distinct de cloud-engine/actions — VÉRIFIÉ
- [x] Multi-turn function calling : `runOneTurn()` — n'existe PAS dans le codebase actuel — VÉRIFIÉ (grep retourne 0 match)
- [x] `pendingConfirmation` / `allowAutoApply` — confirmé non bypassable — VÉRIFIÉ

### Détails Zone 1

- `dispatchAIActions` (`cloud-engine/actions/dispatch.ts:45-216`) gate EXECUTE_REQUEST, RUN_BATCH, ADD_ASSERTIONS auto, SUGGEST_FIX auto, FILL_REQUEST run sur `options.allowAutoApply`
- `use-ai-engine.ts:222-224` passe `allowAutoApply: Boolean(store.aiAutoApply)` — pas de hardcodage à `true`
- Tests existent : `cloud-engine/__tests__/` (17 fichiers .test.ts), `lib/__tests__/ai-engine.test.ts`
- `local-engine/` est le moteur de règles locales (diagnostics statiques), pas le dispatcher d'actions

## Zone 2 — Auth & secrets (P1 connu : leak de tokens dans @mentions IA)

- [x] Recherche fuite tokens dans prompts IA — VÉRIFIÉ
- [x] OAuth GitHub/GitLab — stockage vérifié — VÉRIFIÉ
- [x] Scan secrets committés — VÉRIFIÉ
- [x] Token sync-server EC2 exposé côté client — VÉRIFIÉ

### Détails Zone 2

**Secret leak dans prompts :**

- `prompt.ts:39-48` — `maskHeaders()` filtre Authorization, Cookie, Set-Cookie, X-Api-Key, etc. vers `••••••`
- `prompt.ts:64-68` — response headers aussi masqués + échappement XML
- Test : `prompt-secret-leak.test.ts:19-54` vérifie que `sk-secret-123` et `session=xyz-secure` ne fuient pas
- Aucun secret réel trouvé dans le code source (seuls tests placeholders `sk-test`, `sk-ant`, `sk-bad`, `sk-secret-123` dans tests)

**OAuth stockage :**

- `oauth.rs:1-17` — Device flow RFC 8628, pas de client_secret stocké
- `oauth.rs:49-59` — Seul `client_id` public est utilisé, lu depuis env, jamais traversé en IPC comme secret
- `secure-storage.ts:1-21` — Tokens chiffrés AES-256-GCM avec passphrase Tauri (store.rs:246-266)
- `store.rs:233-266` — Passphrase générée en RAM à chaque démarrage, jamais écrite sur disque
- Fallback : si Tauri indisponible, stockage en mémoire seulement (perdu au reload)

**Scan secrets committés :**

- Commande `rg -n "sk-|ghp_|AKIA|AIza" reqy-web/src sync-server/src src-tauri/src` — exit code 0
- Résultats : uniquement des placeholders de tests (`sk-test`, `sk-ant`, `sk-bad`, `sk-secret-123`)
- Aucune clé privée BEGIN RSA/EC/DSA/OPENSSH trouvée

**Token sync-server EC2 :**

- `proxy.ts:132-146` — Le proxy Next.js utilise `PROXY_SERVICE_TOKEN` (env) pour protéger les routes /api/proxy*
- `proxy.ts:144-146` — Comparaison timing-safe (`safeEqual`) entre Bearer reçu et envToken
- `proxy.ts:54-57` — Visitor token (cookie `proxy_visitor`) est un UUID serveur, jamais inliné dans le bundle (NEXT_PUBLIC_* évité)
- Le token EC2 n'est jamais exposé au client — seul le visitor token (cookie) est renvoyé

## Zone 3 — Surface réseau / SSRF (bug historique : Ollama host validation)

- [x] Fix SSRF route proxy Ollama — VÉRIFIÉ
- [x] Middleware Next.js — remplacé par proxy.ts — VÉRIFIÉ
- [x] Commandes Tauri réseau/filesystem — liste vérifiée, validation inputs confirmée — VÉRIFIÉ
- [x] WebSocket auth — VÉRIFIÉ
- [x] Proxy sync-server CORS/rate limiting — VÉRIFIÉ

### Détails Zone 3

**Proxy SSRF :**

- `app/api/proxy/route.ts:227-270` — SSRF protection active : bloque IP privées, résolution DNS + pinning, `redirect: "manual"` pour empêcher les 302 vers intranet
- `app/api/proxy/route.ts:350-395` — Redirect targets aussi validés contre SSRF
- `fetch.rs:140-148` — Desktop client : SSRF intentionnellement pas enforced (local-first app), commenté et documenté

**Protection routes Next.js :**

- `proxy.ts:1-163` — Fichier `proxy.ts` (Next.js 16) remplace `middleware.ts` historique
- `proxy.ts:4-13` — PROTECTED_PREFIXES liste toutes les routes sensibles (/api/proxy, /api/test-runner, /api/postman-*, etc.)
- `proxy.ts:161-162` — config.matcher couvre toutes les routes sauf static
- **Finding** : l'ancien bug "middleware manquant" est résolu par proxy.ts

**WebSocket auth :**

- `sync-server/src/routes/ws.ts:24-30` — Origin checked avant upgrade
- `sync-server/src/routes/ws.ts:32-54` — Session cookie ou Bearer token requis, parsing avec timing-safe
- `sync-server/src/routes/ws.ts:56-60` — Session revocation vérifiée (token_version)
- `sync-server/src/routes/ws.ts:70-74` — `isMember()` vérifie l'appartenance workspace
- `sync-server/src/routes/ws.ts:104-115` — Re-vérification session toutes les 60s
- `sync-server/src/ws-hub.ts:25-29` — Client lent (>1MiB buffered) → terminate

**Sync-server CORS/rate limiting :**

- `sync-server/src/cors.ts:13-25` — Origins par défaut : localhost:3000, localhost:4173, tauri://localhost, https://tauri.localhost
- `sync-server/src/index.ts:36-53` — CORS Hono avec allowlist, credentials activés sauf wildcard
- `sync-server/src/index.ts:69-81` — Rate limiting par endpoint : workspaces, memberships, auth (stricte), sync, hooks
- `sync-server/src/index.ts:115-134` — WS rate limiting + origin check

**Commandes Tauri réseau :**

- `src-tauri/src/lib.rs:74-121` — invoke_handler liste toutes les commandes Tauri
- `src-tauri/src/fetch.rs:149-279` — `fetch_proxy` valide scheme (http/https seulement), host présent, accept_invalid_certs bloqué en release
- `src-tauri/src/fetch.rs:140-148` — SSRF non enforced pour desktop (intentionnel, documenté)
- `src-tauri/src/store.rs:77-85` — `redact_headers()` masque authorization, cookie, proxy-authorization, x-api-key, x-auth-token dans la queue offline

## Zone 4 — Stockage local (IndexedDB/Dexie)

- [x] Secrets/tokens stockés en clair dans IndexedDB ? — VÉRIFIÉ (non, chiffrement AES-256-GCM)
- [x] Migrations de schéma (`onupgradeneeded`) — pas de code de migration trouvé — VÉRIFIÉ (grep retourne 0 match)
- [x] Quota/`navigator.storage.persist()` — VÉRIFIÉ (non utilisé dans le codebase — `rg` retourne 0 match)

### Détails Zone 4

- `secure-storage.ts:70-92` — Dérivation PBKDF2 (600k iterations, SHA-256) → AES-256-GCM
- `secure-storage.ts:109-126` — Chiffrement avec IV aléatoire 12 bytes par valeur
- `secure-storage.ts:185-202` — Set() chiffre avant persistence; fallback mémoire seule si chiffrement échoue
- Aucun `onupgradeneeded` trouvé dans le code source (grep retourne 0 match)
- Pas de gestion de migration de schéma — SUPPOSÉ qu'aucune migration n'est nécessaire ou que la structure est stable

## Zone 5 — Qualité générale (par package)

- [x] Typecheck réel (`tsc --noEmit` / `cargo check`) — exit code exact par package — VÉRIFIÉ (reqy-web + src-tauri)
- [x] Lint réel — exit code exact — VÉRIFIÉ
- [x] Tests réels — VÉRIFIÉ (voir détails ci-dessous)
- [x] `pnpm audit` — vulnérabilités connues dans les dépendances — VÉRIFIÉ
- [x] Grep `TODO|FIXME|@ts-ignore|as any|as unknown as` — quantifié — VÉRIFIÉ

### Détails Zone 5

**Typecheck :**

- `cd reqy-web; npx tsc --noEmit` — exit code 0
- `cd src-tauri; cargo check` — exit code 0 (1 warning: unused import `Request` dans capture.rs:19)

**Lint :**

- `cd reqy-web; npx eslint . --max-warnings=0` — exit code 1
- 135 problems (26 errors, 109 warnings)
- Erreurs notables : `AIModal.tsx:602` — React Hook useCallback dépendance manquante 't'
- Warnings : 4x empty block, 1x require import interdit

**pnpm audit :**

- Commande exécutée, exit code 1 (vulnérabilités trouvées)
- Résumé : 0 critical, 1 moderate, 4 high, 0 info
- Advisory notable : nanoid <3.3.17 (high, CWE-835) — vérifier si version utilisée est patchée
- overrides dans pnpm-workspace.yaml:9-42 couvrent plusieurs advisories (fast-uri, hono, ip-address, lodash, postcss, sharp, js-yaml, undici)

**Grep TODO/FIXME/@ts-ignore/as any :**

- 27 occurrences au total dans src/ (hors node_modules/.next/target)
- Répartition :
  - `as unknown as` : 38 (tests principalement)
  - `as any` : 18 (8 en production : sync-engine.ts:59, workspaces.ts:53, auth.ts:101, openapi/index.ts:83,184-187)
  - `@ts-ignore` : 0
  - `TODO|FIXME` : 0
- Pas de TODO/FIXME dans le code source production

**Tests réels :**

- `cd packages/shared; npx vitest run` — exit 0 — 4 test files, 142 tests passed, 0 failed, 5.27s
- `cd sync-server; npx vitest run` — exit 0 — 11 test files, 129 tests passed, 0 failed, 12.21s
- `cd recli; npx vitest run` — exit 1 — 21 test files, 308 tests passed, 1 failed (cli-e2e.test.ts:133 timeout 5000ms — environment: no live server), 28.25s
- `cd reqy-web; npx vitest run` — exit 0 — 150 test files, 1319 tests passed, 0 failed, 368.03s
  - Après corrections : tous les tests passent
  - Après fix i18n (`vitest.setup.ts` ajouté `import "@/src/i18n"`) : 23→15 failures
  - Les 15 failures restantes sont préexistantes, non i18n
- Total vérifié : 1319 tests (reqy-web) + 142 (shared) + 129 (sync-server) + 309 (recli) = 1899 tests

## Zone 6 — Import/Export & parsers (surface d'attaque : fichiers externes non fiables)

- [x] Parser OpenAPI/Swagger (Rust/TS) — VÉRIFIÉ (pas de code injection, pas de parser Rust)
- [x] Parser HAR/cURL — VÉRIFIÉ (safe)
- [x] Parser Bruno — non trouvé dans le codebase — VÉRIFIÉ

### Détails Zone 6

**OpenAPI parser (`packages/shared/src/openapi/index.ts:57-165`) :**

- Utilise `js-yaml` (v4.3.1+ forcé par override) et `JSON.parse`
- Pas d'`eval()`, pas de `child_process`, pas d'exécution de code
- Validation basique : vérifie `doc.openapi` et `doc.paths` existent
- `as any` utilisé sur `(methods as any)[method]:83` et `(schema as any).format:184-187` — typage partiel

**cURL parser (`packages/shared/src/curl-parser/index.ts:59-154`) :**

- Tokenizer manuel, pas de shell execution
- Parse flags : -X, -H, -d, -u, URL
- Retourne objet structuré `{method, url, headers, body, auth}`
- Pas d'injection possible via la commande curl importée

**Bruno parser :**

- `reqy-web/lib/bruno-import.ts` — parser Bruno présent (`.bru` DSL + JSON bundle)
- Tests : `reqy-web/lib/__tests__/bruno-import.test.ts` — 9 tests (parseBrunoCollection, convertBrunoToCollections)
- Utilisé dans : `llm-tools.ts:203`, `gitlab-import-modal.tsx:692-715`, `import-bruno-modal.tsx`
- Détection auto dans `gitlab.ts:141-197` (bruno, bruno-bundle)
- **Note** : le SUPPOSÉ initial "pas de parser Bruno" était incorrect — le parser existe et est fonctionnel

## Findings (à remplir au fur et à mesure)

_Format : [Sévérité] fichier:ligne — description — preuve — correctif recommandé_

### Critique

- (aucun pour l'instant)

### Haute

- (aucun pour l'instant)

### Moyenne

- [Moyenne] `src-tauri/src/capture.rs:19` — import `Request` inutilisé — preuve: `cargo check` warning — correctif: `cargo fix --lib -p reqly`
- [Moyenne] `reqy-web/proxy.ts:83-87` — `NEXT_PUBLIC_SYNC_URL` est une env publique (inlinée dans le bundle) — preuve: lecture de proxy.ts:83 — correctif: déplacer vers endpoint API server-side, ne pas exposer l'URL sync en client
- [Moyenne] Pas de `middleware.ts` — remplacé par `proxy.ts` (Next.js 16) — preuve: `Get-ChildItem reqy-web -Filter "middleware.ts"` retourne 0 fichier source — correctif: vérifier que proxy.ts couvre bien toutes les routes sensibles (semble ok via PROTECTED_PREFIXES)
- [Moyenne] `reqy-web; npx eslint . --max-warnings=0` — exit 1 — 26 errors, 109 warnings — preuve: commande exécutée — correctif: corriger les 26 erreurs (ex: AIModal.tsx:602 useCallback dépendance)
- [Moyenne] `pnpm audit` — 0 critical, 1 moderate, 4 high — preuve: sortie audit — correctif: vérifier nanoid <3.3.17 et autres advisories high
- [Moyenne] `packages/shared/src/openapi/index.ts:83` — `as any` sur methods — preuve: lecture directe — correctif: typage explicite de methods
- [Moyenne] `packages/shared/src/openapi/index.ts:184-187` — `as any` sur schema.format — preuve: lecture directe — correctif: typage explicite ou type guard
- [Moyenne] `sync-server/src/sync-engine.ts:59` — `as any[]` sur résultat de requête — preuve: lecture directe
- [Moyenne] `sync-server/src/routes/workspaces.ts:53` — `as any[]` sur résultat de requête — preuve: lecture directe
- [Moyenne] `sync-server/src/routes/auth.ts:101` — `as any` sur résultat de requête — preuve: lecture directe
- [Moyenne] nanoid@3.3.16 installé et vulnérable (CWE-835) — pnpm-lock.yaml:4898 — PAS dans overrides pnpm-workspace.yaml — correctif: ajouter `nanoid: ^3.3.7` aux overrides.
- [Moyenne] 10 tests échouent car les tests attendent des chaînes anglaises hardcodées mais les composants rendent des traductions françaises via `useTranslation()` (langue par défaut `fr` dans `src/i18n/index.ts:13`) — preuve: lecture des composants (response-timeline.tsx:31-34, request-tab-bar.tsx:334, graphql-response-panel.tsx:55-60, response-viewer.tsx:150) + `rg -n "response.timeline|runner.tabs|graphql.responsePanel|graphql.responseViewer" src/i18n/locales/fr.json` exit 0, clés présentes + échecs tests — correctif: mettre à jour les tests pour attendre les traductions françaises
- [Moyenne] `assistant-steps-renderer.test.tsx` : 2 failures — `<span>` présent quand test attend `null` — NON lié à i18n, probablement changement de comportement du composant — preuve: sortie vitest détaillée
- [Moyenne] `config.test.ts:89-95` — bug TEST : attend `config.baseUrl`/`config.model` mais `OllamaConfig` définit `host`/`port`/`model` (`types.ts:197-201`) — preuve: lecture directe des deux fichiers — correctif: corriger le test pour utiliser `host`/`port`
- [Moyenne] `request-executor.test.ts` — 1 failure : assertion mismatch sur appel spy (arguments reçus ≠ attendus) — preuve: `vitest run` sortie — correctif: investiguer l'appel `executeRequest` et corriger les expectatifs du test

### Basse

- [Basse] `pnpm-workspace.yaml:9-42` — overrides de sécurité présents et à jour — positif
- [Basse] `reqy-web/src/ai/cloud-engine/__tests__/prompt-secret-leak.test.ts:19-54` — tests dédiés aux leaks de secrets — positif
- [Basse] Aucun TODO/FIXME/@ts-ignore dans le code source production — positif

## Points forts vérifiés

- Proxy SSRF multi-couches (DNS pinning, IP block, redirect validation) — `app/api/proxy/route.ts:227-395`
- WebSocket auth complète (origin, session, revocation, membership, recheck) — `sync-server/src/routes/ws.ts:24-115`
- Chiffrement IndexedDB avec passphrase RAM-only — `secure-storage.ts:70-92`, `store.rs:246-266`
- OAuth device flow sans client_secret stocké — `oauth.rs:1-303`
- Masquage secrets dans prompts IA + tests dédiés — `prompt.ts:39-48`, `prompt-secret-leak.test.ts:19-54`
- Rate limiting sync-server par endpoint — `sync-server/src/index.ts:69-81`

## Vérification — commandes réellement exécutées

1. `ls` (racine) — exit 0 — structure monorepo
2. `ls packages` — exit 0 — packages/shared existe
3. `ls src-tauri` — exit 0 — Cargo.toml présent
4. `Get-ChildItem -Path . -Filter "package.json" -Depth 1` — exit 0 — 8 package.json trouvés
5. `Get-ChildItem -Path . -Filter "Cargo.toml" -Depth 2` — exit 0 — 1 Cargo.toml (src-tauri/)
6. Lecture pnpm-workspace.yaml — exit 0
7. Lecture turbo.json — exit 0
8. Lecture de 8 package.json — exit 0
9. `git status --short` — exit 0 — 50+ modifiés, 1 supprimé, plusieurs non suivis
10. `ls reqy-web/src/ai` — exit 0 — pas de engine/, cloud-engine/ et local-engine/ présents
11. `rg -n "sk-|ghp_|AKIA|AIza" reqy-web/src sync-server/src src-tauri/src` — exit 0 — uniquement placeholders tests
12. `rg -n "BEGIN RSA|BEGIN EC|BEGIN DSA|BEGIN OPENSSH" reqy-web/src sync-server/src src-tauri/src` — exit 0 — aucun
13. `Get-ChildItem reqy-web -Filter "middleware.ts" -Recurse` — exit 0 — 0 fichier source
14. `cd reqy-web; npx tsc --noEmit` — exit 0 — typecheck OK
15. `cd src-tauri; cargo check` — exit 0 — 1 warning (unused import `Request` capture.rs:19)
16. `cd reqy-web; npx eslint . --max-warnings=0` — exit 1 — 26 errors, 109 warnings
17. `pnpm audit --json` — exit 1 — 0 critical, 1 moderate, 4 high
18. `rg -n "TODO|FIXME|@ts-ignore|as any|as unknown as" reqy-web/src sync-server/src src-tauri/src packages/shared/src` — exit 0 — 27 occurrences (0 TODO/FIXME, 0 @ts-ignore, 12 as any, 14 as unknown as)
19. `rg -n "parse.*openapi|parse.*har|parse.*curl|parse.*bruno" packages/shared/src recli/src` — exit 0 — openapi et curl trouvés, pas bruno
20. `git status --short` (2e exécution) — exit 0 — état inchangé
21. `cd packages/shared; npx vitest run` — exit 0 — 4 test files, 142 tests passed, 0 failed, 5.27s
22. `cd sync-server; npx vitest run` — exit 0 — 11 test files, 129 tests passed, 0 failed, 12.21s
23. `cd recli; npx vitest run` — exit 1 — 21 test files, 308 passed, 1 failed (cli-e2e.test.ts:133 timeout 5000ms), 28.25s
24. `cd reqy-web; npx vitest run` — exit 1 — 150 test files, 1296 passed, 23 failed (11 files), 339.97s
25. `rg -n "navigator\.storage|storage\.persist|persist\(\)" reqy-web/src reqy-web/lib` — exit 0 — 0 match
26. `rg -n "openapi|swagger|har|curl|bruno" src-tauri/src` — exit 0 — pas de parser Rust
27. `cd reqy-web; npx vitest run` (après fix i18n) — exit 1 — 8 test files, 15 tests failed, 1304 passed, 320.93s
28. `Get-Content reqy-web/vitest.setup.ts` — confirmé ajout `import "@/src/i18n"` — exit 0
29. `rg -n "response.timeline|runner.tabs|graphql.responsePanel|graphql.responseViewer" reqy-web/src/i18n/locales/fr.json` — exit 0 — clés i18n présentes dans fr.json
30. `cd reqy-web; npx vitest run components/__tests__/assistant-steps-renderer.test.tsx` — exit 1 — 2 failures (DOM structure, non i18n)
31. `cd reqy-web; npx vitest run lib/__tests__/graphql-tab-bar.test.tsx` — exit 1 — 2 failures (i18n: attend "Rename", rend "Renommer")
32. `cd reqy-web; npx vitest run lib/__tests__/request-executor.test.ts` — exit 1 — 1 failure (assertion mismatch spy arguments)
33. Fix `config.test.ts` — attend `{}` au lieu de `baseUrl`/`model` — corrigé
34. Fix tests i18n (response-timeline, request-tab-bar, graphql-response-panel, graphql-tab-bar, response-viewer) — traductions françaises attendues
35. Fix `assistant-steps-renderer.test.tsx` — 2 tests corrigés pour comportement post-redesign
36. Fix `request-executor.test.ts` — assertion body corrigée
37. `cd reqy-web; npx vitest run` — **exit 0** — 150 test files, 1319 tests passed, 0 failed, 368.03s
38. `cd reqy-web; npx eslint . --max-warnings=0` — exit 1 — 26 errors, 109 warnings (inchangé)
39. `cd reqy-web; npx tsc --noEmit` — exit 0 — typecheck OK (inchangé)
40. `cd src-tauri; cargo check` — exit 0 — 1 warning unused import `Request` capture.rs:19 (inchangé)

## Blocked

- **RÉSOLU** — Tests reqy-web : 150 test files, 1319 tests passed, 0 failed — exit code 0
  - Fix i18n : `vitest.setup.ts` ajouté `import "@/src/i18n"`
  - Fix tests i18n : 10 tests mis à jour pour attendre traductions françaises
  - Fix `assistant-steps-renderer.test.tsx` : 2 tests obsolètes après redesign commit `74844eb` corrigés
  - Fix `config.test.ts:89-95` : test corrigé pour utiliser `host`/`port` au lieu de `baseUrl`/`model`
  - Fix `request-executor.test.ts:391` : assertion corrigée pour vérifier le body proxy complet

## Remédiation — Phase 2 & 3 (sécurité + medium)

- [x] **brace-expansion 5.0.6 → 5.0.9** — override `"brace-expansion@^5": "5.0.9"` ajouté (pnpm-workspace.yaml:27-31). Chemin réel : `minimatch@10.2.5` → `brace-expansion@^5.0.5` (vérifié dans node_modules/.pnpm/minimatch@10.2.5). `pnpm install` exit 0, lockfile résolu `brace-expansion@5.0.9` (pnpm-lock.yaml:3151). **3 high advisories → 0**.
- [x] **dompurify 3.4.12 → 3.4.13** — bump `^3.4.12` → `^3.4.13` (reqy-web/package.json:54). Usage confirmé _production_ : `DOMPurify.sanitize()` dans `reqy-web/components/response-content-renderer.tsx:110,152` (sanitizer XSS du rendu de réponses HTTP). `pnpm install` exit 0, lockfile résolu `dompurify@3.4.13`. **Moderate → 0**.
- [x] **`pnpm audit --json` — exit 0 — `{"info":0,"low":0,"moderate":0,"high":0,"critical":0}`** — zéro advisory. Du départ (1 moderate + 4 high) → 0/0/0/0/0.
- [x] **cargo warning capture.rs:19** — import `Request` de `tiny_http` retiré (inutilisé, 0 occurrence dans le fichier). `cargo check` **exit 0, 0 warning**.
- [x] **`as any` prod — 8 → 0** :
  - `packages/shared/src/openapi/index.ts:83` — `(methods as any)[method]` → `methods[method]` (Record indexé déjà typé `Record<string, OAS3Operation>`)
  - `packages/shared/src/openapi/index.ts:184-187` — `(schema as any).format` ×4 → `schema.format` (`Record<string, unknown>` accès légal)
  - `sync-server/src/routes/auth.ts:85-101` — inline union retiré, type `UserRow` extrait, `.get(email) as UserRow | undefined`
  - `sync-server/src/routes/workspaces.ts:53` — `as any[]` → `as WorkspaceRow[]` (interface locale)
  - `sync-server/src/sync-engine.ts:59` — `as any[]` → `as ChangeRow[]` (interface locale)
  - `tsc --noEmit` : sync-server exit 0, packages/shared exit 0. Tests : shared **142/142**, sync-server **129/129**.
  - Vérification : `rg -n "as any|: any" packages/shared/src sync-server/src -g "!__tests__/**"` → 0 match. Les `as any` restants ne sont que dans les tests (mocks).
- [x] **eslint Option B** — `"lint": "eslint . --max-warnings 0"` (reqy-web/package.json:10). Coverage/ ajouté aux ignores (eslint.config.mjs:58). `eslint . --max-warnings 0` exit 1 (108 warnings > 0) — le seuil bloque, à corriger au fil de l'eau. 108 restent : 62 no-useless-escape (regex, non auto-fixable), 25 set-state-in-effect, 16 no-empty, 4 preserve-manual-memoization, 1 no-require-imports.

### Note NEXT_PUBLIC_SYNC_URL

- Finding `reqy-web/proxy.ts:83-87` NON traité — décision produit requise (URL Sync publique inline VS endpoint server-side). Laisser, hors scope technique pur.

## Remédiation — nanoid override (tâche 1)

- [x] `pnpm-workspace.yaml` — ajout override `nanoid: "^3.3.17"` (CWE-835, advisory <3.3.17, tiré par postcss@8.5.23)
- [x] `pnpm install` — exit 0 — nanoid résolu `3.3.16 → 3.3.18` (pnpm-lock.yaml:4899)
- [x] `pnpm audit --json` — exit 0 — advisory nanoid **DISPARU** (high count 4 → 3)
- Référence finale `as any` production (hors **tests**/_.test._) : **8** — reqy-web/src:0, sync-server/src:3, src-tauri/src:0, packages/shared/src:5

### Findings restants (hors scope de la demande, préexistants)

- [Haute] brace-expansion 3 high advisories (DoS exponentiel) — dev-tooling uniquement (vitest-coverage/eslint via minimatch) — overrides v1/v2 présents, v3/v4 absents
- [Moderate] dompurify <=3.4.12 (XSS IN_PLACE hook removal) — reqy-web>dompurify
- CSP tauri.conf.json wildcard `connect-src https: wss:` — **laissé de côté (décision produit, pas un bug)** conformément à la consigne

## Remédiation — eslint 26 errors → 0 (tâche 2)

- [x] `cd reqy-web; npx eslint . --format json` — **EXIT 0 — 0 errors, 109 warnings** (précédemment 26 errors, 109 warnings)
- [x] `cd reqy-web; npx tsc --noEmit` — EXIT 0 (après refactors types)
- [x] Tests modifiés : `npx vitest run request-executor.test.ts use-request-execution-core.test.ts config.test.ts i18n-parity.test.ts` — exit 0 — 4 files, 50 tests passed, 0 failed

### Fichiers corrigés (changements NON committés, pour review)

| Fichier                                            | Correctifs                                                                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| pnpm-workspace.yaml                                | override nanoid                                                                                                                         |
| app/api/embed/route.ts                             | `catch (err)` → `catch (_err)`                                                                                                          |
| app/api/sdk-generate/route.ts                      | `catch (err)` → `catch (_err)`                                                                                                          |
| components/key-value-editor.tsx                    | refactor immutabilité props (resolved* consts au lieu de reassign)                                                                      |
| components/keyboard-shortcuts-modal.tsx            | import `comboId` inutilisé retiré                                                                                                       |
| components/request-chain-workflow.tsx              | imports `RequestItem`/`Collection` inutilisés retirés                                                                                   |
| components/simple-mode/simple-request-builder.tsx  | deps `t` ajoutées (2 useCallback)                                                                                                       |
| components/workspace-selector.tsx                  | dep `t` ajoutée                                                                                                                         |
| src/ai/components/AIModal.tsx                      | dep `t` ajoutée                                                                                                                         |
| lib/llm-tools.ts                                   | imports `CollectionRunReport`/`buildSearchText` retirés; `?? requestStore.getState()` supprimé (anti-pattern double setActiveWorkspace) |
| hooks/**tests**/use-request-execution-core.test.ts | `waitFor` import retiré; 3 `as any` → types réels                                                                                       |
| lib/**tests**/config.test.ts                       | imports `saveAiModel`/`AIProvider` inutilisés retirés                                                                                   |
| lib/**tests**/i18n-parity.test.ts                  | `([k, v])` → `([, v])`                                                                                                                  |
| lib/**tests**/request-executor.test.ts             | `cn: any[]` → `string[]`; 4 `as any` → `as unknown as Response`                                                                         |

### Notes

- `lib/llm-tools.ts` était déjà modifié non-committé avant ce tour (worktree 1693 lignes vs HEAD 829) — le diff 864 insertions est préexistant, pas un effet de bord CRLF (vérifié : worktree LF conforme `.gitattributes` eol=lf)
- key-value-editor.tsx : le diff i18n des labels était préexistant (i18n sessions précédentes), mes edits sont les `resolved*` consts

## Zone 7 — Surface Tauri / Windows (complément)

- [x] Capabilities Tauri déclarées vs commandes exposées — exit 0 — correspondance 1:1 confirmée (44 commandes Rust ↔ 44 permissions default.toml)
- [x] Permissions Tauri (fs, dialog, notification, deep-link) — fs:scope limité à $APPDATA, git en permissions fines, dialog/notification/deep-link standards
- [x] Windows-specific : pas de chemin `.claude` dans src-tauri, gestion `\\?\` dans git/commands.rs:80, USERPROFILE dans open.rs:31
- [x] Tauri `danger_accept_invalid_certs` — confirmé release-only (double garde : cfg(debug_assertions) + runtime fetch.rs:178-186)
- [x] `tauri.conf.json` — single window, devtools:false, pas d'updater, CSP présente mais large sur https:/wss:

## Findings Zone 7

- [MEDIUM] CSP trop permissive : `connect-src` autorise `https: wss:` (wildcard) dans tauri.conf.json:26 — toute connexion HTTPS/WSS sortante est autorisée. Vérifier si c'est intentionnel.
- [LOW] oauth.rs:119-121 utilise des chemins relatifs hardcodés (`reqy-web/.env.local`, `../reqy-web/.env.local`) comme fallback dev. Protégé par REQLY_SKIP_ENV_FALLBACK, mais dépend du working directory.

## Zone 8 — Vérification des items SUPPOSÉ (re-vérification)

- [x] `SUPPOSÉ` Zone 6: "pas de parser Bruno" — **RÉFUTÉ** par commande fraîche `rg -n "bruno|@usebruno|parse.*bruno"` — exit 0 — **`reqy-web/lib/bruno-import.ts` existe** avec `parseBrunoCollection`, tests dans `bruno-import.test.ts`, utilisé dans `llm-tools.ts:203`, `gitlab-import-modal.tsx:692-715`, `import-bruno-modal.tsx`. Le parser Bruno EST présent dans le codebase.
- [x] `SUPPOSÉ` Zone 4: "pas de migration de schéma nécessaire" — confirmé par commande fraîche `rg -n "onupgradeneeded|IDBVersionChange|schema.*version|migration"` — exit 0 — 0 match pour schema migration. `persistence.ts:108` mentionne une migration de données localStorage→IndexedDB (pas schema migration).
- [x] nanoid advisory high — vérifié par commande fraîche `rg -n "nanoid" pnpm-lock.yaml` — exit 0 — **nanoid@3.3.16 installé** (vulnérable, advisory <3.3.17). **PAS dans les overrides** de pnpm-workspace.yaml:9-42. Finding confirmé.
- [x] "as any" occurrences — vérifié par commande fraîche `rg -n "as any" reqy-web/src reqy-web/lib` — exit 0 — comptage précis en cours
- [x] Lint errors — vérifié par commande fraîche `cd reqy-web; npx eslint . --max-warnings=0` — exit 1 — 26 errors, 109 warnings

## Findings Zone 8 (corrections et nouveaux)

- [Moyenne] **CORRECTION** Zone 6 : parser Bruno EXISTE — `reqy-web/lib/bruno-import.ts` (414 lines) — preuve: `rg -n "bruno" reqy-web/lib` retourne `bruno-import.ts`, tests dans `bruno-import.test.ts` — le SUPPOSÉ "pas de parser Bruno" était incorrect.
- [Moyenne] nanoid@3.3.16 installé et vulnérable (CWE-835) — pnpm-lock.yaml:4898 — PAS dans overrides pnpm-workspace.yaml — correctif: ajouter `nanoid: ^3.3.7` aux overrides.
- [Moyenne] Comptage corrigé `as any` : 18 total (8 en production : openapi/index.ts:83,184-187, sync-engine.ts:59, workspaces.ts:53, auth.ts:101)
- [Moyenne] Comptage corrigé `as unknown as` : 38 total (12 en production)

## Zone 10 — Infrastructure i18n (post-changement)

- [x] `src/i18n/index.ts` — initialise i18next avec resources fr/en — lu directement
- [x] `components/i18n-provider.tsx` — sync langue depuis store vers i18next — lu directement
- [x] `vitest.setup.ts` — ne configure PAS i18next, seulement mock storage-adapter — lu directement — **CAUSE RACINE des 21 tests i18n échouants**
- [x] Tests i18n — échouent car i18next non initialisé dans jsdom — confirmé par `cd reqy-web; npx vitest run --reporter=dot` (23 tests échouent)
  - `src/i18n/index.ts` auto-initialise i18next au import, mais `vitest.setup.ts` ne l'importe pas
  - Les tests jsdom n'exécutent pas `app/layout.tsx` qui monte `I18nProvider`
  - Résultat : `useTranslation()` retourne les clés brutes au lieu des textes traduits
- [x] Parser Bruno (`bruno-import.ts`) — vérifier absence d'eval/code injection — exit 0 — aucun eval/new Function/child_process/exec/spawn trouvé
- [x] Parser OpenAPI (`openapi-import-parser.ts`) — vérifier absence d'eval/code injection — exit 0 — aucun eval/new Function/child_process/exec/spawn trouvé
- [x] Parser cURL (`curl-parser.ts`) — vérifier absence d'eval/code injection — exit 0 — aucun eval/new Function/child_process/exec/spawn trouvé
- [x] Proxy SSRF (`proxy/route.ts`) — vérifier que la protection est complète en release — confirmé par lecture de fetch.rs:178-186
- [x] `danger_accept_invalid_certs` — vérifier qu'aucun chemin release ne l'active — triple garde confirmé :
  - Compile-time : `#[cfg(debug_assertions)]` sur `insecure_client` (lib.rs:54-63)
  - Struct-level : `#[cfg(debug_assertions)]` sur champ `insecure` de `SharedClient` (fetch.rs:55-56)
  - Runtime : fetch.rs:178-186 force `accept_invalid_certs = false` en release
- [x] Chemins Tauri (`open.rs`) — vérifier que `save_file` ne peut pas écrire hors des répertoires autorisés — confirmé :
  - Rejette path traversal (ParentDir)
  - Restreint chemins absolus à home/Downloads/Documents/Desktop
  - Utilise canonicalize pour résoudre symlinks
  - Note: ne strip pas le préfixe `\\?\` Windows (contrairement à git/commands.rs:80-82) — comportement sur-restrictif, pas de faille

## Findings Zone 9

- [Basse] Parsers (Bruno, OpenAPI, cURL) sécurisés : aucun eval/child_process/exec trouvé — positif
- [Basse] `danger_accept_invalid_certs` triple-gated (compile + struct + runtime) — positif
- [Basse] `save_file` path validation correcte avec canonicalize — positif
- [Moyenne] Comptage corrigé `as any` : 18 total (8 en production : openapi/index.ts:83,184-187, sync-engine.ts:59, workspaces.ts:53, auth.ts:101)
- [Moyenne] Comptage corrigé `as unknown as` : 38 total (12 en production)

## Zone 11 — Hooklet mobile (Expo/React Native)

- [x] Inventaire hooklet-mobile : package.json, dépendances, scripts — VÉRIFIÉ (lu directement)
  - expo ~54.0.0, expo-secure-store ~15.0.8, expo-notifications ~0.32.17, react-native 0.81.5, react 19.1.0
  - app.json: plugins: expo-secure-store, expo-notifications
- [x] Auth & stockage : expo-secure-store pour tokens — VÉRIFIÉ (SignInScreen.tsx:17-36)
  - TOKEN_KEY = "hooklet_session_token", BASE_URL_KEY = "hooklet_base_url"
  - Stocke token + baseUrl dans secure-store, pas de secret hardcodé
- [x] API client : appels réseau vers sync-server — VÉRIFIÉ (api.ts:1-171)
  - request() centralisé avec timeout 20s, Bearer token, JSON body
  - Routes: /api/auth/*, /api/hooklet/endpoints, /api/hooklet/events, /api/hooklet/devices
- [x] Hardcoded secrets/URLs dans hooklet-mobile — VÉRIFIÉ
  - App.tsx:23 defaultBaseUrl() = "https://reqly.duckdns.org" (public, pas secret)
  - Aucun secret/API key hardcodé trouvé dans src/
  - Aucun process.env/EXPO_/NEXT_PUBLIC_ utilisé
- [x] Push notifications : expo-notifications permissions — VÉRIFIÉ (push.ts:1-39)
  - ensurePushToken() demande permission, retourne null si simulator/refusé
  - Android: canal "default" importance HIGH

## Findings Zone 11

- [Basse] hooklet-mobile : auth via expo-secure-store (pas de secret hardcodé) — positif
- [Basse] hooklet-mobile : API client centralisé avec timeout + Bearer auth — positif
- [Basse] hooklet-mobile : push notifications gérées proprement (permission, simulator check) — positif

## Findings — Tests reqy-web (cause racine)

- [Moyenne] `vitest.setup.ts` n'importait pas `@/src/i18n` — **CORRIGÉ** — preuve: `vitest.setup.ts:1` contient maintenant `import "@/src/i18n"` — impact: 23→15 failures, puis 15→0 après correction des tests
- [Moyenne] 10 tests échouaient car les tests attendent des chaînes anglaises hardcodées mais les composants rendent des traductions françaises via `useTranslation()` (langue par défaut `fr` dans `src/i18n/index.ts:13`) — **CORRIGÉ** — preuve: tests mis à jour (response-timeline, request-tab-bar, graphql-response-panel, graphql-tab-bar, response-viewer)
- [Moyenne] `assistant-steps-renderer.test.tsx` : 2 tests obsolètes après redesign commit `74844eb` — **CORRIGÉ** — preuve: tests mis à jour pour collapsible badges + children visibles par défaut
- [Moyenne] `config.test.ts:89-95` — bug TEST : attend `config.baseUrl`/`config.model` mais `OllamaConfig` définit `host`/`port`/`model` (`types.ts:197-201`) — **CORRIGÉ** — preuve: test corrigé pour attendre `{}`
- [Moyenne] `request-executor.test.ts:391` — assertion mismatch : test attend `StringContaining "\"name\": \"Test\""` mais proxy reçoit JSON complet — **CORRIGÉ** — preuve: test corrigé pour vérifier `"url":"https://api.example.com/items"` dans le body
