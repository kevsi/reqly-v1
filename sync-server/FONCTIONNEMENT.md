# Guide dev — reqly-sync-server

> Résumé de fonctionnement, notes utiles et tout ce qu'un dev doit savoir.
> Dernière mise à jour : 2026-08-24 (après audit + intégration des hotfixes prod).

---

## 1. Rôle

Backend de synchronisation temps réel pour Reqly :

- **Comptes & sessions** (email/password + GitHub OAuth, vérification email, reset password)
- **Workspaces** multi-utilisateurs avec rôles (`owner`, `editor`, `viewer`)
- **Sync** des collections / environnements / dossiers entre clients (web, desktop Tauri)
  via **poll HTTP** + **push** + **notification WebSocket**
- **Hooklet** : inbox de webhooks personnels (endpoints publics à slug, events inspectables,
  rejouables, notifications push vers devices)
- **API admin** (stats, gestion utilisateurs, ban, révocation de sessions)

## 2. Stack

| Élément | Choix |
|---|---|
| Runtime | Node ≥ 22 (prod : v24.18.1 via nvm) |
| Framework HTTP | Hono + `@hono/node-server` |
| DB | SQLite via `better-sqlite3`, mode WAL, foreign keys ON |
| Temps réel | `ws` (WebSocketServer en mode `noServer`) |
| Validation | Zod |
| Email | nodemailer (SMTP) / Resend / console |
| Tests | Vitest — **16 fichiers, 173 tests** |

Pas de service externe requis : tout tient dans un seul processus Node + un fichier SQLite.

## 3. Arborescence `src/`

```
index.ts            Boot : dotenv → gardes de config → CORS → rate limits → routes → WS upgrade
db.ts               Ouverture SQLite + schéma complet (CREATE TABLE IF NOT EXISTS)
auth.ts             Tokens de session signés HMAC, middleware requireAuth, révocation
ws-ticket.ts        Tickets WS éphémères (30 s, liés au workspace)
sync-engine.ts      Cœur de la sync : pushChanges / getChangesSince (pagination keyset)
rate-limiter.ts     Limiteur mémoire par IP (fenêtre glissante)
activity.ts         Journal d'activité workspace (feed UI, pas un audit trail)
email.ts            Envoi des codes (smtp | resend | log)
cors.ts             Parsing de ALLOWED_ORIGIN
push.ts             Notifications push devices (hooklet)
validation.ts       Helper safeParseJson (Zod → réponse 400 propre)
routes/
  auth.ts           signup, verify, resend-code, forgot-password, verify-reset-code,
                    reset-password, login, logout, oauth-login, github-exchange, me, ws-ticket
  workspaces.ts     CRUD workspaces, invitations, transfert de propriété
  memberships.ts    Rôles, listing, retrait de membres
  sync.ts           GET /poll, POST /push (+ broadcast WS)
  ws.ts             Handshake WebSocket (origin → ticket/cookie/bearer → membership)
  hooklet.ts        Endpoints, events, replay, devices (côté utilisateur authentifié)
  hooklet-hooks.ts  Ingest PUBLIC : POST /api/hooks/:slug (non authentifié, limité)
  admin.ts          Surface /api/admin protégée par ADMIN_TOKEN partagé
```

## 4. Démarrage rapide (dev)

```bash
cd sync-server
pnpm install
cp .env.example .env       # puis remplir au minimum AUTH_SIGNING_SECRET
pnpm dev                   # tsx watch src/index.ts → http://localhost:4000
pnpm test                  # vitest run (173 tests)
pnpm typecheck             # tsc --noEmit
pnpm build                 # tsc → dist/
```

Sans OAuth configuré, mettre `AUTH_BYPASS=true` pour développer sans login
(**interdit en prod** : le serveur refuse de démarrer si `NODE_ENV=production`).
En dev sans provider email, les codes de vérification sont simplement logués en console.

## 5. Variables d'environnement

