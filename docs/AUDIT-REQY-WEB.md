# AUDIT COMPLET reqy-web — Vulnérabilités, faiblesses & fonctionnalités fictives

> Date : 23 août 2026 · Mode : **lecture seule, aucune correction appliquée**
> Méthode : 4 agents de pentest parallèles cloisonnés par périmètre + audits automatisés (deps, secrets) + vérifications manuelles des constats critiques.
> Chaque constat est sourcé fichier:ligne et a été revérifié manuellement pour les plus graves.

---

## Synthèse exécutive

| Catégorie                        | CRITIQUE | HIGH       | MEDIUM        | LOW |
| -------------------------------- | -------- | ---------- | ------------- | --- |
| Sécurité réseau / SSRF           | 0        | 3          | 7             | 3   |
| Auth / sessions / secrets        | 0        | 4          | 2             | 2   |
| Exécution code / XSS             | 0        | 1          | 3             | 1   |
| Fonctionnalités fictives/baclées | —        | 2 majeures | 8+ partielles | —   |

**Verdict global** : le cœur (proxy HTTP, proxy-ai, sandbox VM, CSP, OAuth state) est solide et testé. Les vrais risques se concentrent sur : une route proxy SSE sans auth, la durée de vie des cookies de tokens OAuth (30 j), un dispatcher DNS non épinglé sur `proxy-models`, et surtout **des fonctionnalités UI qui mentent** (export Postman fictif, chaînes d'exécution no-op).

---

## PARTIE 1 — VULNÉRABILITÉS SÉCURITÉ

### 🔴 H1 · `/api/proxy-sse` accessible sans authentification — _vérifié manuellement_

- **Preuve** : `proxy.ts:4-15` — `PROTECTED_PREFIXES` contient `/api/proxy`, `/api/proxy-ai`, `/api/proxy-models`… mais **pas** `/api/proxy-sse`. La route (`app/api/proxy-sse/route.ts`) n'appelle pas `requireCaptureUserId`.
- **Impact** : proxy SSE anonyme ouvert — n'importe qui peut relayer du trafic via votre serveur (masquage d'IP, abus de coûts vers APIs tierces).
- **PoC** : `curl "https://<cible>/api/proxy-sse?url=https://api.ipify.org?format=json"` → réponse relayée sans token.
- **Nuance** : les protections SSRF internes existent dans la route ; c'est l'auth qui manque.

### 🟠 H2 · Tokens OAuth GitHub/GitLab en cookie 30 jours

- `app/api/github-auth/callback/route.ts:188-194` et `app/api/gitlab-auth/callback/route.ts:97-103` : `maxAge: 60*60*24*30` sur les cookies `github_token`/`gitlab_token` (HttpOnly, SameSite=Lax).
- Scope GitHub = `repo` (lecture+écure dépôts privés). Un XSS → accès repos pendant 1 mois, même après déconnexion côté provider.

### 🟠 H3 · `proxy-models` custom : pas de pinned dispatcher → DNS rebinding TOCTOU

- `app/api/proxy-models/route.ts:25-44` : `assertSafeBaseUrl()` valide le DNS puis `fetch()` le **résout à nouveau** sans épingler l'IP.
- Le handler équivalent `proxy-ai/handlers/openai-compat.ts` utilise correctement `createPinnedDispatcher()` — l'incohérence prouve que le fix existe mais n'a pas été porté ici.
- PoC : domaine TTL=0 passant du check (IP publique) au fetch (169.254.169.254).

### 🟠 H4 · Supabase `SERVICE_ROLE_KEY` (bypass RLS total)

- `lib/supabase.ts:26` : client serveur créé avec la service-role key. Tout endpoint qui l'expose sans garde `requireCaptureUserId` = accès base complet. À cartographier route par route avant correction.

### 🟡 M1-M7 · Moyennes réseau

