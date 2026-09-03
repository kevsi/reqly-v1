# Audit complet — reqy-web

> **Date :** 2026-09-03 · **Périmètre :** `reqy-web/` — 560 fichiers source, 48 fichiers de routes API, 197 composants, 179 fichiers de tests. Lectures intégrales des pages `app/(app)`, composants clés, routes API ; **PoC exécutés** pour les conclusions sandbox (répliques exactes des contextes vm sur Node 22).
> **Méthode :** 3 axes en parallèle — (1) sécurité des 48 routes API, (2) exécution de code non fiable + stockage des secrets, (3) fonctionnalités/UX/accessibilité — plus relecture manuelle des flux les plus critiques (OAuth GitHub, proxy SSRF).

---

## Verdict global

**reqy-web est un produit complet et au-dessus de la moyenne sur la défense SSRF et le chiffrement au repos, mais il porte une faille P0 : son sandbox d'exécution de scripts de test est contournable (`this.constructor.constructor`) avec RCE prouvé par exécution.** Deux conditions déterminent la gravité réelle : le flag `NEXT_PUBLIC_DEPLOYMENT_TYPE` (desktop par défaut) et le déploiement public Vercel. Sur desktop, la faille est exploitable par CSRF depuis n'importe quel site visité.

| Axe | Verdict |
|---|---|
| Injection (SQL/command/fs) | ✅ Aucune (Supabase REST paramétré, zéro child_process/fs dans app/api) |
| SSRF | ✅ Mature sur les 6 proxys (CIDR complets, pinning DNS, redirects re-validés) — 3 exceptions P2 |
| Sandbox d'exécution | ❌ **P0 — évasion vm prouvée (RCE)** + `new Function` sans isolation (P1) |
| Secrets | ⚠️ Chiffrés AES-GCM au repos (excellent) mais cookie `auth_session` non-httpOnly côté client (P2) et GITHUB_TOKEN serveur exposé via github-import (P1) |
| Fonctionnalités | ✅ 22 fonctionnalités inventoriées, aucune page stub ; 1 fonctionnalité morte (Chains, invisible) |
| UX | ⚠️ Solide en structure mais i18n réellement à moitié câblé, perte de données muette possible, a11y lacunaire hors zones récentes |

---

## 🔴 P0 — Évasion du sandbox vm (RCE prouvé par PoC)

**`lib/script-sandbox.ts:66-79`** (route `POST /api/test-runner/execute`) et **`lib/test-runner/scripts.ts:216-235`** (moteur canonique).

Les protections en place sont réelles mais contournables : `codeGeneration: {strings:false, wasm:false}` empêche `eval`/`new Function` *dans* le contexte, 31 globals masqués, timeout vm. Mais le masquage de `Function` ne coupe pas la **chaîne de prototypes** : `this.constructor.constructor` atteint le `Function` constructor **du royaume hôte**, hors de portée de `codeGeneration`.

**PoC exécuté sur réplique exacte du sandbox (résultats réels)** :
- lecture de fichier arbitraire (`fs.readFileSync('C:/Windows/win.ini')` → contenu retourné) ;
- spawn de processus (`child_process.spawnSync` → `PWNED_SANDBOX`) ;
- dump complet de `process.env` (83 clés).

**Chemin d'attaque** : `app/api/test-runner/execute/route.ts:94-102` exécute le JS du POST. La garde `isPublicWebDeployment()` ne bloque que si `NEXT_PUBLIC_DEPLOYMENT_TYPE === "web"` (défaut `.env.example` : `desktop`). En déploiement desktop : POST cross-origin `text/plain` (pas de preflight, `request.json()` parse sans vérifier le content-type) → **RCE sur la machine de l'utilisateur via CSRF depuis n'importe quel site visité**. En web correctement flaggé : 403.

Même évasion dans `@reqly/mock-engine/dist/scripts.js` (transforms de mocks, serveur) — l'UI promet « pas d'IO, pas de require » : **faux**.

**Remède structurel** : `node:vm` n'est pas une frontière de sécurité (position officielle Node). Isoler dans un process jetable ou un `worker_threads` avec `resourceLimits`. Court terme : wrapper `"use strict"` + arrow IIFE (coupe `this` hôte), importer `Math`/`JSON`… depuis le contexte, et surtout ne jamais exposer l'endpoint en desktop sans CSRF token.

## 🟠 P1

