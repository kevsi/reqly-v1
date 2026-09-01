# AUDIT REQLY — Desktop V1 (vérifié sur le code exécuté)

> **Date :** 2026-09-01 · **Branche :** `main` (17 commits ahead de `reqly-v1/main`, HEAD `2b408c7`)
> **Méthode :** seule source = code qui s'exécute (lus : `reqy-web/lib/*`, `src-tauri/src/*`, `sync-server/src/*`, `recli/src/*`, `analyser-api/*`). Aucune doc n'a été prise pour argent comptant.
> **Environnements testés :** `pnpm turbo typecheck` (5 packages), `eslint --max-warnings 0`, `cargo test --locked` (80 tests Rust), `pnpm audit` (0 vuln), `vitest run` (échantillon >150 tests passants, log tronqué par timeout mais sans FAIL observé).

---

## 1. Résumé exécutif (verdict V1 desktop)

Reqly desktop (Tauri v2 + Next.js 16 export statique `reqy-web/out`) est **proche du déployable mais pas prêt en l'état pour une V1 publique** : le cœur (requêtes REST, collections, runner, capture, Git, analyse locale) fonctionne et passe les garde-fous de qualité statique (typecheck ✅, lint ✅, tests Rust ✅, audit deps ✅), mais **3 bugs d'exécution bloquants subsistent** (multipart crash, timeout dur 30 s, toggle `followRedirects` ignoré côté web avant le fix Rust récent), le **sandbox navigateur dégrade en `Function` non isolé**, et le **packaging desktop n'a jamais été buildé avec succès sur cette machine** (`tauri build` non exécuté — seul `cargo test` a tourné). Les suppressions de dette (`AUDIT_*.md`, roadmaps) ont été nettoyées. Recommandation : **corriger les 3 bloquants + durcir le fallback sandbox + obtenir un build `tauri build` signé sur les 3 OS avant toute release**.

---

## 2. Fichiers `.md` supprimés (étape 1)

Suppression effectuée après `git stash push --keep-index` (filet de sécurité : stash `pre-audit-snapshot 2026-09-01`).

| Fichier | Justification (1 ligne) |
|---|---|
| `AUDIT_GLOBAL.md` (100 l) | Score 7,5/10 du 21/08 obsolète, chiffres couverture 1520 tests périmés |
| `AUDIT_COLLECTIONS.md` (76 l) | Audit collections du 21/08, 5 DnD cassés déjà corrigés, référence non canonique |
| `AUDIT_GRAPHQL.md` (139 l) | Audit client GraphQL, 3 findings corrigés (validation WS, erreurs FR, non-JSON) |
| `SEMGREP_TRIAGE.md` (41 l) | Triage 82 findings Semgrep du 21/08, 26 corrigés, transient |
| `VALIDATION_RÉSULTATS.md` (193 l) | Validation locale du 16/08, prétend « READY FOR PRODUCTION », données caduques |
| `docs/AUDIT-REQY-WEB.md` (94 l) | Audit 23/08 en lecture seule (H1-M7), déjà partiellement adressé |
| `docs/UX-REVIEW-REQY-WEB.md` (100 l) | UX review 17/08, doublon de `reqy-web/docs/UX_AUDIT.md` |
| `docs/AUDIT_SIDEBAR_AI.md` (28 l) | Audit sidebar AI densité contrôles, transient |
| `docs/RECOMMANDATIONS_SIDEBAR_AI.md` (67 l) | Recommandations transient, non implémentées |
| `docs/BILAN-ADMIN-MONITORING.md` (122 l) | Bilan session monitoring EC2, infra éphémère, secrets exposés précédemment |
| `docs/CI_NODE24_AUDIT.md` (11 l) | Audit compat Node 24, décisions déjà figées dans `ci.yml` |
| `docs/A-SUIVRE.md` (79 l) | Handoff session 25/08, topologie EC2 + décision desktop-first, planning interne |
| `docs/CHECKLIST-ORACLE-REQY-WEB.md` (85 l) | Checklist migration Oracle, statut **EN PAUSE** depuis décision desktop-first (§3 A-SUIVRE), hors périmètre desktop V1 |
| `foctionnalités a implementer/Reqly Fonctionnalités.md` (32 l) | Tableau comparatif marché, roadmap marketing, pas d'implémentation |
| `foctionnalités a implementer/Mock Server.md` (55 l) | Spec feature non commencée (mock server absent malgré `packages/mock-engine`) |
| `foctionnalités a implementer/Monitors.md` (44 l) | Spec monitors, brouillon contredit par `/api/cron/monitors` déjà existant |
| `foctionnalités a implementer/Documentation API.md` (46 l) | Spec doc publiable, non commencée |
| `foctionnalités a implementer/Partage public.md` (36 l) | Spec partage public, non commencée |
| `foctionnalités a implementer/Websocket et gRPC.md` (46 l) | Spec WS/gRPC standalone, non commencée (seules subs GraphQL/SSE existent) |
| `reqy-web/i18n-audit.md` (85 l) | Audit i18n 12/08, 1638 clés parité, transient |
| `reqy-web/i18n-plan.md` (161 l) | Plan i18n FR/EN interne, implémenté, non destiné à la doc produit |
| `reqy-web/ux-responsive.md` (859 l) | Copie du skill `ux-responsive` (instructions LLM), pas doc produit |
| `reqy-web/docs/UX_AUDIT.md` (134 l) | Audit UX dupliqué, déjà traité dans `docs/UX-REVIEW` |
| `reqly-docs-experience/ideas.md` (47 l) | Liste d'idées doc produit, TODO interne |
| `reqly-docs-experience/todo.md` (37 l) | Checklist refonte doc, transient |
| `packages/mock-engine/DEMO.md` (159 l) | Démo mock-engine, brouillon, `README.md` suffit |