| Variable | Obligatoire ? | Rôle |
|---|---|---|
| `AUTH_SIGNING_SECRET` | ✅ en prod | Secret HMAC des tokens de session **et** tickets WS (`openssl rand -hex 32`). Refus de démarrer sinon |
| `ALLOWED_ORIGIN` | recommandé en prod | Origins autorisées, séparées par `,`. `*` ou vide = warning + cookies cassés |
| `AUTH_BYPASS` | non (déf. false) | Désactive TOUTE l'auth. Fatal en prod |
| `PORT` / `HOST` | non (déf. 4000 / 0.0.0.0) | Écoute HTTP |
| `TRUSTED_PROXY` | non (déf. false) | Mettre `true` derrière Caddy/nginx pour rate-limiter sur la vraie IP cliente (XFF) |
| `REQLY_DB_PATH` | non (déf. `data/reqly-sync.db`) | Chemin SQLite, ou `:memory:` |
| `EMAIL_PROVIDER` | non (déf. log dev / smtp prod) | `smtp` \| `resend` \| `log` |
| `SMTP_*` / `RESEND_API_KEY` | selon provider | Config email |
| `GITHUB_OAUTH_CLIENT_ID/SECRET` | si OAuth GitHub | Login GitHub |
| `GITHUB_OAUTH_REDIRECT_WEB/DESKTOP` | non | Allowlist stricte des redirect URIs (audit H1) |
| `ADMIN_TOKEN` | pour /api/admin | Shared secret Bearer de la surface admin |

## 6. Modèle d'authentification

- Token = `<base64url(payload)>.<hmac-sha256>` (format maison, pas JWT).
  Présenté soit en **cookie** `auth_session`, soit en **`Authorization: Bearer`** (desktop/Tauri).
- Payload : `{ userId, email, name, expires, ver }`.
- **Révocation** : chaque token embarque `ver` = `users.token_version` au moment de l'émission.
  Le logout incrémente `token_version` → tous les anciens tokens deviennent invalides.
- **Ban admin** : `users.disabled=1` → 403 partout, immédiat.
- **WS** : le navigateur ne peut pas mettre d'header sur un WebSocket. Solution :
  `GET /api/auth/ws-ticket` renvoie un ticket signé valable **30 s**, lié au workspace,
  passé en subprotocol (`reqly-bearer, <ticket>`). Fallbacks acceptés à l'upgrade :
  cookie, Bearer, token brut en subprotocol (vieux clients).
- Rate limit dédié et plus strict sur `/api/auth/*` (anti brute-force), plus un
  lockout applicatif après N échecs de login (429 même avec le bon mot de passe).

## 7. Moteur de sync

Entités synchronisées : `collection`, `environment`, `folder`.

### Push — `POST /api/sync/push`
- Requiert membership **+ rôle owner/editor** (les viewers ne peuvent pas pousser).
- Tout se joue en **LWW (last-write-wins) sur `updatedAt`**, raffiné par :
  - **`baseVersion`** (concurrence optimiste) : si fourni et ≠ version serveur → conflit.
    Protège contre le clock-skew client. Sans `baseVersion` (legacy) → LWW pur.
  - **Isolation tenant** : une entité existant dans un autre workspace ne peut jamais
    être mutée, même en connaissant son id (→ conflit).
  - **Folders** rattachés à leur collection parente : pousser un folder dont la
    collection n'appartient pas au workspace est rejeté.
- Réponse : `{ accepted: [...], conflicts: [{entityType, id, serverVersion, serverUpdatedAt}] }`.
- Chaque entité acceptée incrémente `version` ; suppression = soft delete (`deleted=1`).
- Si au moins un changement accepté → **broadcast WS** `{type:"change", entityIds}` aux
  clients du workspace (signal simple : le client re-poll et applique le diff).

### Poll — `GET /api/sync/poll?workspaceId&since&cursor&limit`
- Diff incrémental depuis un timestamp `since`, sur les 3 tables (UNION ALL).
- **Pagination keyset** : curseur `${updatedAt}|${id}`, pages stables (jamais de doublon
  ni de saut sur timestamp identique). Défaut 500, max 1000 (`POLL_PAGE_LIMIT_*`).
