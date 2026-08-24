# Guide Supabase - Configuration Persistance HTTP Capture

**Objectif**: Configurer une base de données Supabase PostgreSQL pour stocker les sessions HTTP capturées de manière persistante.

**Durée estimée**: 10-15 minutes  
**Prérequis**: Compte Supabase gratuit (supabase.com)

---

## 1. Créer un Projet Supabase

### Étapes:
1. Allez sur [supabase.com](https://supabase.com)
2. Cliquez sur **"New Project"**
3. Entrez:
   - **Name**: `reqly-capture` (ou autre nom)
   - **Password**: Générez un mot de passe fort
   - **Region**: Sélectionnez votre région (ex: Paris, Frankfurt)
4. Cliquez **"Create new project"**
5. Attendez 2-3 minutes que le projet soit prêt

---

## 2. Récupérer les Credentials

### Accès à l'API Settings:
1. Une fois le projet créé, allez à **Settings > API**
2. Vous verrez 3 informations importantes:

#### a) Project URL
```
https://[PROJECT_ID].supabase.co
```
→ Copiez cette URL → `SUPABASE_URL` dans `.env.local`

#### b) Service Role Secret (Admin Key)
⚠️ **Important**: Il y a 2 clés:
- **`anon public`**: À NE PAS utiliser (accès public)
- **`service_role secret`**: ✅ **C'est celle-ci qu'on utilise** (accès admin)

Copiez la clé "service_role secret" → `SUPABASE_SERVICE_ROLE_KEY` dans `.env.local`

### Configuration .env.local:
```bash
# Supabase PostgreSQL — For persistent capture_sessions storage
SUPABASE_URL=https://[YOUR_PROJECT_ID].supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Exemple complet**:
```
SUPABASE_URL=https://abcdefg123456.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiY2RlZmdoaWprbG1ub3AiLCJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNjk5MDAwMDAwLCJleHAiOjE5OTkwMDAwMDB9dUFRdWttjOsLT8xvVfX9Q==
```

---

## 3. Créer la Table capture_sessions

### Accès à l'éditeur SQL:
1. Dans le projet Supabase, allez à **SQL Editor** (barre latérale)
2. Cliquez **"New Query"**
3. Copiez-collez le SQL ci-dessous
4. Cliquez **"Run"** (icône ▶)

### SQL - Créer la table:

```sql
-- ============================================================================
-- TABLE: capture_sessions
-- Description: Stockage persistant des sessions HTTP capturées
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.capture_sessions (
  -- Identifiants
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL DEFAULT 'anonymous',
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Détails de la requête HTTP
  request_method TEXT NOT NULL,
  request_url TEXT NOT NULL,
  request_headers JSONB,
  request_body TEXT,
  
  -- Détails de la réponse HTTP
  response_status INT NOT NULL,
  response_headers JSONB,
  response_body TEXT,
  
  -- Métadonnées de performance
  duration_ms INT NOT NULL DEFAULT 0,
  size_bytes INT NOT NULL DEFAULT 0
);

-- Ajout de commentaires
COMMENT ON TABLE public.capture_sessions IS 'Enregistrement persistant des sessions HTTP capturées via le proxy';
COMMENT ON COLUMN public.capture_sessions.id IS 'Identifiant unique de la session (UUID)';
COMMENT ON COLUMN public.capture_sessions.user_id IS 'Identifiant utilisateur (par défaut: anonymous)';
COMMENT ON COLUMN public.capture_sessions.request_method IS 'Méthode HTTP: GET, POST, PUT, DELETE, PATCH, etc.';
COMMENT ON COLUMN public.capture_sessions.request_url IS 'URL complète de la requête';
COMMENT ON COLUMN public.capture_sessions.request_headers IS 'En-têtes HTTP en JSONB (ex: {"Content-Type": "application/json"})';
COMMENT ON COLUMN public.capture_sessions.request_body IS 'Corps de la requête (texte brut ou JSON)';
COMMENT ON COLUMN public.capture_sessions.response_status IS 'Code HTTP de réponse (200, 404, 500, etc.)';
COMMENT ON COLUMN public.capture_sessions.response_headers IS 'En-têtes de réponse en JSONB';
COMMENT ON COLUMN public.capture_sessions.response_body IS 'Corps de la réponse';
COMMENT ON COLUMN public.capture_sessions.duration_ms IS 'Durée totale en millisecondes';
COMMENT ON COLUMN public.capture_sessions.size_bytes IS 'Taille totale en bytes';
```

✅ Vous devriez voir: **"Query executed successfully"**

---

## 4. Créer les Indexes (Optimisation)

**Pourquoi**: Accélère les requêtes de recherche et de tri par 10-100x

### Dans le même SQL Editor, créez une nouvelle query:

```sql
-- ============================================================================
-- INDEXES: Optimisation des requêtes
-- ============================================================================

-- Index principal: Recherche par user_id + tri par created_at
CREATE INDEX IF NOT EXISTS idx_capture_sessions_user_created 
  ON public.capture_sessions(user_id, created_at DESC);

-- Index secondaire: Tri uniquement par created_at
CREATE INDEX IF NOT EXISTS idx_capture_sessions_created_at 
  ON public.capture_sessions(created_at DESC);

-- Index pour les requêtes de cleanup (sessions anciennes)
CREATE INDEX IF NOT EXISTS idx_capture_sessions_cleanup 
  ON public.capture_sessions(created_at) 
  WHERE created_at < now() - INTERVAL '30 days';
```

✅ Résultat: **"Relation does not exist" est OK** (les indexes sont créés)

---

## 5. Configurer Row Level Security (RLS)

**Pourquoi**: Contrôler l'accès aux données (optionnel, mais recommandé pour la production)

### Query:

```sql
-- ============================================================================
-- RLS: Row Level Security - Contrôle d'accès
-- ============================================================================

-- Activer RLS
ALTER TABLE public.capture_sessions ENABLE ROW LEVEL SECURITY;

-- Policy: Service Role (backend) peut faire toutes les opérations
CREATE POLICY "Service role full access" 
  ON public.capture_sessions 
  FOR ALL 
  USING (true) 
  WITH CHECK (true);

-- Policy: Anonymous users voir que leurs propres sessions (optionnel)
-- CREATE POLICY "Users see own sessions" 
--   ON public.capture_sessions 
--   FOR SELECT 
--   USING (user_id = current_user_id());
```

✅ Résultat: **"Success"**

---

## 6. Tester la Connexion

### Vérifier que tout fonctionne:

1. Dans le **SQL Editor**, créez une nouvelle query:

```sql
-- Test de lecture
SELECT COUNT(*) as total_sessions FROM public.capture_sessions;

-- Afficher la structure
\d+ public.capture_sessions
```

2. Cliquez **"Run"**

**Attendu**:
```
count
------
    0
(1 row)
```

### Insérer un test:

```sql
-- Insérer une session test
INSERT INTO public.capture_sessions (
  request_method,
  request_url,
  request_headers,
  request_body,
  response_status,
  response_headers,
  response_body,
  duration_ms,
  size_bytes
) VALUES (
  'GET',
  'https://api.example.com/test',
  '{"User-Agent": "Test", "Accept": "application/json"}'::jsonb,
  '',
  200,
  '{"Content-Type": "application/json"}'::jsonb,
  '{"success": true}',
  125,
  256
)
RETURNING id, created_at;
```

✅ Vous verrez l'UUID inséré et le timestamp

---

## 7. Configuration Finale - .env.local

Mettez à jour votre fichier `.env.local` avec les valeurs réelles:

```bash
# Avant (placeholder)
SUPABASE_URL=REPLACE_WITH_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY=REPLACE_WITH_SUPABASE_SERVICE_ROLE_KEY

# Après (valeurs réelles)
SUPABASE_URL=https://abcdefg123456.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Vérifier:
```bash
cd reqy-web
pnpm typecheck  # Doit compiler sans erreur
pnpm test -- lib/__tests__/db.test.ts  # Doit passer 17/17 tests
```

---

## 8. Schéma Visuel

```
┌─────────────────────────────────────────────────────────┐
│ Supabase Project: reqly-capture                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Table: public.capture_sessions                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Columns:                                         │  │
│  │  • id (UUID) - PRIMARY KEY                       │  │
│  │  • user_id (TEXT) - DEFAULT 'anonymous'         │  │
│  │  • created_at (TIMESTAMP) - DEFAULT now()       │  │
│  │  • updated_at (TIMESTAMP) - DEFAULT now()       │  │
│  │  • request_method (TEXT) - GET/POST/PUT/...    │  │
│  │  • request_url (TEXT)                           │  │
│  │  • request_headers (JSONB)                      │  │
│  │  • request_body (TEXT)                          │  │
│  │  • response_status (INT)                        │  │
│  │  • response_headers (JSONB)                     │  │
│  │  • response_body (TEXT)                         │  │
│  │  • duration_ms (INT)                            │  │
│  │  • size_bytes (INT)                             │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  Indexes:                                               │
│  ├─ idx_capture_sessions_user_created                  │
│  ├─ idx_capture_sessions_created_at                    │
│  └─ idx_capture_sessions_cleanup                       │
│                                                         │
│  RLS: ENABLED                                          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 9. Prochaines Étapes

### Une fois Supabase configuré:

1. **Activer la persistance** dans l'application:
   ```bash
   # L'app détectera automatiquement SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY
   # et activera la persistance
   pnpm dev
   ```

2. **Vérifier la persistance**:
   - Capturez une requête HTTP via le proxy
   - Allez à Supabase → Table Editor → capture_sessions
   - Vous devriez voir la session capturée ✅

3. **Configurer le cleanup automatique** (optionnel):
   ```bash
   # Dans vercel.json, ajouter:
   "crons": [
     {
       "path": "/api/capture/cleanup",
       "schedule": "0 2 * * *"
     }
   ]
   ```

---

## 10. Troubleshooting

### Erreur: "SUPABASE_URL is not defined"
**Solution**: Vérifier que `.env.local` contient `SUPABASE_URL` (pas `SUPABASE_SERVICE_ROLE_KEY` seul)

### Erreur: "Invalid service role key"
**Solution**: Copier la clé **"service_role secret"**, pas la clé anon

### Erreur: "Relation 'capture_sessions' does not exist"
**Solution**: 
1. Vérifier que vous êtes dans le bon projet Supabase
2. Relancer la query SQL (section 3)

### Performances lentes (~1 sec par requête)
**Solution**: Vérifier les indexes (section 4)
```sql
SELECT * FROM pg_indexes WHERE tablename = 'capture_sessions';
```

### Base de données vide après redémarrage
**Solution**: C'est normal! Supabase ne persiste que les données explicitement insérées. Les sessions en mémoire sont perdues (c'est le fallback).

---

## 11. Monitoring

### Vérifier l'utilisation:
```sql
-- Nombre de sessions
SELECT COUNT(*) as total FROM public.capture_sessions;

-- Taille occupée
SELECT 
  pg_size_pretty(pg_total_relation_size('public.capture_sessions')) as table_size;

-- Sessions par jour
SELECT 
  DATE(created_at) as date,
  COUNT(*) as count
FROM public.capture_sessions
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Sessions à nettoyer (> 30 jours)
SELECT COUNT(*) as old_sessions
FROM public.capture_sessions
WHERE created_at < now() - INTERVAL '30 days';
```

---

## 12. Référence Rapide

| Élément | Valeur | Où trouver |
|---------|--------|-----------|
| Project ID | `[YOUR_PROJECT_ID]` | Supabase > Settings > General |
| Project URL | `https://[ID].supabase.co` | Supabase > Settings > API |
| Service Role Key | `eyJhbGc...` | Supabase > Settings > API |
| Database Name | `postgres` | Défaut Supabase |
| Username | `postgres` | Défaut Supabase |
| Table Name | `capture_sessions` | Créée dans SQL Editor |

---

## Support

Besoin d'aide?
- **Docs Supabase**: https://supabase.com/docs
- **SQL Éditeur**: Supabase > SQL Editor (test queries directement)
- **Logs**: Supabase > Database > Logs (erreurs)

Bonne configuration! 🚀


---

## N. Monitors (exécution planifiée cloud)

Tables pour le scheduler cloud des monitors (`/api/cron/monitors`). À exécuter dans
**SQL Editor** du même projet Supabase.

```sql
-- Configs de monitors (source de vérité cloud)
create table if not exists monitor_configs (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text not null,
  enabled boolean not null default true,
  interval_sec int not null default 1800 check (interval_sec >= 60),
  checks jsonb not null default '{}'::jsonb,
  webhook_url text,
  requests jsonb not null default '[]'::jsonb,
  next_run_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists monitor_configs_user_name_idx
  on monitor_configs (user_id, name);
create index if not exists monitor_configs_due_idx
  on monitor_configs (next_run_at) where enabled;

-- Historique d'exécution (plafonné applicativement)
create table if not exists monitor_runs (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null references monitor_configs(id) on delete cascade,
  at timestamptz not null default now(),
  status text not null check (status in ('pass','fail','degraded')),
  duration_ms int not null default 0,
  retries int not null default 0,
  checks jsonb not null default '[]'::jsonb
);
create index if not exists monitor_runs_monitor_at_idx
  on monitor_runs (monitor_id, at desc);

alter table monitor_configs enable row level security;
alter table monitor_runs   enable row level security;
```

> RLS activé sans policy = accès bloqué côté clients `anon` ; seules les routes
> serveur (service-role : cron + sync API) lisent/écrivent. Les utilisateurs
> passent par `/api/monitors` qui filtre par `user_id`.

### Variables d'environnement (Vercel / .env.local)

| Variable | Rôle |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Déjà requis (captures) — réutilisés |
| `MONITOR_CRON_SECRET` | Secret partagé du déclencheur cron. Générer : `openssl rand -hex 32` |

### Déclencheur externe (cron-job.org, gratuit)

1. Créer un job HTTP **GET** sur `https://<ton-domaine>/api/cron/monitors`
2. Header : `Authorization: Bearer <MONITOR_CRON_SECRET>`
3. Intervalle : toutes les **5 minutes**
4. Désactiver les notifications d'échec cron-job.org si tu veux éviter le bruit
   (un tick raté est rattrapé par le suivant — claim atomique par `next_run_at`).

### Sync depuis l'app

- `PUT /api/monitors` `{ "monitors": [ {name, enabled, interval_sec, checks, requests[], webhook_url?} ] }`
  avec header `Authorization: Bearer <session>` → upsert par `(user_id, name)`
- `GET /api/monitors` → `{ monitors, runs }` (runs = 500 derniers, tous monitors confondus)

Contraintes serveur : webhooks en **https:// uniquement**, requêtes plafonnées à
100/monitor, corps ≤64 Ko, headers ≤30. SSRF : mêmes gardes que `/api/proxy`.