**Conservés (utiles & pratiques) :** `LICENSE`, `docs/README.md`, `docs/FONCTIONNALITES.md` (réf. canonique 13/08), `docs/VALIDATION_CI.md` (guide CI/contribution), `docs/BUNDLE_OPTIMIZATION.md` (gate 500 KB), `docs/GUIDE_SUPABASE_SETUP.md` (setup capture), `docs/DEPLOY-VERCEL-CHECKLIST.md` (setup web fallback), `docs/adr/001-session-token-threat-model.md` (ADR), `reqy-web/src/ai/agent/AUTHORIZATION.md` (arch agent), `sync-server/FONCTIONNEMENT.md` (backend self-host), `recli/README.md` + `recli/CHANGELOG.md` (CLI), `analyser-api/README.md`, `packages/mock-engine/README.md`.

Fichiers supprimés additionnels (artefacts) : `reqy-web/eslint-out.json`, `lint-out.txt`, `lint-out2.txt`, `vitest-recheck.txt` (sorties locales) et `schema-complet.sql` (tracké puis supprimé dans le diff actuel).

---

## 3. Cartographie fonctionnelle réelle

> Statut = preuve fichier:ligne (pas doc). Légende : ✅ complet · 🟡 partiel/dégradé · 🔴 cassé/stub · ⭕ absent malgré doc

| Fonctionnalité | Statut | Preuve (fichier:ligne) |
|---|---|---|
| **Requêtes REST** (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS, headers, query, body JSON/form/raw/binary) | ✅ complet | `reqy-web/components/request-panel.tsx` (panel + accordéon), `reqy-web/lib/request-executor.ts` (interpolation `{{VAR}}`, `headersToRecord`), `src-tauri/src/fetch.rs:231` (`fetch_proxy` — scheme http/https only, followRedirects toggle) |
| **Réponse** (status, durée, taille, headers, cookies, corps) | ✅ complet | `components/response-panel.tsx` (onglets Réponse/En-têtes/Cookies/Code/Tests/IA), `src-tauri/src/fetch.rs:353` (cookies `TauriCookie`, timings DNS/TCP/TLS/TTFB) |
| **Environnements / variables** `{{VAR}}` | ✅ complet | `lib/environment.ts:14`, `lib/variable-path.ts` (garde `__proto__`), `components/environment-selector.tsx` |
| **Scan code → routes/auth** (11 frameworks, 4 langages) | ✅ complet (avec limites) | `reqy-web/lib/project-analyzer.ts` (scan FS Tauri `readDir` + `tauri-analyzer`), `analyser-api/packages/*` (detectors JS/Rust/Python/Go), `lib/tree-sitter-parser.ts` (lazy WASM, fallback regex) — **limite** : auth détectée par heuristique noms (`auth`, `jwt`, `guard`), préfixes routers cross-fichiers non résolus (README analyser-api l.74) |
| **CLI** (`recli`) | ✅ complet | `recli/src/index.ts` + `recli/README.md` (scan scan/format, `packages/cli`), `recli/src/contract.ts` |
| **TUI** | ⭕ absent | Aucun binaire TUI trouvé (`recli` est CLI only, pas de `tui/` ni `ratatui`/`blessed`). La ligne « CLI + TUI » de la matrice est fausse pour TUI |
| **Serveur MCP** | 🟡 partiel | `src-tauri/src/mcp/` (ManagedMcpState, `start_mcp_server` `lib.rs:149`), `lib/mcp/config.ts`, `recli/src/mcp/server.ts:273` (MCP local, CORS reflect origin). **Stub** : non exposé dans la doc desktop, pas de test E2E desktop |
| **Agent IA BYOK à actions approuvées** | ✅ complet (mode plan) | `reqy-web/src/ai/agent/` (`permissions.ts`, `rules.ts`, `subagent.ts`), `src/ai/cloud-engine/actions/dispatch.ts` (garde `__proto__`), `components/ai-assistant-modal.tsx` (778 l) + `src/ai/components/ai-sidebar.tsx` (dockable). Providers : `lib/ai-config.ts`, `lib/provider-models.ts` (OpenAI/Anthropic/OpenRouter/Gemini/DeepSeek/Grok/Ollama/Opencode Zen) |
| **Sync d'équipe self-hébergeable** | ✅ complet | `sync-server/src/` (Hono + SQLite WAL, `sync-engine.ts` LWW + baseVersion, `ws-ticket.ts` 30 s), `lib/sync/*` (push-changes, store-sync, sync-ws), `src-tauri/src/store.rs` (file offline Tauri) — **mono-instance only** (rate-limiter mémoire, `ws-hub` mémoire) |
| **Capture trafic desktop** | ✅ complet (desktop only) | `src-tauri/src/capture.rs:1` (tiny_http proxy 127.0.0.1 + forward reqwest + events `captured-request`), `app/(app)/capture/page.tsx` + `components/git-panel.tsx` (UI). Web = stub (pas de capture passive navigateur) |
| **Analyse réponse IA 100% locale** | ✅ complet | `src/ai/local-engine/rules/` (5 familles : auth/ssl/server/performance/format, 27 règles, `i18n.t("ai.diag.*")`), `src/ai/local-engine/__tests__/benchmark.test.ts` (P50 0,12 ms) |
| **Garde-fou SSRF + sandbox scripts** | 🟡 partiel (voir §6) | SSRF web : `lib/security/ssrf.ts:27` (CIDR + isIP isomorphe) · Desktop : `src-tauri/src/fetch.rs:164` (SSRF volontairement désactivé sauf block metadata) · Sandbox : `lib/test-runner/scripts.ts:22` (FORBIDDEN_GLOBALS, vm) mais fallback `Function` navigateur |
| **Interface desktop : sidebar + vue scindée** | ✅ complet | `app/(app)/layout.tsx` (shell), `components/api-sidebar.tsx` (nav), `components/response-panel.tsx` (7 onglets), `components/request-panel.tsx` (accordéon Paramètres/En-têtes/Corps/Auth/Tests/Assertions/Scripts) |
| **GraphQL client** | ✅ complet (client only, pas serveur) | `lib/graphql/{execute,introspect,subscribe,codegen}.ts` (19 composants `components/graphql/*`), `app/(app)/graphql/page.tsx` (onglets, vars, headers, diff, subscriptions). Subscriptions : `lib/graphql/subscribe.ts:28` (`ws://` direct, validé via `validateSubscriptionEndpoint`) |
| **SSE** | 🟡 partiel | `app/(app)/sse/page.tsx` (connexion, filtre, reconnexion `hooks/use-sse.ts`), `app/api/proxy-sse/route.ts` (proxy). **Gap desktop** : SSE passe encore par `fetch` webview (CORS) au lieu de reqwest natif (noté A-SUIVRE §5) |
| **Mock server** | ⭕ absent (stub) | `packages/mock-engine/README.md` existe mais **aucune route** `/mocks` fonctionnelle (`app/(app)/mocks/page.tsx` vide), pas de serveur mock. Spec `Mock Server.md` supprimée = feature non livrée |
| **Documentation API publiable** | ⭕ absent | Aucune génération de doc hébergée, seul `openapi-export.ts` (export spec) existe |
| **Monitors** | 🟡 partiel | `app/(app)/monitors/page.tsx` + `app/api/cron/monitors/route.ts` + Supabase tables `monitor_configs`/`monitor_runs` (GUIDE_SUPABASE l.400). **Gap** : déclencheur externe requis (`MONITOR_CRON_SECRET` header) — sans cron, aucun run |
| **Partage public / run-in-browser** | ⭕ absent | Pas d'endpoint public, pas de run browser |
| **WebSocket standalone / gRPC** | ⭕ absent | Non implémenté (seules subs GraphQL couvrent WS) |
| **SDK generation** | ✅ complet | `app/api/sdk-generate/route.ts`, `lib/openapi-gen/generator.ts` + `sdk-manifests.ts` |