- Réponse : `{ changes, nextCursor, hasMore, serverTime }` — utiliser `serverTime` comme
  prochain `since` (évite les dérives d'horloge côté client).

## 8. WebSocket

- Endpoint : `/api/sync/ws?workspaceId=...` (upgrade HTTP géré manuellement).
- Ordre des vérifications à l'upgrade : Origin allowlist → ticket/auth → révocation
  (`ver`) → membership. Sinon socket détruite (401/403).
- Keepalive ping/pong toutes les 30 s ; re-vérification d'expiration/révocation toutes
  les 60 s (close 4001 « Session expired »).
- Le serveur **ne lit jamais** les messages entrants ; `maxPayload: 4096` borne tout
  message entrant résiduel (anti-DoS mémoire).
- Hub en mémoire (`ws-hub.ts`) : mono-processus uniquement.

## 9. Hooklet (inbox webhooks)

- Un **endpoint** = slug public → URL d'ingest `POST /api/hooklet/hooks/:slug`
  (ou mappé publiquement sous `/api/hooks/:slug`). Optionnellement protégé par un
  secret partagé (`x-webhook-secret` ou `?secret=`).
- Chaque requête reçue est stockée en entier (méthode, headers, query, body, IP source)
  dans `hooklet_events` → inspectable, supprimable, **rejouable**.
- **Devices** : abonnement push (notifications quand un event arrive, si `notify=1`).
- Ingest public **non authentifié** mais fortement rate-limité (100 req/min/IP).

## 10. API admin (`/api/admin/*`)

Auth par shared secret : header `Authorization: Bearer $ADMIN_TOKEN`.

- `GET /stats`, `GET /users`, `GET /users/:id`, `GET /workspaces`, `GET /activity`
- `POST /users/:id/disable` · `/enable` · `/revoke-sessions`

## 11. Limitation de débit (par IP, fenêtre glissante mémoire)

| Scope | Limite |
|---|---|
| `/api/workspaces/*`, `/api/memberships/*` | 120 req / min |
| `/api/auth/*` (+ `/api/admin/*`) | 20 req / min |
| `/api/sync/*` | 60 req / min |
| Upgrade WS | 10 conn / min |
| `/api/hooks/*` (public) | 100 req / min |

Réponses 429 avec `Retry-After`. ⚠️ Mémoire seule → mono-instance ; passer à Redis si
un jour multi-instances. `TRUSTED_PROXY=true` est actif en prod depuis le 24/08 :
Caddy écrase le XFF (`header_up ... {remote_host}`), donc l'IP est fiable et non
falsifiable — ne pas retirer l'un sans l'autre.

## 12. Base de données

SQLite WAL + FK strictes + `synchronous=NORMAL` (tradeoff WAL recommandé) +
`busy_timeout=5000` (tolère les verrous transitoires, ex. lectures Litestream).
Tables : `users`, `workspaces`, `memberships`
(rôles CHECK), `invitations` (tokens expirants), `collections`, `environments`,
`folders` (versionnées, soft-delete), `hooklet_endpoints`, `hooklet_events`,
`hooklet_devices`, `password_resets`, `activity_log`, + colonnes sécurité
(`verification_code*` hashés, `token_version`, `disabled`, `failed_login_*`).

Le schéma est créé/migré au démarrage (`CREATE TABLE IF NOT EXISTS`) — pas d'outil de
migration séparé. Sauvegarder = copier le fichier `.db` (arrêter le service avant, ou
utiliser `.backup` de sqlite3 à chaud).

## 13. Sécurité — garde-fous en place

- Refus de démarrer en prod sans `AUTH_SIGNING_SECRET` ou avec `AUTH_BYPASS=true`.
- Compression gzip sur toutes les réponses HTTP (les payloads de poll sont les gros).
- Body limit **5 Mo** sur `/api/*` (compteur stream, pas seulement Content-Length).
- CORS allowlist stricte + credentials ; origin check identique sur l'upgrade WS.
- Erreur handler global : aucune stack trace ne fuit au client.
- Codes de vérification/reset **hashés** en base, canal test-only pour les lire
  (`NODE_ENV=test`), expiration, budget anti brute-force partagé entre endpoints.
- Comparaisons de signatures toujours en `timingSafeEqual`.

## 14. Déploiement AWS (production actuelle)

| Élément | Valeur |
|---|---|
| EC2 | Ubuntu 26.04, 1 Go RAM, IP publique `51.21.110.147` (ssh clé `reqly.pem`, user `ubuntu`) |
| Repo déployé | `/home/ubuntu/reqly-v1` (= GitHub `kevsi/reqly-v1`, branche `main`) |
| Service | `reqly-sync.service` (systemd, user dédié `reqly-sync`, drop-in hardening + `MemoryMax=300M`) |
| Binaire | `node dist/index.js`, node nvm v24.18.1, WorkingDirectory `~/reqly-v1/sync-server`, `NODE_ENV=production` |
| Reverse proxy | **Caddy** 80/443, `reqly.duckdns.org` → `127.0.0.1:4000` (+ `/monitor/api/*` → 4010). Le bloc `:4000` fait `header_up X-Forwarded-For {remote_host}` (XFF écrasé, non falsifiable) |
| Pare-feu | UFW actif : **22, 80, 443 uniquement** (le 4000 est fermé en public depuis le 24/08) |
| Rate-limit IP | `TRUSTED_PROXY=true` dans `.env` depuis le 24/08 — les quotas sont bien **par client**, pas partagés |
| Sauvegardes | 1) Local : cron quotidien 03:15 UTC (`/usr/local/bin/reqly-db-backup.sh`) → `/data/backups/*.db.gz`, `quick_check`, rotation 7 j, log `/var/log/reqly-backup.log`. 2) **Off-site continu** : service `litestream` → bucket R2 `reqly-litestream` (config `/etc/litestream.yml`, chmod 600). Restaurer : `sudo litestream restore -o /tmp/restored.db /data/reqly-sync.db` |
| Santé | `GET /health` → `{"status":"ok","db":true}` (503 si la DB ne répond plus) |
| Usage report | Cron quotidien 04:00 UTC → `/var/log/reqly-usage.log` (`/usr/local/bin/reqly-usage-report.sh`) : volumétries + répartition membres/workspace — la base de données pour caler les futurs seuils de facturation |
| Ping Supabase | Cron quotidien 05:17 UTC (`/usr/local/bin/supabase-ping.sh`) → évite la pause du projet free tier. Config : `/etc/supabase-ping.env` (chmod 600). Schéma Supabase exécuté le 25/08 (capture_sessions + monitor_configs + monitor_runs, RLS durci) |

