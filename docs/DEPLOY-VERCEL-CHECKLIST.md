# Déploiement reqy-web sur Vercel — checklist

> Prérequis : commits poussés sur `github.com/kevsi/reqly-v1`.

## 1. Création du projet

1. Vercel Dashboard → **Add New → Project** → importer `kevsi/reqly-v1`
2. **Root Directory** : `reqy-web`
3. Framework : Next.js (auto-détecté ; `vercel.json` force déjà le build monorepo avec pre-build de `@reqly/shared`)

## 2. Variables d'environnement — AVANT le premier build

⚠️ Les définir en **Production + Preview**, disponibles au Build ET au Runtime.

### 🔴 Obligatoires (build échoue ou sécurité cassée sinon)

```
NEXT_PUBLIC_DEPLOYMENT_TYPE=web          # sinon test-runner/vm exposé publiquement
NEXT_PUBLIC_APP_URL=https://<app>.vercel.app   # OAuth redirects, CORS git/proxy
NEXT_PUBLIC_SYNC_URL=https://reqly.duckdns.org # backend sync (EC2)
AUTH_SIGNING_SECRET=<openssl rand -base64 32>  # requis AU BUILD (next.config.mjs throw)
```

### 🟠 Recommandées

```
TRUSTED_PROXY=true                       # rate-limit par vraie IP derrière le proxy Vercel
PROXY_SERVICE_TOKEN=<32+ chars>          # auth service→API
UPSTASH_REDIS_REST_URL=<…>               # rate-limit DISTRIBUÉ (sinon per-instance, inutile)
UPSTASH_REDIS_REST_TOKEN=<…>
GITHUB_OAUTH_CLIENT_ID / GITHUB_OAUTH_CLIENT_SECRET    # login + intégration GitHub
GITLAB_OAUTH_CLIENT_ID / GITLAB_OAUTH_CLIENT_SECRET    # intégration GitLab
SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY               # persistance capture/workspaces
COOKIE_SECRET=<32+ chars>                # chiffrement cookies clés API (fallback: PROXY_SERVICE_TOKEN)
CAPTURE_CLEANUP_SECRET=<32+ chars>       # si cron cleanup configuré
JINA_API_KEY                             # fallback /api/embed (sinon l'utilisateur fournit la sienne)
GITHUB_TOKEN                             # quota /api/github-import
```

### À NE PAS définir (desktop uniquement)

`BUILD_TARGET`, `TAURI_DEV_HOST`, `GITHUB_OAUTH_DESKTOP_*`, `GITLAB_OAUTH_DESKTOP_*`, `OLLAMA_PORT`

## 3. Après le premier déploiement

1. Noter l'URL `<app>.vercel.app` → si différente de `NEXT_PUBLIC_APP_URL`, la corriger et **redeployer** (les NEXT_PUBLIC_* sont inlinées au build)
2. GitHub App/OAuth : ajouter `https://<app>.vercel.app/api/github-auth/callback` aux callback URLs
3. GitLab : idem pour `/api/gitlab-auth/callback`
4. Sync-server EC2 : vérifier `GITHUB_OAUTH_REDIRECT_WEB` (allowlist) dans `~/reqly-v1/sync-server/.env` contient la nouvelle URL callback, puis `sudo systemctl restart reqly-sync`
5. Vérifier `/api/health` répond 200

## 4. Bascule finale (quand tout est validé)

- Domaine : Vercel → Project → Domains → ajouter `reqly-app.duckdns.org` (TXT/CNAME chez DuckDNS)
- EC2 : `sudo systemctl disable --now reqly-web.service` + retirer la règle Caddy `reverse_proxy localhost:3000` devenue morte

## Limites connues acceptées

| Limite                                 | Impact                                                             |
| -------------------------------------- | ------------------------------------------------------------------ |
| Body max 4.5 MB (plateforme)           | git push >4.5 MB via web proxy impossible (desktop OK)             |
| WASM tree-sitter non tracés            | github-import retombe en détection regex (dégradation silencieuse) |
| `output:'standalone'` dans next.config | ignoré/sans effet sur Vercel (utile au build desktop/Docker)       |