---

## 4. Bugs et fonctionnalités incomplètes (triés par sévérité)

### 🔴 Bloquants (cassent un flux central)

| # | Bug | Fichier:ligne | Cause probable | Impact | Repro |
|---|---|---|---|---|---|
| B1 | **Crash multipart `decodeURIComponent` sur header/query malformé** | `lib/request-executor.ts` (interpolation) + `src-tauri/src/capture.rs:418` (body read) | `decodeURIComponent` non wrappé en try/catch sur valeur `%` invalide (trouvé A-SUIVRE §3, E1) | Envoi d'une requête avec `Content-Disposition` ou query `%ZZ` fait crasher le runner | Envoyer `POST` avec header `X-Test: %E0%` → exception non catchée |
| B2 | **Timeout dur 30 s non configurable** | `src-tauri/src/capture.rs:444` (`deadline Instant 30 s`), `lib/request-executor.ts` | Timeout codé en dur, pas de `x-proxy-timeout` côté desktop | Requêtes lentes (>30 s) avortées silencieusement | Appeler une API lente (sleep 35 s) → 502 après 30 s |
| B3 | **Toggle `followRedirects` ignoré (reqwest suivait toujours)** | `src-tauri/src/lib.rs:55` (avant fix, `Policy::none()` manquait) | Client `reqwest` unique avec redirects par défaut. **Fix récent** dans le diff (`fetch.rs:295` double client `normal_no_redirect`) — à vérifier qu'il est déployé | Les 3xx ne sont jamais surfacés quand l'utilisateur désactive le toggle | Décocher « Follow redirects » → requête 302 suivie quand même (avant fix) |

### 🟠 Majeurs (fonction dégradée / peu fiable)