| #   | Constat                                                                                                                                                        | Preuve                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| M1  | `git/proxy` : CORS `Access-Control-Allow-Origin: *` (`route.ts:206`) + redirect Location validé sans résolution DNS (`route.ts:58-68`)                         | lecture cross-origin possible des réponses publiques |
| M2  | `git/proxy` POST sans limite de taille (`route.ts:168-171`) ni timeout upstream (`173-178`)                                                                    | DoS mémoire/hang worker                              |
| M3  | `embed` : taille/nombre d'inputs illimités → amplification de coûts Jina (`embed/route.ts:30-40`)                                                              | facturation + OOM                                    |
| M4  | `x-proxy-timeout` client accepté jusqu'à 120 s (`proxy/route.ts:319-320`)                                                                                      | occupation worker prolongée                          |
| M5  | Rate limiter in-memory non distribué (fallback si Upstash absent, ×instances serverless) (`lib/rate-limiter.ts:16-18`)                                         | limite effective N× configurée                       |
| M6  | `gitlab-api` : clé de rate-limit = header XFF brut sans vérif TRUSTED_PROXY (`gitlab-api/route.ts:14-17`)                                                      | bypass trivial par spoof XFF                         |
| M7  | Clé API Jina/Postman stockées **en clair** dans cookies 30 j (`jina-auth/cookies.ts`, `postman-auth/cookies.ts`) ; `postman_user` JSON non signé (falsifiable) | interception/falsification                           |

### 🟢 LOW

- L1 · Body-size check du proxy basé uniquement sur le header `content-length` (menteur) — `proxy/route.ts:200-210`
- L2 · Interpolation `{{VAR}}` sans filtre CRLF applicatif (`lib/utils.ts:45`, `runner.ts:271`) — atténué car `fetch()` natif rejette les `\r\n` de headers
- L3 · Sandbox VM sans limite mémoire (`script-sandbox.ts:76`) — DoS mémoire possible avant le timeout
- L4 · iframe `srcDoc` avec DOMPurify config **par défaut** (`response-content-renderer.tsx:161`) : `<a href="data:...">` survit à la sanitisation ; `sandbox=""` bloque le JS mais pas la navigation data:

### ⚪ Secrets — constat dégradé après vérification

`.env.local` contient des secrets de prod réels (GitHub/GitLab client secrets, Upstash token, PROXY_SERVICE_TOKEN). **Vérifié manuellement** : fichier correctement gitignoré (`.gitignore:12`) et **jamais commité** dans l'historique (`git log --all` vide). Risque = hygiène locale, pas fuite repo. Rotation conseillée si le poste/workspace a été partagé.

---

## PARTIE 2 — FONCTIONNALITÉS FICTIVES OU BÂCLÉES

### 🎭 F1 · Export Postman — **entièrement fictif** _(vérifié manuellement)_

- `app/api/postman-export/route.ts:78-92` : construit le JSON Postman **en mémoire** et renvoie `{ exported: true }`. **Aucun appel à api.postman.com**, aucun usage de la clé PMAK pourtant stockée en cookie par postman-auth.
- Côté UI (`collections/page.tsx:216-221`) : la réponse est jetée, toast **« Export vers Postman réussi »** affiché. Rien n'est envoyé… ni même téléchargé.
- L'import Postman est lui réel — asymétrie trompeuse.

### 🎭 F2 · Bouton « Execute Chain » — no-op avec succès affirmé

- `chains/page.tsx:9` monte `<RequestChainWorkflow />` **sans** prop `onExecute` ; `request-chain-workflow.tsx:182-189` affiche « Chaîne exécutée » alors que rien n'a tourné.
- Les étapes de chaîne ne sont jamais persistées (état React local) ; la spec e2e `chaining.spec.ts` ne peut pas échouer (chaque assertion wrappée dans `isVisible().catch(() => false)`).

### 🧟 Code mort significatif

| Élément                                                                                                                  | Taille      | Détail                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `components/ai-assistant-modal.tsx`                                                                                      | 778 lignes  | Assistant IA complet (« Monu »), i18n maintenue, **jamais monté**                                                              |
| `components/tunnel-facilitator.tsx`                                                                                      | 139 lignes  | Jamais rendu + `detectTunnelCli()` structurellement impossible (import `node:child_process` en WebView, `tunnel/detect.ts:47`) |
| `components/route-panel.tsx`, hooks `use-history/use-collections/use-environments/use-chat-history/use-ssl-verification` | ~300 lignes | Jamais importés (le hook SSL dupliqué inline dans tools-section)                                                               |
| `registerAvailableModule()`                                                                                              | —           | API « marketplace » publique jamais appelée en prod                                                                            |