1. **`/api/github-import` — GITHUB_TOKEN serveur consommé par des anonymes** (`route.ts:53`) : le token d'env est attaché à toute requête non authentifiée → lecture de l'arbre + 200 fichiers de **repos privés accessibles au token serveur**, avec traversal `../..` non encodé (owner/repo/branch interpolés bruts, `route.ts:90,313,332`).
2. **`components/mock/local-engine.ts:209` — `new Function` sans aucun sandbox dans la page** (bouton « Tester » des transforms) : accès total à `window`/`fetch`/`document.cookie`/IndexedDB (où vivent les secrets chiffrés en cache mémoire clair), aucun timeout. Vecteur : transform importé d'un tiers (Postman/Bruno/capture/IA).
3. **`lib/test-runner/scripts.ts` (moteur canonique)** : même évasion — dormante côté serveur (`disableScripts:true` systématique : `run/route.ts:149`, `llm-tools.ts:1052`, `use-monitors.ts:186`) mais active sur tout runtime où `process.getBuiltinModule` existe.
4. **`lib/session-store.ts:53`** : le client restaure la session via `document.cookie.match(/auth_session=…/)` — preuve que ce cookie **n'est pas httpOnly** dans ce flux, contredisant le commentaire du fichier. Couplé au P1-2, un XSS vole la session.

## 🟡 P2

5. **Webhook monitors sans garde SSRF** (`cron/monitors/route.ts:222` → `alerts.ts:41`) : POST serveur vers n'importe quel host intranet https, **redirects suivis automatiquement** ; auth-gated mais `webhook_url` est user-controlled.
6. **Monitor executor non épinglé** (`server-executor.ts:69`) : DNS résolu/vérifié puis fetch sur hostname → re-résolution = TOCTOU rebinding (contraste avec le proxy, pinné).
7. **Ollama localhost sondable** (`proxy-ai/lib/url-utils.ts:69`, `handlers/ollama.ts:33-57`) : host/port user-controlled, non authentifié → scan de ports loopback de l'instance publique, réponses JSON renvoyées à l'appelant.
8. **`/api/proxy-sse` sans auth** — asymétrique avec `/api/proxy` (qui exige `requireCaptureUserId`) ; mitigations présentes (RL, SSRF+CORS strict, caps) mais proxy streaming public, 5 min/connexion.
9. **`/api/embed` : clé JINA serveur dépensée par des anonymes** (`route.ts:18`), RL bucket partagé verrouillable.
10. **`/api/git/proxy`** : `arrayBuffer()` upstream non plafonné (`:307`) + relais `git-receive-pack` non authentifié.
11. **Gate d'auth dépendante du flag de build** (`lib/environment.ts:22-24`) : flag absent sur le déploiement public = proxy ouvert + vm sans auth. Risk de configuration.
12. **`UpstashRateLimiter` fail-open** (`lib/rate-limiter.ts:190-198`) + in-memory inefficace en serverless multi-instances.

## ⚪ P3 (extraits)