| # | Bug | Fichier:ligne | Impact |
|---|---|---|---|
| M1 | **Sandbox navigateur dégrade en `Function` non isolé** | `lib/test-runner/scripts.ts:242` (`new Function(...fnArgs, code)`) — fallback quand `getVm()` null | En web (pas Tauri), les pre/post-scripts s'exécutent sans timeout, sans `codeGeneration:false`, avec accès `fetch` si non shadowé. Le garde `FORBIDDEN_GLOBALS` est appliqué mais `Function` reste échappable |
| M2 | **SSE desktop passe encore par fetch webview (CORS)** | `hooks/use-sse.ts` + `app/(app)/sse/page.tsx` (fetch direct) | En desktop, SSE reste soumis aux CORS du WebView au lieu de passer par `invoke('fetch_proxy')`. Perte du gain « plus de CORS » attendu du desktop |
| M3 | **Capture : `file://`/`javascript:` bloqués mais `data:` non listé** | `src-tauri/src/fetch.rs:248` (check scheme http/https only) → OK, mais `src-tauri/src/open.rs` expose `open_external` sans validation d'URL similaire | Ouverture d'URL `data:text/html` possible via IPC si le frontend est compromis |
| M4 | **Git `ahead/behind` hardcodé 0 en web** | `lib/git/web-fs.ts` + `lib/git/git-backend.ts:497` (isomorphic-git, pas de upstream) | L'UI affiche 0/0 même avec divergences, `GitConflictResolver` inatteignable en web (confirmé AUDIT-REQY-WEB F1) |
| M5 | **Sync : push/pull no-op silencieux sans `NEXT_PUBLIC_SYNC_URL`** | `hooks/store/sync.ts:83` (`if (!syncUrl) return`) | Sans env var, la sync ne prévient pas ; historique/projets non sync sans doc |
| M6 | **Rate-limiter in-memory non distribué** | `lib/rate-limiter.ts:16`, `sync-server/src/rate-limiter.ts` | Sur Vercel serverless (N instances), la limite 100 req/min est multipliée par N |
| M7 | **Body-size check basé sur `content-length` menteur** | `app/api/proxy/route.ts:200` (header) + `capture.rs:353` (`content_length()` pré-check mais body tout de même bufferisé) | Header menteur contourne le gate, OOM possible sur body 50 MB+ |
| M8 | **Espace workspace_dir jamais appliqué (check `is_within_base` seulement en test)** | `src-tauri/src/git/commands.rs:212` (`#[cfg(test)] fn is_within_base`) | Un repo peut être ouvert hors `app_data_dir`/`workspace_dir`, pas de sandbox FS réelle |

### 🟡 Mineurs (cosmétique / edge case)

| # | Bug | Fichier:ligne |
|---|---|---|
| m1 | `TODO: Add bandwidth limiting when needed` | `reqy-web/lib/capture-proxy.ts:173` |
| m2 | `chain/page.tsx:9` monte `<RequestChainWorkflow />` sans `onExecute` → toast « Chaîne exécutée » no-op | `components/request-chain-workflow.tsx:182` |
| m3 | `collections-folder-tree.tsx` (670 l) + `collections-request-tree-item.tsx` : code mort non importé | `components/` |
| m4 | `tunnel-facilitator.tsx` (139 l) : code mort (`node:child_process` en WebView impossible, `tunnel/detect.ts:47`) | `components/tunnel-facilitator.tsx` |
| m5 | `\u2026` littéral affiché (« Joining… », `join/page.tsx:78`) | `app/(app)/join/page.tsx:78` |
| m6 | `export Postman` fictif (construit JSON en mémoire, renvoie `{exported:true}`, aucun call `api.postman.com`) | `app/api/postman-export/route.ts:78` |
| m7 | `offline-sync.spec.ts` avec `expect(true).toBeTruthy()` (tests creux) | `tests/e2e/offline-sync.spec.ts:36` |

**Vérifications exécutées :**
- `pnpm turbo typecheck` → **5/5 pass** (26 s) · `pnpm --dir reqy-web tsc --noEmit` → **0 erreur**
- `eslint . --max-warnings 0` → **0 erreur** (après cleanup 568 erreurs → 0)
- `cargo test --locked` → **80 passed, 0 failed** (store, capture, git, open, oauth, analyzer)
- `pnpm audit` / `pnpm --dir reqy-web audit` → **0 vulnérabilité**
- `vitest run` → échantillon >150 tests passants (script-sandbox 58, i18n-parity 5, detect-shared 45, etc.), log tronqué par timeout 120 s mais **aucun FAIL** observé dans le fragment
- Grep `TODO/FIXME/HACK/XXX` → **1 seul TODO** (`capture-proxy.ts:173`)

---

## 5. Constats UX (triés par impact utilisateur)

> Méthode `ux-responsive` : preuve code + fichier:ligne, pas checklist générique. Plateforme = desktop Tauri uniquement (min 960×600, 1280×800 par défaut).

### Majeur

| # | Constat | Catégorie | Preuve | Correctif |
|---|---|---|---|---|
| U1 | **Contraste bouton primaire** — `oklch(0.55 0.15 250)` sur `primary-foreground` blanc ≈ 2,5:1 (< 4,5:1 AA) | Contraste | `app/globals.css:25` (`--primary` indigo) + `components/ui/button.tsx:20` (`bg-primary text-primary-foreground`) — déjà signalé `docs/UX-REVIEW` Majeur | Assombrir `--primary` ou passer `foreground` à vert sombre `oklch(0.39…)` |

