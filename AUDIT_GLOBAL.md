# AUDIT GLOBAL — Projet reqy-web (reqly)

**Date :** 2026-08-21 · **Version :** 0.1.0 · Next.js 16 + React 19 + TypeScript + Zustand + Supabase + Tauri
**Méthode :** synthèse des audits de la session (sécurité, capture, collections, GraphQL, git, Semgrep) + vérification de l'état courant.

**État vérifié aujourd'hui :** lint ✅ 0 erreur · typecheck ✅ 0 erreur · tests web ✅ (1517) · sync-server ✅ (138) · Rust ✅ (69) · `npm audit` ✅ 0 vulnérabilité

---

## Score global : 7,5/10 — solide, production-ready avec dette technique maîtrisée

| Domaine | Note | Tendance |
|---|---|---|
| Sécurité | 8/10 | 🔼 en forte amélioration (26 findings Semgrep corrigés) |
| Fonctionnalité | 7/10 | 🔼 5 features cassées réparées (collections) |
| UX & i18n | 7/10 | 🔼 erreurs traduites, toasts, feedback |
| Qualité du code | 6/10 | — dette (god files, code mort) |
| Tests & CI | 8/10 | ✅ pipeline complet |
| Perf & dépendances | 7/10 | ✅ audit propre, gate bundle |

---

## 1. SÉCURITÉ — synthèse

### 1.1 Posture actuelle (corrigé durant la session)