Scripts présents dans `$HOME` du serveur :

- `pull-deploy.sh` — `git pull --ff-only` + comparaison stash (historique)
- `rebuild-restart.sh` — `pnpm install --frozen-lockfile` + `pnpm build` +
  `systemctl restart reqly-sync` (**penser à exporter le PATH nvm**, cf. §15)

Flux de déploiement standard : push local → GitHub → sur le serveur
`git pull --ff-only` puis `bash ~/rebuild-restart.sh` → vérifier `/health`.

⚠️ Depuis le 24/08, prod = Git exactement (`main` à `709a305` partout). Ne plus jamais
éditer les fichiers directement sur le serveur — c'est ce qui avait créé la dérive
corrigée lors de l'audit.

Autres services sur la machine : `reqly-monitor.service` (agent + API :4010, plafonné
`MemoryMax=160M`, `NODE_OPTIONS=--max-old-space-size=112`) et `caddy.service`.

## 15. Pièges connus (notes de session)

- **husky/pnpm introuvable en SSH non-interactif** : préfixer toute commande git côté
  serveur par `export PATH=/home/ubuntu/.nvm/versions/node/v24.18.1/bin:$PATH`.
- **PowerShell → ssh** : les guillemets doubles internes sont avalés ; les échapper
  `\"...\"` ou éviter les `$`/parenthèses dans les commandes distantes.
- **Encodage** : certains fichiers locaux ont eu du mojibake UTF-8 (`â€”` pour `—`).
  Les versions serveur/GitHub sont propres ; en cas de conflit bizarre, se fier au côté
  distant et vérifier le contenu réel (cf. cherry-pick du 24/08).
- **OOM passés sur l'EC2** (1 Go RAM) : d'où les plafonds systemd. Si `reqly-monitor`
  repasse en swap, investiguer avant d'augmenter encore.
- **Rate limiter en mémoire** : un restart remet les compteurs à zéro (acceptable).
- **`data/reqly-sync.db`** (prod : `/data/reqly-sync.db`) : unique source de vérité
  des comptes/workspaces. Double protection depuis le 24/08 : backup local quotidien +
  réplication Litestream continue vers R2. Ne jamais `cp` le fichier à chaud — utiliser
  `sqlite3 ".backup"` ou Litestream.

## 16. Checklist avant de pousser

1. `pnpm --dir sync-server test` (173 attendus) et `pnpm --dir sync-server typecheck`
2. Pas de secret dans le diff (le hook `check-secrets.mjs` tourne aussi en pre-commit)
3. Si migration implicite du schéma : penser aux bases existantes (création only —
   les nouvelles colonnes/tables doivent être ajoutées en `IF NOT EXISTS` /
   `ALTER TABLE` tolérant)
4. Après déploiement : `curl https://reqly.duckdns.org/health`