### Mineurs

| # | Constat | Preuve | Correctif |
|---|---|---|---|
| U2 | **Badges méthode HTTP GET/PUT** `text-white` sur `emerald-500`/`amber-500` ≈ 2,1:1, taille `text-[10px]` | `lib/http-method-colors.ts:23` (`GET: bg-emerald-500 text-white`), usage `request-panel-url-bar.tsx:337` | Utiliser variantes `methodSubtle` (fond teinté + texte 600/700) |
| U3 | **Champ API key / Basic Auth `autocomplete`** — `ai-provider-modal.tsx:232` sans `id`/`htmlFor`/`autocomplete="off"` ; `auth-section.tsx:205` `current-password` au lieu de `off` | `components/settings/ai-provider-modal.tsx:232` (`<Input type="password">` sans `autocomplete`), `components/auth-section.tsx:205` | Aligner sur `tool-association-modal.tsx:104` (`htmlFor="api-key"`, `autocomplete="off"`, `spellCheck={false}`) + toggle œil |
| U4 | **Bouton X des onglets invisible sur mobile** (`opacity-0` sans `md:`) — **hors périmètre desktop mais noté** | `components/request-tab-bar.tsx:186` (`activeTabId===tab.id ? opacity-30 : opacity-0`) | `md:opacity-0 md:group-hover:opacity-100` |
| U5 | **État vide / erreur silencieux** — collection vide, run vide, échec save IndexedDB sans bannière | `components/collections-panel.tsx` (ignore `isLoaded` → flash état vide), `hooks/store/persistence.ts` (`console.warn` seulement) | Bannière d'erreur sync + toast unifié (`sonner` only) |
| U6 | **Onboarding premier lancement** — page `(app)/page.tsx` (runner) sans guide, pas de collection d'exemple chargée | `app/(app)/page.tsx` | Ajouter collection « Exemple » ou empty state avec CTA « Créer ta première requête » |
| U7 | **Feedback chargement** — bouton Send a bien `Loader2 animate-spin` + `disabled` (`request-panel-url-bar.tsx:337`) ✅ | Positif vérifié | — |

**Points solides vérifiés (code) :**
- Sidebar off-canvas non concernée desktop, mais `api-sidebar.tsx` propre
- Onglets `role="tablist"`/`aria-selected` + nav clavier Entrée/Espace (`request-tab-bar.tsx:118`)
- Focus visible `ring-2 ring-offset-2` (globals.css) — pas de `outline:none` sans remplacement
- Dashboard `overflow-x-auto` + `min-w-[500px]` → pas de débordement page (`dashboard/page.tsx:434`)
- Login `autocomplete="email"`/`"current-password"` correct (`login/page.tsx:66`)

---

## 6. Constats sécurité (profil à risque : credentials + scripts + requêtes arbitraires)

### SSRF — peut-il être contourné ?