| Domaine | Statut |
|---|---|
| **SSRF** (proxy, git proxy, proxy-ai, proxy-sse, capture) | ✅ CIDR privés complets (IPv4/IPv6, dont `2002::/16`), DNS pinning anti-rebinding, `redirect: "manual"` + validation Location, IP littérales + Host override |
| **RLS Supabase** (capture_sessions) | ✅ Politique `USING(true)` supprimée — ⚠️ **action manuelle en base restante** (SQL dans `AUDIT_CAPTURE.md`) |
| **Tokens OAuth** (GitHub/GitLab) | ✅ Comparaison d'hôte STRICTE (plus de `includes` → exfiltration fermée) ; injection auto dans le proxy git ; stockage AES-256-GCM |
| **WS sync** | ✅ Tickets éphémères 30 s à usage unique (fini le token dans `Sec-WebSocket-Protocol`) |
| **Persistance disque** | ✅ `sanitizeStore` aligné sur le sanitiser sync (headers + history + currentRequest) |
| **Prototype pollution** | ✅ Gardes `__proto__`/`constructor`/`prototype` sur 6 chemins (runner, script-executor, variable-path, dispatch, shared, recli) |
| **XSS** | ✅ Zéro `dangerouslySetInnerHTML` non sanitizé ; DOMPurify allowlist `<span class>` ; tout échappé React |
| **cURL export** | ✅ Échappement complet (`$`, backticks, `"`, `\`) — anti-injection shell |
| **Imports** | ✅ Limites 10 Mo (JSON/OpenAPI/Bruno) + validation Zod (Postman/LLM) |
| **Rust desktop** | ✅ IP privées bloquées sur toutes les commandes réseau git (échappatoire `ALLOW_PRIVATE_GIT_HOSTS`), redaction étendue, rotation captures (2000) |
| **Semgrep** | ✅ 26 findings corrigés (injection shell GitHub Actions, Docker non-root, supply-chain pnpm/npm…) — voir `SEMGREP_TRIAGE.md` |

### 1.2 Vulnérabilités connues restantes

| Sévérité | Finding | Fichier |
|---|---|---|
| ⚠️ ACTION | `DROP POLICY` RLS non appliqué sur la base existante | Supabase |
| MEDIUM | Proxy `/api/git/proxy` et capture : relais semi-ouvert (cookie visiteur) — limitation acceptée | `app/api/git/proxy` |
| MEDIUM | Stash web en clair dans `.git/reqly-stashes.json` ; exports HAR/Mock avec tokens en clair (option redaction ajoutée mais pas par défaut) | `lib/git`, `lib/capture-exporters` |
| LOW | `2002::/16` documenté ✅ ; refspec git non validés ; URLs brutes dans erreurs Rust | — |

## 2. ARCHITECTURE

- **Points forts** : séparation claire (`lib/` logique, `hooks/` état, `components/` UI, `src/ai/` IA) ; store Zustand unique avec persistence + sync engine (merge, conflits, WebSocket) ; protection SSRF centralisée (`lib/security/ssrf.ts`, désormais **isomorphe**) ; backends git/capture propres (Tauri Rust ↔ web isomorphic-git).
- **Points faibles** : **96 % de composants client** (quasi-SPA, pas de RSC) ; pas de code-splitting route-level ; `workspace_dir` jamais appliqué côté Rust (un repo peut être ouvert n'importe où hors répertoires système) ; 3 chemins d'import pour les mêmes types.

## 3. QUALITÉ DU CODE

| Problème | État |
|---|---|
| Lint (105 erreurs au début de session) | ✅ **0 erreur, 0 warning** |
| Typecheck | ✅ 0 erreur |
| `as any` / `@ts-ignore` | ✅ 0 `@ts-ignore` ; `any` résiduels typés |
| Fichiers > 800 lignes | ⚠️ 8 god-files (runner 1608 l., capture 1178 l., AI modal 974 l., collections-panel 837 l.…) — split à planifier |
| Code mort | ✅ 2 composants morts supprimés (collections) ; restent : `use-request-dnd.ts` (helpers utilisés), props mortes résiduelles |
| Duplication | ⚠️ DnD dupliqué, `uuidV4` unifié ✅, OAuth handlers ×4 non factorisés |
| Listes non keyées | ✅ remplacées par des clés stables |

## 4. FONCTIONNALITÉ — état par module

| Module | Verdict | Détail |
|---|---|---|
| **Git** | ✅ Complet | push/pull/fetch/clone/force-push avec feedback visuel, branches, stash (UI), conflits (résolveur câblé), diff 1/2/3 panneaux, auth auto OAuth |
| **Capture** | ✅ Complet | start/stop/clear, statut en temps réel, exports (HAR/OpenAPI/Mocks/tests), suppression par session, redaction export, i18n complet |
| **Collections** | ✅ Complet | CRUD + dossiers + réordonnancement (menus ↑↓), DnD intra/cross réparé, export/import avec dossiers, validation Zod |
| **GraphQL** | ✅ Complet (client) | subs validées (anti mixed-content), erreurs françaises, réponses non-JSON signalées |
| **Runner / AI / Sync** | ⚠️ À surveiller | god-files, erreurs de sync traduites ✅ |

## 5. UX & i18n

- ✅ Messages d'erreur français actionnables : git, capture, graphql, collections, proxy (fonctions `friendly*Error` unifiées)
- ✅ i18n FR/EN complet sur les pages auditées (capture, collections, git) ; test de parité + usage-integrity actif
- ⚠️ Reste : ~90 chaînes en dur hors pages auditées (runner, AI, settings) ; deux systèmes de toast (custom + sonner) ; flash de l'état vide pendant l'hydratation des collections

## 6. TESTS & CI

- **Web : 1517 tests** (146 suites) — dont i18n parity + usage integrity, SSRF, capture, git, graphql, test-runner
- **Sync-server : 138 tests** (dont 5 nouveaux ws-ticket) ; **Rust : 69 tests** (dont 8 validation IP privées)
- **Couverture** : lib 54 %, hooks 23 %, components 14 %, API 22 % (seuils CI ciblent lib uniquement)
- **CI** (`.github/workflows/ci.yml`) : typecheck → lint (--max-warnings 0) → tests → E2E Playwright → build web/Docker/Tauri → bundle gate 500 KB
- ⚠️ Tests flaky réseau (proxy-ai/test-runner) — stabilisés sur les derniers runs ; E2E : 35 fichiers

## 7. DÉPENDANCES & SUPPLY CHAIN

- ✅ `npm audit` : 0 vulnérabilité ; overrides de sécurité en place (hono, undici, brace-expansion, js-yaml…)
- ✅ Durcissement ajouté : `minimumReleaseAge: 10080`, `trustPolicy: no-downgrade`, `blockExoticSubdeps: true`, `min-release-age=7` (.npmrc)
- ✅ Actions GitHub épinglées par SHA ; injection shell de l'action recli fermée (env vars)
- ✅ Dockerfiles : `USER node` non-root

## 8. PERFORMANCE

- Gate bundle : 500 KB gzipped (main-app) ; `lucide-react` optimisé
- ⚠️ 96 % client components → pas de SSR/streaming ; re-indexation sémantique des corps de requêtes à chaque changement de collections ; tree-sitter : 8 grammaires WASM chargées

## 9. ROADMAP PRIORISÉE — état final (21/08/2026)

| # | Action | Priorité | Statut |
|---|---|---|---|
| 1 | **Appliquer le `DROP POLICY` RLS sur la base Supabase existante** | 🔴 | ⚠️ **Action manuelle restante** (SQL dans `AUDIT_CAPTURE.md`) |
| 2 | Split des 8 god-files | 🟠 | 🟡 Partiel — helpers purs extraits (`lib/capture-utils.ts`) ; refactor structurel à planifier |
| 3 | Couverture UI + tests des routes API | 🟠 | 🟡 3 tests store ajoutés (`hooks/store/__tests__/folders.test.ts`) |
| 4 | i18n des pages restantes (runner, AI, settings) | 🟠 | 🟡 Runner : 6 clés ajoutées + câblées ; AIModal = noms de fournisseurs (marques, non traduits) ; settings déjà i18n |
| 5 | Proxy WS (subscriptions GraphQL + sync) | 🟡 | ⏸️ Différé (tickets WS 30 s = mitigation appliquée) |
| 6 | `workspace_dir` effectif côté Rust | 🟡 | ⏸️ Différé (validation IP privées + noms de ref = mitigation) |
| 7 | Validation des refspec git + redaction par défaut des exports capture | 🟡 | ✅ **FAIT** — `validate_ref_name`/`validate_remote_name` (Rust, tests inclus) ; `redactExports` par défaut `true` |
| 8 | RSC sur pages read-only + lazy loading | 🟢 | ⏸️ Différé (refactor d'architecture) |
| 9 | Factoriser les handlers OAuth (×4) | 🟢 | ⏸️ Différé |

### Ajouts de la session « Corrige tout » (fin de roadmap)

- **Rust** : `validate_ref_name` (branches : `[A-Za-z0-9._/-]`, pas de `..`, pas de fin `.lock`/`/`/`.`) + `validate_remote_name` (pas de `/`) appliqués à `git_remote_add` et `git_branch_create` — 70/70 tests Rust
- **Redaction exports capture** : checkbox « Masquer les identifiants » **cochée par défaut**
- **Tests store** : `folders.test.ts` (3 tests — move cross-collection, même collection, requête inexistante)
- **Extraction god-file** : `formatTime`, `extractHost`, `prettyJson`, `headersToRecord` → `lib/capture-utils.ts` (comportement identique)
- **i18n runner** : `runSequence`, `executionMode`, `stopOnError`, `avgLatency`, `errorRate`, `minMax` FR/EN
- **Tests sync-ws adaptés** au flux ticket asynchrone (stub `fetch` + `flushAsync`) — 12/12

**État final vérifié :** lint ✅ · typecheck ✅ · **web 1520/1520** ✅ · sync-server 138/138 ✅ · Rust 70/70 ✅

---

## Références (rapports détaillés de la session)

- `AUDIT_REQY_WEB_2026-08-20.md` — audit initial + plan de correction
- `AUDIT_CAPTURE.md` · `AUDIT_COLLECTIONS.md` · `AUDIT_GRAPHQL.md` · `AUDIT_SECURITE_GIT.md` · `SEMGREP_TRIAGE.md` · `schema-complet.sql` · `PLAN_CORRECTION_AUDIT.md`
