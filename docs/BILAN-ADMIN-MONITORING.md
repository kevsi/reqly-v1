# Bilan de session — Monitoring & Console d'administration Reqly

> Date : août 2026 · EC2 `ubuntu@51.21.110.147` · domaine `https://reqly.duckdns.org`

---

## 1. reqly-monitor (observabilité infrastructure)

Projet standalone dans `C:\Users\alexanders\Documents\Workspace\reqly-monitor` — **zéro modification du code du sync-server** pour le monitoring.

### Architecture

```
Caddy (logs JSON stdout)
   └── agent (tail offset-sûr + métriques hôte) → SQLite (monitor.db, WAL)
         └── API Hono :4010 (/api/logs, /api/metrics, /api/health)
               └── Caddy https://reqly.duckdns.org/monitor/* → 127.0.0.1:4010
                     └── Dashboard statique (Next.js export) sur Vercel
```

### Composants

| Dossier      | Rôle                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| `agent/`     | Tail des logs Caddy (`OffsetTailer` résistant aux rotations), parse JSON, snapshots CPU/RAM/disque toutes les 15 s |
| `api/`       | Hono + `node:sqlite` (aucune dépendance native). Auth Bearer `ADMIN_TOKEN` timing-safe fail-closed                 |
| `dashboard/` | Interface Tremor, déployée sur Vercel                                                                              |

### Endpoints monitor (auth Bearer requis)

- `GET /api/logs?since=&status=&limit=` — logs d'accès récents
- `GET /api/metrics?range=1h|24h|7d` — agrégats :
  - `series[]` **zéro-remplie** (aucun trou interpolé) avec par bucket : `count`, `avgMs`, `p95Ms`, `errorRatePercent`
  - scalaires globaux : `errorRatePercent`, `latencyAvgMs`, `latencyP95Ms`
  - largeur de bucket adaptative : 1 min (≤2 h) / 5 min (24 h) / 1 h (7 j)
- `GET /api/health` — dernier snapshot hôte, fraîcheur des logs, ping sync-server

### Déploiement EC2

- Service systemd : `reqly-monitor.service` (agent + API en un seul processus)
- Code : `/home/ubuntu/reqly-monitor/`
- Token : `ADMIN_TOKEN` dans `/home/ubuntu/reqly-monitor/.env`
- Caddy : route `handle /monitor/api/*` avec `uri strip_prefix /monitor` → `127.0.0.1:4010`

### Corrections UI dashboard monitor (session)

- `.trim()` des identifiants à la saisie et au chargement (les copier-coller pollués causaient des 401 permanents)
- Bouton **Déconnexion** (avant : impossible de changer les credentials sans DevTools)
- Message d'erreur explicite sur 401
- Redesign : sparklines, jauges circulaires SVG, distribution des codes HTTP

---

## 2. API Admin du sync-server (nouveau)

> ⚠️ Modèle d'auth différent des sessions utilisateurs : secret partagé opérateur.
> Fichiers modifiés dans `sync-server/` :

| Fichier                              | Changement                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `src/routes/admin.ts`                | **Nouveau** — toute la surface `/api/admin/*`                               |
| `src/auth.ts`                        | `requireAuth` rejette les comptes `disabled = 1` (403 `Account disabled`)   |
| `src/db.ts`                          | Migration `ensureColumn("users", "disabled", "INTEGER NOT NULL DEFAULT 0")` |
| `src/index.ts`                       | Montage `app.route("/api/admin", admin)` derrière `authLimiter`             |
| `src/__tests__/routes-admin.test.ts` | **Nouveau** — 7 tests                                                       |

### Sécurité

- Bearer `ADMIN_TOKEN`, comparaison `timingSafeEqual`, **fail-closed** si la variable est absente
- `disable` = soft-ban + bump `token_version` → **toutes les sessions de l'utilisateur meurent instantanément** (les tokens intègrent `ver` vérifié contre `users.token_version`)
- Rate-limit : même limiter strict que `/api/auth/*`

### Endpoints

| Méthode | Route                                    | Description                                                                                        |
| ------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| GET     | `/api/admin/stats`                       | Users (total/vérifiés/OAuth/désactivés), workspaces, memberships, invitations actives, collections |
| GET     | `/api/admin/users?query=&limit=&offset=` | Liste + recherche email/nom, provider, nb workspaces, dernière activité, statut lockout            |
| GET     | `/api/admin/users/:id`                   | Détail + memberships rattachés                                                                     |
| POST    | `/api/admin/users/:id/disable`           | Soft-ban + révocation des sessions                                                                 |
| POST    | `/api/admin/users/:id/enable`            | Réactivation                                                                                       |
| POST    | `/api/admin/users/:id/revoke-sessions`   | Déconnexion forcée                                                                                 |
| GET     | `/api/admin/workspaces?limit=&offset=`   | Liste + owner, nb membres, nb collections                                                          |
| GET     | `/api/admin/activity?limit=&offset=`     | Journal d'activité (joint actor + workspace)                                                       |