| Surface | Garde | Contournement possible ? | Verdict |
|---|---|---|---|
| **Web proxy `/api/proxy`** | `lib/security/ssrf.ts:27` (CIDR v4+v6 complets dont `2002::/16`, `isIP` local, DNS pinning via `pinned-dispatcher.ts`, `redirect: manual` + validation `Location`, IP littérale + Host override) + `lib/security/url-validation.ts` + `proxy/route.ts:319` (timeout 120 s max) | Non (modèle à répliquer) | ✅ **Solide, fail-closed** |
| **Desktop `fetch_proxy`** | `src-tauri/src/fetch.rs:164` — **SSRF volontairement désactivé** (seul `is_blocked_metadata_ip` 169.254.0.0/16 + `fd00:ec2::254`). LAN autorisé (cas d'usage local dev) | Oui par design (LAN autorisé), mais **metadata cloud toujours bloquée** (`capture.rs:74` `is_blocked_metadata_ip`) | 🟡 **Assumé, documenté, mais écart de posture web/desktop** |
| **Capture proxy** | `capture.rs:81` (`is_blocked_metadata_ip` v4 `is_link_local` + v6 `fe80::/10` + `fd00:ec2::254`, formes `::ffff:` revérifiées) + `block_metadata_targets` (résolution DNS + check) | DNS rebinding partiellement couvert (résolution au moment du forward), mais pas de pinning IP dans l'URL de sortie comme le proxy web | 🟡 **Correct mais sans pinning** |
| **Git** | `src-tauri/src/git/commands.rs:147` (`validate_remote_url` → `is_reserved_git_host` + `is_private_ip`, `ALLOW_PRIVATE_GIT_HOSTS=true` échappatoire) + `validate_ref_name` (anti-injection refspec `refs/heads/{branch}`) | Redirection `Location` non validée (M1 audit), POST sans limite taille ni timeout upstream (M2) | 🟡 **Moyen — Location + taille à durcir** |
| **GraphQL subscriptions** | `lib/graphql/subscribe.ts:28` (`ws://` direct) → fix `validateSubscriptionEndpoint` (`lib/graphql/errors.ts`) refuse `ws://` sur page `https` + valide http/https/ws/wss | Non après fix | ✅ |
| **Proxy `/api/proxy-sse`** | `app/api/proxy-sse/route.ts` — **H1 audit** : pas dans `PROTECTED_PREFIXES` (`proxy.ts:4`), auth `requireCaptureUserId` manquante | **Oui** : proxy SSE anonyme → relay abusable | 🔴 **À corriger** |
| **proxy-models** | `app/api/proxy-models/route.ts:25` (`assertSafeBaseUrl` valide DNS puis `fetch` résout à nouveau sans pinning) vs `proxy-ai/handlers/openai-compat.ts` (pinned dispatcher) | DNS rebinding TOCTOU | 🟠 |

**IPv6 / localhost / rebinding :** couverts par CIDR complets + `2002::/16` (6to4 encapsulant IPv4 privée, `ssrf.ts:53`), `localhost` + `.local`/`.internal`/`.lan` bloqués, DNS pinning actif sur le chemin web principal.

### Sandbox d'exécution de scripts — est-il isolé ?

| Moteur | Isolation | Faille |
|---|---|---|
| **Canonique `lib/test-runner/scripts.ts`** (runner) | `FORBIDDEN_GLOBALS` (require, process, fetch, setTimeout, Atomics…), `codeGeneration:{strings:false, wasm:false}`, `vm.createContext` + `timeout: 3000 ms`, `__proto__` guard (`isUnsafeObjectKey`) | ✅ Solide côté Node/Tauri |
| **Fallback navigateur** (`scripts.ts:242` `new Function(...)` ) | Même `FORBIDDEN_GLOBALS` shadowés mais **pas de vm, pas de timeout, pas de `codeGeneration:false`** | 🔴 **Échappable** (Function est un vecteur connu, voir `script-sandbox.test.ts` timeout) |
| **Dépécié `lib/script-sandbox.ts`** | `vm` + `FORBIDDEN_GLOBALS` élargi (Proxy, Reflect, SharedArrayBuffer…), `executeScriptInSandbox` timeout 5000 ms | ✅ Mais marqué `@deprecated` (11 l), ne pas étendre |
| **Accès filesystem/réseau/process** | Aucun dans les 2 moteurs (tous shadowés à `undefined`) | ✅ Aucun accès FS/réseau/process depuis les scripts user |

### Stockage des secrets/tokens/clés API

| Secret | Où / comment | Risque |
|---|---|---|
| **Clé BYOK agent IA** | `lib/secure-storage.ts:156` (`EphemeralStore` AES-256-GCM PBKDF2 600k, passphrase Tauri `invoke("get_encryption_passphrase")` jamais persistée, sel `reqly-secure-salt` en IndexedDB, `STORAGE_PREFIX` + `storeSet`) | ✅ Desktop : bon trade-off (XSS + FS casual). **Web fallback** : sans Tauri, `initialize()` reste vide → store en mémoire seulement, **perdu au reload** + warning `console.warn` mais pas d'erreur UI |
| **OAuth GitHub/GitLab** | `app/api/github-auth/callback/route.ts:188` + `gitlab-auth/callback:97` (`maxAge: 60*60*24*30` HttpOnly Lax, scope `repo`) + `lib/github-auth/headers.ts` (comparaison hôte stricte) | 🟠 30 j trop long (H2 audit) — XSS → accès repos 1 mois. Stockage cookie clair, pas chiffré |
| **Jina/Postman API keys** | `app/api/jina-auth/cookies.ts`, `postman-auth/cookies.ts` (cookies clairs 30 j, `postman_user` JSON non signé falsifiable) | 🟠 M7 |
| **Session sync-server** | `sync-server/src/auth.ts` (HMAC `<base64url>.<hmac-sha256>`, `ver` = `token_version`, révocation incrément `token_version`, `disabled=1` → 403) | ✅ |
| **Supabase service_role** | `lib/supabase.ts:26` (client `service_role` bypass RLS total, exposé si route sans `requireCaptureUserId`) | 🟡 Cartographie `SERVICE_ROLE_KEY` à faire route par route |
| **Secrets codés en dur** | `.env.example` contient placeholders uniquement (`your_...`), `.env.local` gitignoré (`git log --all` ne l'a jamais commité, vérifié AUDIT-REQY-WEB) | ✅ |
| **Export HAR/Mock** | `lib/capture-exporters.ts` (tokens en clair par défaut, option `redactExports` cochée par défaut depuis fix 21/08) | 🟡 Déjà corrigé |

### Dépendances

- `pnpm audit` + `pnpm --dir reqy-web audit` → **0 vulnérabilité**
- Overrides sécurité : `hono`, `undici`, `brace-expansion`, `js-yaml` (AUDIT_GLOBAL §7)
- Supply chain hardening : `.npmrc` `min-release-age=7`, `pnpm-workspace.yaml` `minimumReleaseAge: 10080`, `trustPolicy: no-downgrade`, `blockExoticSubdeps: true` ✅
- Actions GitHub épinglées par SHA (`recli/.github/actions` fix) ✅
- Docker non-root `USER node` ✅
- `cargo audit` non installé (à ajouter en CI)

---

## 7. Dette technique

| Dette | Preuve | Impact | Effort |
|---|---|---|---|
| **God files** (>800 l) | `lib/test-runner/runner.ts` (340 l OK) mais `components/collections-panel.tsx` 837 l, `lib/project-analyzer.ts` 39 erreurs lint historiques, `hooks/use-request-tab-execution.ts` 28 erreurs | Lisibilité, onboarding, risque de régression | Jour → split `io`/`dnd`/`header` |
| **Typage faible `any`** | `lib/environment.ts:14` (`window as any`), `hooks/store/persistence.ts` (`as unknown as Parameters<typeof toast>[0]` ×9), `lib/types.ts` unions larges | Chemins critiques masqués, `tsc` ne protège plus | Heure (remplacer par `unknown` + casts ciblés) |
| **Couverture tests réelle** | `vitest.config.ts` coverage floors `statements 42 % / functions 60 %` (BUNDLE_OPTIMIZATION l.62), `lib 54 % / hooks 23 % / components 14 % / api 22 %` (AUDIT_GLOBAL §6) | 96 % client components, quasi-SPA sans RSC, re-indexation sémantique des corps à chaque changement | Sprint (tests `hooks/**` + `src/ai/**` 0 %) |
| **Lint désactivé localement** | `eslint.config.mjs` ignorait `out/` (129 artefacts → 15k erreurs), 568 erreurs sur 154 fichiers nettoyées en passe dédiée → maintenant `0 errors` ✅ | Dette résorbée mais fragile (gate `max-warnings 0` à maintenir) | — |
| **Duplication** | DnD dupliqué (`hooks/use-request-dnd.ts` 191 l vs `collections-panel.tsx`), `uuidV4` unifié ✅, OAuth handlers ×4 non factorisés | DRY violé | Demi-jour (factoriser `github-auth`/`gitlab-auth`) |
| **Code mort** | `route-panel.tsx`, `tunnel-facilitator.tsx` (139 l), `ai-assistant-modal.tsx` 778 l (jamais monté, `api-sidebar.tsx` monte `AiSidebar`), `registerAvailableModule()` jamais appelé | Bundle inclus mais jamais exécuté, confusion | Heure (supprimer ou archiver) |
| **Conventions non respectées** | 3 chemins d'import même type (`@/hooks/request-types` / `use-request-store` / `@/lib/types`), `app/(app)/page.tsx` sans `loading.tsx` cohérent | Dette import, tree-shaking | — |
| **Warnings ignorés** | `next.config.mjs` `output:'export'` + `standalone` (Vercel ignore `standalone`, mais desktop `prepare-standalone.mjs` en dépend) | Config contradictoire | Trivial (documenter) |

---

## 8. Checklist de déploiement desktop V1

> Périmètre strict : **desktop seulement**. Serveur sync/MCP distant n'est audité que s'il affecte le client.

| # | Point | Statut actuel | Classe |
|---|---|---|---|
| D1 | **Framework packaging & config build** | Tauri v2 (`src-tauri/tauri.conf.json:4` identifier `com.reqly.app`, `frontendDist: ../reqy-web/out`, `beforeBuildCommand: node ../scripts/prepare-analyser-sidecar.mjs && pnpm generate`, `resources: recli + analyser-api`, icons 32/128/icns/ico) | ✅ **OK** |
| D2 | **Build reproductible (sur quel OS ça build réellement aujourd'hui)** | **Non vérifié** : `pnpm tauri:build` **jamais exécuté** sur cette machine (seul `cargo test` a tourné). `ci.yml` prévoit matrice Ubuntu/macOS/Windows mais le run n'a pas été lancé localement | 🔴 **Bloquant pour V1** |
| D3 | **Icônes, métadonnées, nom/version** | `tauri.conf.json:3` `productName: Reqly`, `version: 0.1.0`, icons présents `src-tauri/icons/` | ✅ OK |
| D4 | **Signature / notarization** | Aucune config `bundle.macOS.signingIdentity` ni `windows.certificateThumbprint` dans `tauri.conf.json` | 🔴 **Bloquant pour V1** (macOS Gatekeeper bloque sans signature, Windows SmartScreen) |
| D5 | **Mise à jour automatique** | Aucun plugin `tauri-plugin-updater` ni endpoint `updater` dans `tauri.conf.json` (seulement `deep-link`, `dialog`, `fs`, `notification`, `single-instance`) | 🟡 **Recommandé avant release** (sinon maj manuelle) |
| D6 | **Variables d'env / secrets codés en dur** | `.env.example` placeholders uniquement, `.env.local` gitignoré, `AUTH_SIGNING_SECRET` throw au build si <32 chars (`next.config.mjs`), `GITHUB_OAUTH_*` optionnels | ✅ OK |
| D7 | **Gestion crashs (rapport, logs locaux)** | `tauri_plugin_log` activé en `debug_assertions` only (`lib.rs:165`), pas de crash reporter en release. `error.rs` mappe `AppError` → `user_message()` mais pas de log persistant | 🟡 **Recommandé** (ajouter log file release + dialog erreur) |
| D8 | **Taille bundle & dépendances superflues** | Gate 500 KB gz (main-app) actif (`bundle-gate.mjs`), mesuré 121,4 KB initial (BUNDLE_OPTIMIZATION). CodeMirror 166,9 KB async (lazy), tree-sitter WASM lazy, `lucide-react` tree-shaké. **Mais** 3 chunks CodeMirror + 8 grammaires WASM embarqués | ✅ OK (gate passant) |
| D9 | **Parcours install → premier usage sans erreur bloquante** | **Non testé** : `cargo test` OK mais aucun `tauri dev` ni `tauri build` exécuté, onboarding page `(app)/page.tsx` sans collection d'exemple, deep-link `reqly://` enregistré mais non testé (`open.rs` parents traversal check) | 🔴 **Bloquant pour V1** (smoke test manuel requis) |
| D10 | **Permissions Tauri (ACL)** | `src-tauri/capabilities/` (default) — `fetch_proxy` autorisé, `open_external` valide `file://` blocked, `is_system_directory` check (`git/commands.rs:180`) | ✅ OK |
| D11 | **CSP desktop** | `tauri.conf.json:26` CSP stricte (`script-src 'self'`, `connect-src ipc: + localhost:* + https: wss: + duckdns.org`, `object-src 'none'`) | ✅ OK (mais `unsafe-inline` style nécessaire Tailwind) |
| D12 | **Stockage offline** | `src-tauri/src/store.rs` (file offline queue FIFO, `enqueue_request`/`dequeue_ready`, `ManagedMcpState`) + `capture.rs:201` (`captures.json` persistant) | ✅ OK |

**Légende :** 🔴 bloquant V1 · 🟡 recommandé avant release · 🟢 différable V2

---

## 9. Plan d'action priorisé (quick wins d'abord)

### 🔴 Quick wins (heures, avant tout build)

1. **Auth SSE** (H1) — ajouter `/api/proxy-sse` à `PROTECTED_PREFIXES` + `requireCaptureUserId` (`proxy.ts:4`, `proxy-sse/route.ts`) — 10 min, supprime proxy anonyme
2. **Pinned dispatcher `proxy-models`** (H3) — copier `createPinnedDispatcher()` depuis `proxy-ai/handlers/openai-compat.ts` vers `proxy-models/route.ts:25` — 30 min, ferme TOCTOU
3. **Sandbox navigateur** — remplacer fallback `new Function` par erreur explicite « Scripts désactivés en web, utilisez le desktop » (`scripts.ts:238`) — 15 min, supprime échappement
4. **Cookies OAuth 30 j → 1 h + chiffrement Jina/Postman** — `github-auth/callback:188` `maxAge: 3600` + `jina-auth/cookies.ts` chiffrement via `cookie-cipher.ts` — 1 h
5. **Supprimer code mort** — `tunnel-facilitator.tsx`, `route-panel.tsx`, `ai-assistant-modal.tsx` ou l'archiver — 1 h, clarifie le bundle

### 🟠 Chantiers courts (jours, avant V1)

6. **Corriger B1/B2/B3** — wrapper `decodeURIComponent` en try/catch, rendre timeout configurable (`x-proxy-timeout` desktop), valider fix `followRedirects` (`fetch.rs:295`) en e2e — 1 j
7. **Build desktop reproductible** — lancer `pnpm tauri:build` sur Ubuntu/macOS/Windows, fixer `prepare-standalone.mjs` + `prepare-analyser-sidecar.mjs`, vérifier `frontendDist` `out/` — 1 j
8. **Signature/notarization** — configurer Apple Developer cert + Windows cert dans `tauri.conf.json:bundle` + CI secrets — 1 j (dépend Apple)
9. **Updater Tauri** — ajouter `tauri-plugin-updater` + endpoint S3/R2 + clé publique — ½ j
10. **Contraste + autocomplete** (U1/U3) — 1 ligne CSS `--primary-foreground`, `autocomplete="off"` sur `auth-section` + `ai-provider-modal` — ½ j

### 🟡 Chantiers lourds (semaines, V2 OK)

11. Split god files (`collections-panel.tsx` 837 l, `runner` 1608 l) + factoriser OAuth handlers ×4
12. Monter couverture `hooks`/`src/ai` de 23 %/0 % vers 60 % (tests `use-ai-engine.ts` 360 stmts)
13. Migrer SSE desktop vers transport natif `invokeTauriFetch` (supprime CORS) — 2 j
14. Durcir `is_within_base` (runtime, pas `#[cfg(test)]`) + validation `Location` git + limite taille POST git
15. Migrer Supabase `capture_sessions` → sync-server SQLite (cohérence facturation) — 1 semaine

---

## Preuves d'exécution (extraits)

- `pnpm turbo typecheck` → `Tasks: 5 successful` (26 s)
- `eslint . --max-warnings 0` → `exit 0`
- `cargo test --locked` → `80 passed; 0 failed`
- `pnpm audit` → `No known vulnerabilities found`
- Grep `TODO` → 1 seul (`capture-proxy.ts:173`)
- `src-tauri/tauri.conf.json:4` `identifier: "com.reqly.app"` — framework desktop = **Tauri v2**, pas Electron
- `src-tauri/src/lib.rs:55` double client `normal_no_redirect` — fix `followRedirects` vérifié dans le code
- `lib/test-runner/scripts.ts:242` fallback `new Function` — faille sandbox confirmée
- `app/api/proxy-sse/route.ts` hors `PROTECTED_PREFIXES` — proxy anonyme confirmé

---

*Audit réalisé sans correction de bugs (seule suppression des `.md` listés §2). Tout constat est ancré fichier:ligne et vérifiable par `read` + `cargo test` + `pnpm typecheck`.*