- ~12 routes trust XFF inconditionnellement (safe sur Vercel, bypass RL ailleurs) ; ~8 buckets RL partagés verrouillables (dont `github-login/start` — un attaquant peut verrouiller le login GitHub de tout le monde) ;
- comparaison cron non timing-safe (`cron/monitors:61` vs `capture/cleanup` qui l'est) ;
- capture = interrupteur **global** par instance (start/stop affectent tous les users) ;
- fallback cookies `plain.` si aucun secret (`cookie-cipher.ts:73`) ; cache mémoire `syncStore` secrets en clair ;
- `scripts[]` sans `.max()` + `Promise.all` non borné (`test-runner/execute:23-54`) ;
- sse-demo sans RL, CORS `*`, 7,5 min de worker/connexion ;
- **tests de sécurité qui ne testent pas la vraie faille** : `script-sandbox.test.ts` vérifie `typeof X === "undefined"` (jamais le vecteur `constructor.constructor`), et `test-runner-scripts.test.ts:11` **mocket node:vm avec `new Function`** — le sandbox n'est jamais réellement testé.

## ✅ Points forts vérifiés (à conserver)

SSRF mature sur les 6 proxys (CIDR v4/v6 complets, fail-closed, **pinning DNS anti-rebinding**, redirects re-validés) ; scoping `user_id` systématique (capture, monitors) ; masquage headers sensibles à la capture ; OAuth GitHub impeccable (state, timing, httpOnly, allowlist redirect) ; secrets chiffrés AES-256-GCM + PBKDF2 600k ; anti-prototype-pollution sur tous les chemins JSON ; conversions LLM 100 % déclaratives (aucun code IA exécuté) ; zéro eval/child_process applicatif.

---

## Fonctionnalités & UX

### Inventaire (22 fonctionnalités)

**Complètes** : éditeur REST, capture desktop (+exports HAR/OpenAPI/mock/cURL), capture→tests, dashboard, collections, import/export (OpenAPI/Bruno/GitLab/Postman), monitors (scheduler leader-lock), GraphQL, SSE, Git (2 backends : Tauri + isomorphic-git), workspaces, sync multi-device, SDK generator (10 langages), My Projects, Settings (7 sections), IA (sidebar + agent), raccourcis, modules encode/decode, `/join`.
**Partielles** : runner perf (VUs — mais assertions/scripts ignorés silencieusement), capture web (2 pollings redondants, trafic /api/proxy seulement), chains, documentation in-app (statique, EN, obsolète).

### Top 10 UX (factuel)

1. **Chains invisible** : aucune entrée sidebar/ACTIVE_PAGE_MAP (`layout.tsx:17-33`) — fonctionnalité morte en pratique, accessible par URL seulement.
2. **Perte de données muette** : DB corrompue → `persistence.ts:196-201` catch → store vierge sans toast.
3. **i18n à moitié câblé** : fr/en.json parfaits (2190 clés synchronisées) mais ~40 chaînes hardcodées dans runner, workspaces 100 % EN, sdks 100 % FR hardcodé, 27 toasts non traduits.
4. **Runner : réordonnancement cosmétique** (`runner/page.tsx:598-613`) — state local jamais persisté, l'ordre d'exécution réel non affecté.
5. **Deux systèmes d'assertions concurrents** (« Tests » legacy + « Assertions » runner) avec icônes identiques.
6. **7 boutons icônes sans aria-label** (tab bar) + 0 aria dans les 6 gros composants historiques.
7. **Menu contextuel tabs inaccessible** (div sans role, pas d'Escape, fermeture clic/scroll seulement).
8. **Documentation in-app statique, anglaise, obsolète** — ignore monitors/mocks/capture/Git ; deux sources de vérité divergentes avec docs/FONCTIONNALITES.md.
9. **Pas d'indicateur d'état sync permanent** (erreurs WS en console) + double polling capture web.
10. **Runner mode « Local/Proxy » inintelligible** (`serverSide: runMethod === "local"` l.984) — la sémantique est inversée/opaque.

### Accessibilité — points positifs
Roving tabIndex + `role="tablist"` de la tab bar, FocusScope + pile Escape de l'AiSidebar, drawer mobile avec focus save/restore, `monitors-page` exemplaire (aria partout, `role="alert"`), states d'erreur transport complets avec « Détails techniques » repliables, détection port occupé avec ports alternatifs cliquables.

### Écarts documentation (docs/FONCTIONNALITES.md vs code)
Non documentés : **monitors, mocks, chains, dashboard, capture web, SDK generator, modules lifecycle, invitations par lien, palette Ctrl+K, 7 thèmes, AI sidebar complète, historique runs + re-run failed, runner perf**. Documentés mais inexacts : « résolution de conflits » (notification+pull auto seulement, pas d'UI), capture « desktop only » (elle existe en web), § IA obsolète (ancien générateur en 3 lignes vs 23 composants réels).

---

## Plan de correction recommandé

| Priorité | Action | Effort |
|---|---|---|
| 1 | **P0 sandbox** : désactiver `/api/test-runner/execute` en desktop ou ajouter CSRF + wrapper strict/IIFE + process jetable (worker_threads `resourceLimits`) | M |
| 2 | **P1-1 github-import** : exiger auth + encoder owner/repo/branch (ou `encodeURIComponent` segmentaire) | S |
| 3 | **P1-2 local-engine** : remplacer `new Function` par la même politique « désactivé navigateur » que scripts.ts:238 | S |
| 4 | **P2-5 webhook monitors** : réutiliser la garde SSRF + pinning existants (le code est là, il n'est pas branché) | S |
| 5 | **P2-7/-2** : ollama et executor → pinning/allowlist comme le proxy | S |
| 6 | **P2-8/-9/-10** : auth sur proxy-sse, embed, cap git/proxy | S |
| 7 | **P2-11** : fail-closed sur le flag (exiger auth sauf explicitement desktop+local) | S |
| 8 | **UX 1-5** : sidebar Chains, toast DB corrompue, i18n runner/workspaces/sdks, persist réordonnancement, unifier assertions | M |
| 9 | **P3** en vrac (buckets RL, timing-safe, tests du vrai vecteur d'évasion) | M |
| 10 | Docs : réécrire FONCTIONNALITES.md depuis l'inventaire ci-dessus | S |