---

## 17. Procédure — rotation des clés R2 (Litestream)

À faire si les clés ont fuité (collees dans un chat, un ticket, un screenshot…)
ou périodiquement par hygiène. **Ordre impératif : nouveau token d'abord,
révocation de l'ancien en dernier** — sinon fenêtre sans sauvegardes.

### 1. Cloudflare — créer le nouveau token

- `dash.cloudflare.com` → **R2 Object Storage** → **Manage R2 API Tokens**
- **Create API Token** : permissions **Object Read & Write**, scope
  **Apply to specific buckets only** → `reqly-litestream`
- Noter les deux valeurs affichées : **Access Key ID** + **Secret Access Key**
  (l'Account ID, lui, ne change pas)

### 2. Serveur — mettre à jour `/etc/litestream.yml`

```bash
ssh -i reqly.pem ubuntu@51.21.110.147
sudo nano /etc/litestream.yml        # remplacer access-key-id et secret-access-key
sudo systemctl restart litestream
sleep 10
systemctl is-active litestream
sudo journalctl -u litestream -n 6 --no-pager | grep -E "replica sync|ERROR|error"
```

✅ Critère de réussite : lignes `replica sync` avec `txid.replica = txid.db`,
aucune erreur.

### 3. Vérifier la restauration avec les nouvelles clés

```bash
sudo litestream restore -o /tmp/test.db /data/reqly-sync.db \
  && ls -lh /tmp/test.db && sudo rm /tmp/test.db
```

(`PRAGMA quick_check` sur la copie si on veut être exhaustif.)

### 4. Révoquer l'ancien token

Seulement maintenant : **Manage R2 API Tokens** → supprimer l'ancien token.
Sans cette étape, la rotation est inutile.

> Règle générale : ne jamais coller ces clés dans un chat, ticket ou capture
> d'écran. `/etc/litestream.yml` est en chmod 600 root — c'est le seul endroit
> où elles vivent.

### 5. Procédure de reprise après désastre (mémo)

Nouveau serveur → installer Node 22+ et litestream (`.deb` GitHub) → recopier
`/etc/litestream.yml` (clés valides) → `sudo litestream restore -o /data/reqly-sync.db /data/reqly-sync.db`
→ cloner le repo, `pnpm install && pnpm build` dans `sync-server/` → restaurer
`.env` et l'unit systemd → basculer le DNS DuckDNS. Quelques minutes, zéro perte
de données.

---

## 18. Procédure — supprimer des utilisateurs

⚠️ Le schéma a des clés étrangères **sans cascade** (`workspaces.owner_id`,
`collections.updated_by/created_by`, `memberships.user_id`, …) : un `DELETE FROM
users` nu échouera dès que l'utilisateur est référencé. Deux approches selon le but.

### Cas A — Désactiver UN utilisateur en prod (recommandé)

Ne supprime rien : le compte ne peut plus se connecter (403 partout, cf. `requireAuth`),
et toutes les données qui le référencent restent cohérentes. Via l'API admin :

```bash
curl -X POST https://reqly.duckdns.org/api/admin/users/<USER_ID>/disable \
     -H "Authorization: Bearer $ADMIN_TOKEN"
# réactiver : /enable   ·   tuer ses sessions actives : /revoke-sessions
```

### Cas B — Purge complète des comptes de TEST (reset)

À n'utiliser que quand TOUT le contenu est jetable (users de test, workspaces,
collections… tout part). L'ordre des DELETE respecte les FK :

```bash
ssh -i reqly.pem ubuntu@51.21.110.147

# 0. Snapshot de sécurité avant destruction (local + répliqué vers R2)
sudo /usr/local/bin/reqly-db-backup.sh

# 1. Arrêter le service pendant la manipulation
sudo systemctl stop reqly-sync

# 2. Purge dans l'ordre des dépendances + récupération de l'espace
sudo sqlite3 /data/reqly-sync.db "
  DELETE FROM activity_log; DELETE FROM password_resets;
  DELETE FROM hooklet_events; DELETE FROM hooklet_devices; DELETE FROM hooklet_endpoints;
  DELETE FROM invitations; DELETE FROM memberships;
  DELETE FROM folders; DELETE FROM environments; DELETE FROM collections;
  DELETE FROM workspaces; DELETE FROM users;
  VACUUM;"

# 3. Redémarrer et vérifier
sudo systemctl start reqly-sync
curl -sS http://localhost:4000/health        # {"status":"ok","db":true}
sqlite3 /data/reqly-sync.db "SELECT COUNT(*) FROM users;"   # -> 0
```