Tests : **173 passent** au total sur le sync-server (dont les 7 nouveaux).

---

## 3. reqly-admin (console d'administration)

Nouvelle app dans `apiPlayground-main/reqly-admin/` — Next.js 16 + React 19 + Tailwind v4 + **shadcn/ui**, design system **copié de reqy-web** (mêmes tokens oklch émeraude light/dark, composants Radix identiques, recharts).

### Sections

- **Vue d'ensemble** — KPIs (users, workspaces, collections, invitations), trafic 1h, santé sync-server, jauges CPU/RAM/disque, activité récente (refresh 30 s)
- **Monitoring** — graphiques recharts : trafic (aire), latence moyenne vs p95 (lignes), taux d'erreur (barres), logs d'accès, plages 1h/24h/7d
- **Utilisateurs** — recherche live (debounce 300 ms), badges statut (Actif / Non vérifié / Verrouillé / Désactivé / OAuth), actions : détails, révoquer sessions, désactiver/réactiver (avec confirmation toast)
- **Workspaces** — cartes avec owner, membres, collections
- **Activité** — journal coloré par type d'action
- **Réglages** — configuration des deux APIs (base URL + token chacun), test de connexion intégré, thème clair/sombre, déconnexion

### Notes techniques

- Export statique (`output: "export"`) déployé sur Vercel
- Config stockée en `localStorage` (clé `reqly_admin_config`) — surface opérateur uniquement
- Install via **npm** (le `.npmrc` racine impose `min-release-age=7` côté pnpm, contourné par un `.npmrc` local)

---

## 4. Credentials & accès

### Sync-server (API admin)

```
Base URL : https://reqly.duckdns.org
Token    : voir /home/ubuntu/reqly-v1/sync-server/.env  (ADMIN_TOKEN=…)
           — ne jamais commiter la valeur ; régénérer via openssl rand -hex 24
```

> ⚠️ Une version antérieure de ce document contenait le token en clair.
> Si elle a été partagée, faire une rotation du ADMIN_TOKEN sur l'EC2
> (`~/reqly-v1/sync-server/.env` + `systemctl restart reqly-sync`) et dans
> reqly-admin → Réglages.

### Monitoring

```
Base URL : https://reqly.duckdns.org/monitor
Token    : voir /home/ubuntu/reqly-monitor/.env  (ADMIN_TOKEN=…)
```

### Dashboards Vercel

- Console admin : https://reqly-admin-6e3ohjpu1-alexs-projects-eea0eec5.vercel.app
- Dashboard monitor : https://dashboard-six-ashy-41.vercel.app

> Dans reqly-admin, renseigner les deux paires base+token à l'écran de connexion ou dans Réglages → « Enregistrer & tester ».

### Serveur EC2

```
ssh -i reqly.pem ubuntu@51.21.110.147
```

| Service                 | État       | Détail                                                                       |
| ----------------------- | ---------- | ---------------------------------------------------------------------------- |
| `reqly-sync.service`    | ✅ running | `node dist/index.js` port 4000, env `/home/ubuntu/reqly-v1/sync-server/.env` |
| `reqly-monitor.service` | ✅ running | agent + API port 4010                                                        |
| `reqly-web.service`     | ❌ failed  | SSR reqy-web (non utilisé si front statique)                                 |

Déploiement sync-server :

```bash
bash ~/rebuild-restart.sh   # pnpm install --frozen-lockfile && pnpm build && restart
```

Vérification rapide API admin :

```bash
curl -s https://reqly.duckdns.org/api/admin/stats \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

Dernière réponse connue : `{"users":12,"verifiedUsers":6,"oauthUsers":0,"disabledUsers":0,"workspaces":1,"memberships":2,"pendingInvitations":2,"collections":8}`

---

## 5. Travaux antérieurs rappelés (sessions précédentes)

- **GitHub OAuth** web + desktop Tauri (PKCE desktop, serveur loopback 18234, ACL Tauri)
- **Audit sécurité** sync-server corrigé : vérification access_token OAuth (prise de contrôle de compte), allowlist redirect_uri, compteur tentatives reset-password, révocation sessions après reset, PKCE anti-race loopback, hash SHA-256 des codes, rotation secrets
- **Fonctions collaboratives workspace** : invitations single-use, choix du rôle à l'invitation, rate-limit anti-spam, transfert de propriété, activity_log, fix IDOR cross-workspace