### 🩹 Partiels trompeurs

1. **Git web** : ahead/behind hardcodé à 0 (`git-backend.ts:497-500`), stash = JSON maison `.git/reqly-stashes.json` (illisible par git réel), `conflicted:false` forcé (`:313-314`) → le GitConflictResolver monté à l'écran est **inatteignable en web**
2. **Run arrière-plan** : environnement passé vide `{}` malgré le commentaire promettant les variables actives (`use-request-collection-runner.ts:56-60`) → résultats faux silencieusement
3. **Runner serveur** : `/api/test-runner/run` jette pre/post-scripts (`disableScripts: true`, `run/route.ts:148-150`) sans le signaler dans la réponse ; la route qui les gère est deprecated/orpheline
4. **Sync** : pull/push silencieusement no-op sans `NEXT_PUBLIC_SYNC_URL` (`hooks/store/sync.ts:83-100`) ; historique/projets/préférences non synchronisés sans documentation
5. **Postman/Jina sur desktop** : routes API inexistantes en build statique → tuiles « Connect » vouées à l'erreur réseau générique (contournement prévu pour GitHub/GitLab seulement, `tools-section.tsx:69-102`)
6. **Ollama web** : option sélectionnable mais bloquée à 100 % par son propre garde SSRF (host par défaut `127.0.0.1` interdit, `handlers/ollama.ts:34`)
7. **Marketplace modules** : UI install/uninstall complète pour exactement **un** module bundlé (`registry.ts:20`)
8. **E2E offline-sync creuses** : 3 tests `expect(true).toBeTruthy()` + endpoints fantômes (`offline-sync.spec.ts:36-47,100-102`)
9. **Cosmétique** : `\u2026` littéral affiché (« Joining… », `join/page.tsx:78`, `workspaces/page.tsx:598`)

---

## PARTIE 3 — DÉFENSES BIEN IMPLÉMENTÉES (à ne pas casser)

- **SSRF sur `/api/proxy`** : CIDR privés IPv4+IPv6, DNS cache + IP pinning (anti-rebinding), redirects revalidés hop-par-hop (max 5), fail-closed — modèle à répliquer partout
- **CSP nonce-based + strict-dynamic** dans le middleware, pas d'unsafe-inline script en prod
- **OAuth state CSRF** correct (UUID, cookie HttpOnly, expiry 300 s) — GitHub ET GitLab
- **Sandbox VM scripts** : `codeGeneration:false`, 55 globals shadowés, whitelist d'intrinsics, timeout, prototype-pollution filtrée (`__proto__`/constructor/prototype) dans tous les parsers JSON-path
- **js-yaml `JSON_SCHEMA`** (pas d'exécution YAML), zip-slip non applicable (ZIP-in-ZIP, chemins constants)
- **DOMPurify ultra-restrictif** sur le coloriage syntaxique (seuls `<span class>`)
- **secure-storage** : PBKDF2 600k + AES-256-GCM, passphrase Rust jamais persistée
- i18n parfaitement paritaire (1864/1864 clés fr↔en, testée)
- Aucune vulnérabilité connue dans les dépendances (`pnpm audit` clean), aucun token loggé

---

## PRIORISATION SI CORRECTION ULTÉRIEURE (non appliquée)

1. Auth sur `/api/proxy-sse` (H1)
2. maxAge 30 j → 1 h sur cookies tokens GitHub/GitLab (H2) + chiffrement clés Jina/Postman (M7)
3. Pinned dispatcher sur `proxy-models` custom (H3)
4. Cartographie usages SERVICE_ROLE_KEY (H4)
5. Décision produit sur export Postman (F1) et chains (F2) : implémenter ou retirer l'UI

## Périmètre NON couvert par cet audit

- Backend Rust Tauri (`src-tauri/`) — seulement croisé ponctuellement
- sync-server (audité séparément lors des sessions précédentes)
- Tests dynamiques/DAST (aucune requête réelle envoyée contre un déploiement live)