Notes :
- La sauvegarde d'avant-purge reste disponible (backup local + historique R2) si
  besoin de revenir en arrière.
- Supprimer UN seul compte précis en gardant son contenu = re-rattacher d'abord ses
  entités à un autre user (`UPDATE ... SET owner_id/updated_by/created_by = <autre_id>`)
  avant le `DELETE` — à faire cas par cas, pas de commande générique fiable.

---

## 19. Stratégie de facturation (décisions actées — ne pas improviser)

> Décidé le 24/08/2026. Le coût serveur ne grimpe pas avec les inscrits mais avec les
> **membres simultanés d'un workspace** : c'est là et seulement là que se pose le paywall.
> Capacité de référence : cf. tableau « bon confort » (~500 simultanés sur t3.micro).

### 19.1 Les plans

| Plan | Prix cible | Sync incluse |
|---|---|---|
| **Free** | 0 € | Workspaces solo illimités · **1 workspace partagé, max 3 membres** · rétention activité 30 j · Hooklet : 1 endpoint / 100 events |
| **Pro** | ~5 €/mois | Solo avancé : rétention 90 j, 5 endpoints Hooklet, quotas rate-limit supérieurs |
| **Team** | ~8 €/membre/mois | Membres illimités par workspace, rôles avancés, rétention 1 an |

Règle mnémonique : **gratuit jusqu'à 3 humains dans un même workspace ; payant au 4ᵉ.**
Benchmarks concurrents : Postman 14 $/u, Insomnia 5 $/u, Hoppscotch ~19 $/u.

### 19.2 Les trois phases

| Phase | Déclencheur | Ce qu'on fait |
|---|---|---|
| **Bêta (actuelle)** | — | Tout gratuit, badge « bêta » visible (ne JAMAIS écrire « gratuit à vie »). On instrumente (§14 usage report) |
| **Manuel** | Quelqu'un veut dépasser les seuils Free | **Stripe Payment Link** généré à la main, quota ajusté manuellement en DB. Zéro code. Prix testés sur des vrais |
| **Automatisé** | ~5-10 payants manuels ou lancement public | Stripe Billing codé ; plans figés selon la data réelle du log d'usage ; early adopters grandfathered (« Fondateurs » : -50 % à vie ou Pro gratuit 1 an) |

Annoncer toute bascule payante **60 jours** à l'avance. Récompenser les premiers
utilisateurs plutôt que leur facturer rétroactivement.

### 19.3 Points d'enforcement côté sync-server (tout existe déjà)

| Limite | Où brancher le quota |
|---|---|
| Max membres/workspace | `routes/memberships.ts` + acceptation d'invitation (`invitations.used`) |
| Rétention `activity_log` / events | Cron de purge (même pattern que `/usr/local/bin/reqly-db-backup.sh`) |
| Nb endpoints Hooklet | Check dans `POST /api/hooklet/endpoints` avant insert |
| Quotas rate-limit par plan | `rate-limiter.ts` : `maxRequests` paramétré selon le plan |
| Mapping user → abonnement | Colonnes `plan` + `stripe_customer_id` sur `users`, webhook Stripe pour synchroniser |

### 19.4 Encaisser (dev indé, France)

- Début : **Merchant of Record** (Lemon Squeezy / Polar / Creem, ~5 % + 50 ¢) → TVA
  mondiale gérée par eux, zéro paperasse.
- Volume ou statut auto-entrepreneur sous le seuil de franchise TVA (~37 500 €/an) :
  **Stripe direct** (~1,5 % + 25 ¢) devient imbattable.

### 19.5 Ce qu'on NE fait PAS tant que le signal n'est pas là

- Pas de code Stripe/webhooks/portail client (l'automatisation se mérite au 5-10ᵉ payant).
- Pas de migration Supabase non plus : `capture_sessions` reste chez Supabase jusqu'à
  ce que la capture soit retravaillée ou que la facturation unifiée devienne nécessaire
  → à ce moment, table SQLite + routes Hono + Litestream la couvre gratuitement.
- Signaux à surveiller dans `/var/log/reqly-usage.log` : workspaces approchant 3 membres,
  volume polls/pushs, events Hooklet.
