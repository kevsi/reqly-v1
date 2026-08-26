# 📌 A SUIVRE — État du projet & prochaines actions (handoff session)

> Dernière mise à jour : 25/08/2026 · Fichier de reprise : lire ceci EN PREMIER
> lors d'une nouvelle session avant toute action sur l'infra.
> Doc technique principale : `sync-server/FONCTIONNEMENT.md`
> Checklist Oracle : `docs/CHECKLIST-ORACLE-REQY-WEB.md`

---

## 1. Topologie actuelle (faits stables)

| Élément | Valeur |
|---|---|
| Sync-server (prod API) | AWS EC2 t3.micro `51.21.110.147`, clé `reqly.pem`, user `ubuntu` |
| Repo déployé serveur | `/home/ubuntu/reqly-v1` (= GitHub `kevsi/reqly-v1`, branche `main`, HEAD `5c46973`) |
| Services systemd | `reqly-sync` (:4000, MemoryMax 300M) · `reqly-monitor` (:4010, MemoryMax 160M) · `caddy` · `litestream` |
| Domaine API | `https://reqly.duckdns.org` → Caddy → localhost:4000 (XFF écrasé, TRUSTED_PROXY=true) |
| Pare-feu | UFW actif : **22/80/443 uniquement** (4000 fermé au public) |
| Sauvegardes | Cron backup local 03:15 UTC (`/data/backups/`, rotation 7 j) + Litestream → R2 bucket `reqly-litestream` (clés dans `/etc/litestream.yml`) |
| Crons annexes | Usage report 04:00 UTC (`/var/log/reqly-usage.log`) · ping Supabase 05:17 UTC (`/etc/supabase-ping.env`) |
| DB prod | SQLite `/data/reqly-sync.db` — 14 tables (+2 internes Litestream) |
| Web app | **reqy-web sur Vercel** (plan Hobby) — données dynamiques chez Supabase |

## 2. Supabase — état & périmètre

- Schéma exécuté le 25/08 ✅ : `capture_sessions` + `monitor_configs` + `monitor_runs` (+ fix RLS/DROP POLICY appliqué = dernier 🔴 de l'audit 21/08 fermé)
- Périmètre STRICT : uniquement ces 3 tables, accès serveur via `service_role`. Pas d'auth Supabase.
- Décision §19.5 : on garde jusqu'à consolidation → migration des 3 tables vers sync-server le jour où capture/monitors sont retravaillées ou facturation unifiée.

## 3. 🔄 DÉCISION STRATÉGIQUE (25/08) — Desktop-first, web en retrait

> **Décision** : l'app desktop (Tauri) devient le chemin principal d'utilisation,
> pour le confort : pas de CORS, pas de proxy, pas de limite Vercel, réseau natif.
> Le déploiement web (Vercel) reste en place mais en rôle secondaire
> (landing, auth, capture cloud, monitors cron).

### Conséquences immédiates
| Sujet | Nouveau statut |
|---|---|
| Migration reqy-web vers Oracle | ⏸️ **EN PAUSE** — `docs/CHECKLIST-ORACLE-REQY-WEB.md` conservé, à relire si la priorité revient |
| Vercel Hobby non-commercial vs billing | ⏸️ Moins urgent : le billing visera d'abord le **desktop** (licences/clés) ; le web restera vitrine gratuite |
| TRUSTED_PROXY sur Vercel | 🟡 Recommandé quand même si le web garde des utilisateurs actifs (sinon 100 req/min PARTAGÉES entre tous — cf. audit moteur requêtes P2) |
| Audit moteur de requêtes (24-25/08) | Les findings **E1/E2/E3 s'appliquent AUSSI au desktop** : crash multipart (`decodeURIComponent`), timeout dur 30 s, toggle followRedirects ignoré par reqwest |

### Priorités desktop qui émergent
1. Corriger E1/E2/E3 dans `lib/request-executor.ts` (impacte natif directement)
2. **SSE via transport natif** (invokeTauriFetch / plugin-http) : le modal SSE actuel passe
   par le fetch du webview → soumis aux CORS ; en natif reqwest, plus aucune limite CORS
   ni timeout 5 min — c'est LE gain de confort attendu du desktop
3. Packaging/UX desktop : auto-update (updater Tauri), signature, taille binaire
4. Réplication Supabase/capture depuis desktop à auditer (mêmes clés service_role ?)

## 4. Actions en attente (côté utilisateur, hors code)

| Action | Statut | Note |
|---|---|---|
| Exécuter schéma Supabase | ✅ fait le 25/08 | SQL dans `lib/supabase.ts` + tables monitors |
| Remplir `/etc/supabase-ping.env` | ✅ fait (ping HTTP 200 validé) | |
| Générer/installer `MONITOR_CRON_SECRET` | ⏳ en attente | Bloque le cron monitors toutes les 5 min ; il me faut aussi l'URL Vercel de l'app pour câbler le cron EC2 |
| Supprimer l'enregistrement DNS `reqly-app` chez DuckDNS si devenu inutile | ⏳ | Après choix hébergeur final web |
| Badge « bêta » sur la landing | ⏳ | Ne jamais écrire « gratuit à vie » (cf. §19 facturation) |
| Commiter les docs de session | ⏳ au choix | `sync-server/FONCTIONNEMENT.md` + ce fichier + checklist Oracle (non-trackés volontairement) |

## 5. Triggers futurs (décisions déjà prises — ne rien anticiper)

| Signal | Action déclenchée |
|---|---|
| Un workspace approche 3 membres / demandes de rétention | Facturation manuelle via Stripe Payment Link (pas de code !) |
| ~5-10 payants manuels OU lancement public | Coder Stripe Billing (plans §19.1), grandfathering « Fondateurs » |
| RAM t3.micro saturée (>500 simultanés WS) | t3.small (+7 $) ou Hetzner CX22 (~4 €) |
| Capture/monitors retravaillées ou billing unifié | Migrer les 3 tables Supabase → sync-server, résilier Supabase |
| Premier euro encaissé | Quitter Vercel Hobby (CGU non-commercial) → Oracle (checklist) ou Vercel Pro |
| Avant un lancement public | Test de charge k6 (~300 sessions ouvertes) pour valider le tableau de capacité |

## 6. Commandes utiles (mémo rapide)

```bash
# Santé sync-server
curl https://reqly.duckdns.org/health
ssh -i reqly.pem ubuntu@51.21.110.147 'systemctl is-active reqly-sync reqly-monitor caddy litestream ufw'

# Déploiement sync-server depuis Git
ssh -i reqly.pem ubuntu@51.21.110.147
export PATH=/home/ubuntu/.nvm/versions/node/v24.18.1/bin:$PATH   # obligatoire en SSH non-interactif
cd ~/reqly-v1 && git pull --ff-only origin main && bash ~/rebuild-restart.sh

# Logs / mémoire
sudo journalctl -u reqly-sync -n 20 --no-pager
systemctl show reqly-sync -p MemoryPeak,MemoryMax

# Sauvegardes
sudo /usr/local/bin/reqly-db-backup.sh          # snapshot manuel (local + R2 via litestream)
sudo tail -3 /var/log/supabase-ping.log         # vérifier le ping anti-pause
tail -20 /var/log/reqly-usage.log               # usage report (calibrage pricing)
```

> Règle d'or rappelée : **plus jamais d'édition directe des fichiers sur le serveur** —
> tout passe par Git → push → pull. C'est la dérive prod/Git qui nous a coûté la
> première demi-journée de session.
