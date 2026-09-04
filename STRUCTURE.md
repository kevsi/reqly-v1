# Structure du dépôt — Reqly

> Vue d'ensemble des dossiers du monorepo `apiPlayground-main` et de leur rôle.
> Projet : **Reqly**, un client API moderne (alternative à Postman) décliné en application web, desktop, CLI, avec un backend de synchronisation, un analyseur de code et un assistant IA.

Le dépôt est un **monorepo pnpm + Turbo**. Les packages membres du workspace sont déclarés dans `pnpm-workspace.yaml` ; les dossiers `analyser-api` et `reqly-docs-experience` ont leur propre workspace/installation et sont **indépendants** du monorepo racine.

---

## Tableau récapitulatif

| Dossier | Rôle en une ligne |
| --- | --- |
| [`reqy-web/`](#reqy-web) | Application web principale (Next.js) : client API, collections, runner, IA |
| [`src-tauri/`](#src-tauri) | Application desktop (Tauri v2, backend Rust) |
| [`sync-server/`](#sync-server) | Backend : comptes, workspaces, synchronisation temps réel |
| [`analyser-api/`](#analyser-api) | Analyseur statique de backends (extraction de routes API, multi-langages) |
| [`recli/`](#recli) | CLI de test d'API + serveur MCP pour assistants IA |
| [`reqly-landing/`](#reqly-landing) | Site vitrine marketing (Next.js) |
| [`reqly-admin/`](#reqly-admin) | Console d'administration opérateur : stats, monitoring, gestion utilisateurs/workspaces (Next.js, export statique) |
| [`mcp-docs/`](#mcp-docs) | Site de documentation du serveur MCP (bilingue, friendly LLM) |
| [`reqly-docs-experience/`](#reqly-docs-experience) | Prototype de documentation interactive (hors workspace) |
| [`packages/`](#packages) | Bibliothèques internes partagées (`@reqly/mock-engine`, `@reqly/shared`) |
| [`docs/`](#docs) | Documentation projet (fonctionnalités, CI, déploiement, sécurité) |
| [`scripts/`](#scripts) | Scripts d'outillage (sécurité, builds) |
| [`.github/`](#github) | Workflows CI (GitHub Actions) |
| Dossiers d'outils | `.claude-flow/`, `.opencode/`, `.freebuff/`, `.turbo/`, `node_modules/` |

---

## Détail par dossier

### `reqy-web/`
**L'application web principale de Reqly.** Application Next.js (App Router, React, Tailwind CSS) servant de client API complet : édition et exécution de requêtes REST / GraphQL / SSE, gestion de collections et workspaces, runner batch, capture de trafic, import/export (Postman, Bruno, curl), et un **assistant IA** intégré. C'est aussi le frontend embarqué par le desktop Tauri (`frontendDist: ../reqy-web/out`).

Sous-dossiers clés :
- `app/` — routes et pages Next.js : `(app)/` (espace connecté : runner, collections, dashboard…), `api/` (routes API serveur : `proxy/`, `proxy-sse/`, `test-runner/`, `github-auth/`, `csp-reports/`…), plus les pages d'auth (`login`, `signup`, `reset-password`).
- `components/` — composants UI (panneaux de collections, éditeurs, dialogs, drag-and-drop…).
- `lib/` — logique métier côté serveur et partagée : capture (`capture-*`), base locale (`db.ts`), auth (`auth-client.ts`), sécurité (`security/`), convertisseurs (`bruno-import.ts`, `curl-parser.ts`), etc.
- `src/ai/` — moteur IA : `cloud-engine/` (appels LLM, métriques), `local-engine/`, `agent/`, composants d'UI IA.
- `src/i18n/` — traductions FR/EN.
- `modules/`, `contexts/`, `hooks/` — fonctionnalités transverses et états React.
- `docs/` — notes internes de l'application web.

### `src-tauri/`
**Le client desktop Reqly**, construit avec Tauri v2 : un backend en Rust + une webview qui charge le build de `reqy-web`. Le code Rust (`src/`) couvre le moteur de requêtes natif (`fetch.rs`), l'analyse (`analyzer.rs`), la capture (`capture.rs`), un serveur MCP (`mcp.rs`), l'OAuth (`oauth.rs`), le stockage local (`store.rs`), l'intégration git (`git/`) et les bindings TypeScript (`ts_bindings.rs`). Le dossier `resources/` embarque des copies « sidecar » de `recli` et `analyser-api` pour les builds de release. Les permissions du shell sont décrites dans `capabilities/`.

### `sync-server/`
**Le backend de synchronisation de Reqly** (Node.js/TypeScript, nom de package `reqly-sync-server`). Il gère :
- les **comptes & sessions** (email/mot de passe + GitHub OAuth, vérification email, reset de mot de passe) ;
- les **workspaces multi-utilisateurs** avec rôles (`owner`, `editor`, `viewer`) ;
- la **sync temps réel** des collections / environnements / dossiers entre les clients web et desktop, via poll HTTP + push + notifications **WebSocket** (`ws-hub.ts`, `ws-ticket.ts`).

Le fichier `FONCTIONNEMENT.md` à la racine du dossier documente l'architecture et le déploiement de production (SQLite + Litestream, service systemd sur EC2).

### `analyser-api/`
**Analyseur statique de backends** : il parcourt le code source d'un projet et en extrait les routes API (méthode, path, auth, body, params) dans plusieurs formats. Multi-langage (JavaScript/TypeScript, Rust, Python, Go), basé sur `ast-grep` et **extensible par détecteurs** (un détecteur par framework : express, fastify, nestjs, nextjs, axum, actix-web, fastapi, flask, django, gin, echo…). Organisé en packages internes (`packages/core`, `packages/cli`, `packages/detector-*`). C'est un **workspace pnpm séparé** du monorepo racine ; il est embarqué en sidecar dans le desktop Tauri.

### `recli/`
**CLI de test d'API** (« the API testing CLI ») : exécute des collections JSON contre de vrais endpoints, avec assertions textuelles ou scripts `pm.test()` style Postman, chaînage de réponses entre requêtes, et rapports multi-formats. Il propose aussi une **TUI plein écran** et un **serveur MCP** (`src/mcp/`, basé sur `@modelcontextprotocol/sdk`) pour qu'un assistant IA puisse exécuter et éditer les collections. Installable globalement via npm.

### `reqly-landing/`
**Le site vitrine marketing de Reqly** (Next.js) : landing page, sections produit (écosystème, intégrations…), avec SEO (sitemap, OpenGraph, robots).

### `reqly-admin/`
**Console d'administration (« console opérateur »)** de Reqly. C'est une application **Next.js 16 100 % front-end** (React 19, Tailwind CSS v4, composants Radix UI, graphiques `recharts`, toasts `sonner`) configurée en **export statique** (`output: "export"`, déployée sur Vercel — dossier `.vercel/`). Elle n'a **pas de backend propre** : elle dialogue directement avec deux services externes, identifiés par des tokens Bearer saisis par l'opérateur :

- **`sync-server`** — API d'admin REST (`/api/admin/*`) du backend de synchronisation :
  - `stats` — compteurs globaux (utilisateurs, vérifiés, OAuth, désactivés, workspaces, invitations en attente, collections) ;
  - `users` — liste/recherche d'utilisateurs paginée + détail (memberships et rôles) ;
  - actions de modération : `disable` / `enable` un utilisateur, `revoke-sessions` (révocation de toutes ses sessions) ;
  - `workspaces` — liste (owner, nb de membres, nb de collections) ;
  - `activity` — journal d'activité (action, entité, email de l'acteur, workspace, date).
- **`reqly-monitor`** — service de monitoring (défaut : `https://reqly.duckdns.org/monitor`) :
  - `metrics` (1h/24h/7d) — requêtes/min, taux d'erreur, latence moyenne/P95, snapshots hôte (CPU/RAM/disque) ;
  - `health` — état du sync-server et fraîcheur des logs ;
  - `logs` — derniers logs de requêtes (méthode, path, statut, durée).

L'interface (fichiers `components/admin/`) propose une **sidebar à 6 sections** : *Vue d'ensemble* (cartes KPI + état monitoring), *Monitoring* (graphiques de charge et table de logs), *Utilisateurs*, *Workspaces*, *Activité*, et *Réglages* (config des connexions + test des tokens, thème clair/sombre, déconnexion). La connexion se fait via un écran de type *LoginGate* qui ne fait qu'enregistrer URLs + tokens.

Organisation du code :
- `app/` — pages minimales (`layout.tsx` sombre, `page.tsx` qui monte `AdminApp`) ;
- `components/admin/` — `admin-app.tsx` (shell + sidebar), `login-gate.tsx`, `sections/` (overview, monitoring, users, workspaces, activity, settings) ;
- `components/ui/` — primitives UI (shadcn style : table, dialog, tabs, select, switch…) ;
- `lib/` — `config.ts` (URLs + tokens stockés en `localStorage` sous `reqly_admin_config`), `api.ts` (clients REST typés vers les deux services), `chart-utils.ts`, `utils.ts`.

> Note : `reqly-admin` n'apparaît **pas** dans `pnpm-workspace.yaml` et n'a pas de `pnpm-lock.yaml` (un `package-lock.json` npm est présent) : il est **hors workspace pnpm**, comme `analyser-api` et `reqly-docs-experience`. C'est un outil interne opérateur : la config et les tokens d'admin sont conservés dans le `localStorage` du navigateur.

### `mcp-docs/`
**Site de documentation du serveur MCP de Recli** (Next.js). Contenu rédigé en MDX **bilingue FR/EN** (`content/docs/` : getting-started, architecture, configuration, exemples). Le site est optimisé pour les assistants IA (`llms.txt`, `llms-full.txt`) et dispose d'une recherche (`app/api/search`).

### `reqly-docs-experience/`
**Prototype de « documentation interactive »** (« La documentation qui répond ») : un site statique React + Vite avec un petit serveur Express pour servir le build. Ce dossier a été **généré depuis un template** (`template.json`) et n'est **pas membre du workspace pnpm** racine (workspace indépendant). Il contient des artefacts de développement (plugins Manus de debug, placeholders d'analytics Umami) : à considérer comme une maquette, pas comme de la production.

### `packages/`
Bibliothèques internes partagées du monorepo :
- `packages/mock-engine/` (`@reqly/mock-engine`) — moteur de mock d'API ;
- `packages/shared/` (`@reqly/shared`) — code partagé (types, utilitaires) entre les apps.

### `docs/`
**Documentation transversale du projet** : fonctionnalités du produit (`FONCTIONNALITES.md`), validation et CI (`VALIDATION_CI.md`), optimisation du bundle, checklist de déploiement Vercel, guide de setup Supabase, backlog sécurité.

### `scripts/`
Scripts d'outillage exécutés par les hooks et les builds :
- `check-secrets.mjs` — scan des secrets dans les fichiers stagés (pre-commit, via husky/lint-staged) ;
- `prepare-analyser-sidecar.mjs` — assemble le sidecar `analyser-api` (source + node_modules) dans `src-tauri/resources/` pour les builds de release Tauri.

### `.github/`
Workflows **CI GitHub Actions** : `ci.yml` (validation du monorepo) et `recli-ci.yml` (CI de la CLI).

---

## Dossiers d'outils et de cache (non source)

| Dossier | Contenu |
| --- | --- |
| `.claude-flow/` | État/config de l'outil d'agent IA « Claude Flow » (policy). |
| `.opencode/` | Checkpoints et journaux de sessions de l'agent de dev « OpenCode ». |
| `.freebuff/` | Worktrees git gérés par l'outil « Freebuff ». |
| `.turbo/` | Cache des builds Turbo. |
| `node_modules/` | Dépendances installées du monorepo racine. |

---

## Fichiers racine notables

- `package.json`, `pnpm-workspace.yaml`, `turbo.json` — configuration du monorepo (scripts `dev`, `build`, `lint`, `test`, `tauri:*`, workspace pnpm, tâches Turbo). Le workspace déclare `reqy-web`, `reqly-landing`, `recli`, `packages/*`, `sync-server`, `mcp-docs` (note : `reqly-docs` est listé mais le dossier correspondant est absent — voir `reqly-docs-experience`, hors workspace).
- `AUDIT_REQLY.md` — audit fonctionnel et technique du desktop V1.
- `jsonplaceholder-openapi.json` — spec OpenAPI de test/démo (fixture).
- `reqly-web-standalone.tar.gz` — archive d'export standalone du web.
- `ruvector.db` — fichier de base de données présent à la racine, **non référencé par le code** (vestige probable).
- `tmp_test.txt` — fichier de test temporaire (bout de test vitest) laissé à la racine.
- `.env.local` — variables d'environnement locales de développement (clés de signing/auth) : à ne pas committer.
- ⚠️ **`reqly.pem`** (et sa copie `sync-server/reqly.pem`) — **clé privée RSA SSH d'accès à la production EC2** (cf. `sync-server/FONCTIONNEMENT.md`). Sa présence dans le dépôt est un **risque de sécurité** : elle devrait être révoquée/retirée et déplacée vers un gestionnaire de secrets.
