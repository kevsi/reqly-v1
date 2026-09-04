# Audit de sécurité — `reqly-sync-server`

> **Date :** 2026-09-03 · **Périmètre :** `sync-server/src/` (21 fichiers, 4 077 lignes) + config de déploiement (`FONCTIONNEMENT.md`)
> **Méthode :** lecture intégrale de chaque fichier ; passage systématique des motifs SQL (toutes les requêtes), du cycle de vie des tokens, de l'upgrade WebSocket, de l'ingest webhook public, des limites et des fuites d'information. Les deux bugs marqués « confirmé » l'ont été par **exécution réelle** (script `tsx` sur le schéma SQLite complet, `foreign_keys = ON`).

---

## Verdict global

- **Injection SQL : aucune.** 100 % des requêtes sont préparées avec des valeurs bindées (`?`). Les trois interpolations `${}` restantes dans le code sont des **littéraux internes**, jamais des entrées utilisateur :
  - `db.ts:163-165` `ensureColumn()` — table/colonne/définition passés en dur par les 12 appels de migration ;
  - `sync-engine.ts:235,297` — `${table}`/`${idField}` issus de `tableFor()`, mappage fermé derrière un `z.enum()` ;
  - `admin.ts:87,105` — `${where}` est une chaîne littérale choisie par un booléen, les valeurs (`%query%`) sont bindées.
- **Auth solide :** HMAC maison avec `timingSafeEqual`, scrypt pour les mots de passe, codes de vérification hashés (HMAC keyed), révocation par `token_version`, lockout persistant, anti-énumération sur signup/login/forgot, invitations single-use transactionnelles, `AUTH_BYPASS` refusé en prod, `ADMIN_TOKEN` fail-closed.
- **Mais :** 2 bugs fonctionnels confirmés (dont un qui casse la suppression de workspace en prod) et une série de faiblesses P2/P3 détaillées ci-dessous.

---

## 🔴 P1 — Bugs confirmés par exécution

### 1. Suppression de workspace impossible dès qu'il y a de l'activité (`routes/workspaces.ts:309-341`)

Le `DELETE /:id` purge `folders → environments → collections → memberships → invitations → workspaces` mais **oublie `activity_log`**, dont la colonne `workspace_id` porte une FK `REFERENCES workspaces(id)` (`db.ts:190`) avec `foreign_keys = ON`.

**Preuve (exécution sur le schéma réel) :**

```
DELETE workspace avec activity: ECHEC -> FOREIGN KEY constraint failed
```

Or `activity_log` se remplit dès qu'un workspace vit (`resource.created` sur chaque push, `member.joined`, `invitation.created`…). **Tout workspace ayant une seule ligne d'activité est indéletable → 500.** Le test existant (`routes-workspaces.test.ts`) ne le voit pas car il ne seed pas d'activité.

**Fix :** ajouter `DELETE FROM activity_log WHERE workspace_id = ?` dans le transaction (ou `ON DELETE CASCADE` + migration). +1 test avec activité seedée.

### 2. La re-vérification d'expiration WebSocket est inversée (`routes/ws.ts:73-77, 137-149`)

Le timer 60 s évalue `expired = session?.exp != null && session.exp < Date.now()` :

- **Sessions ticket (clients web actuels)** : `session.exp` = expiration du **ticket** (30 s, `ws.ts:76`). La connexion est donc fermée (`close 4001`) au premier tick, **~60 s après la connexion** — alors que le commentaire du code dit explicitement l'inverse (« le ticket est éphémère, la session, elle, reste valide »). Résultat : reconnexion WS permanente des clients web.
- **Sessions cookie/Bearer** : le payload porte `expires` (7 j), jamais `exp` → `expired` est toujours `false` → **la connexion survit à l'expiration du token de session** (seule la révocation par `token_version` la coupe). Le contrôle voulu par le commentaire (« re-validate the token against its embedded expiry ») n'a jamais lieu.

**Fix :** ne pas propager `exp` du ticket dans la session ; pour les sessions cookie, re-vérifier `expires` (garder le token et appeler `parseSessionCookie`) dans le timer.

---

## 🟠 P2 — Faiblesses de sécurité

### 3. `updatedAt` du push entièrement client, non borné (`routes/sync.ts:25`)

`z.number()` accepte **`Infinity` et `1e15`** (vérifié par exécution). Le moteur de sync est en LWW sur `updatedAt` (`sync-engine.ts:276`) : un client (buggé ou malveillant, n'importe quel `editor`) qui pousse `updatedAt: 1e15` **gèle l'entité indéfiniment** — tout push légitime ultérieur est rejeté en conflit. C'est aussi une pollution des curseurs de poll.
**Fix :** `z.number().int().min(0).max(Date.now() + MARGE)` (marge ~60 s) au parsing, ou clamp serveur.

### 4. Secrets des endpoints hooklet en clair en base (`db.ts:106`, `routes/hooklet-hooks.ts:40-50`)

`hooklet_endpoints.secret` est stocké en texte et comparé en clair. Un dump de la base (backup, lecture Litestream) donne à l'attaquant de quoi **forger des webhooks sur tous les endpoints**. Les codes de vérification, eux, sont bien hashés — même traitement à appliquer (HMAC keyed, comme `hashCode()`).

### 5. Maps anti-abus jamais purgées (`routes/auth.ts:39-44`, `routes/workspaces.ts:107`)

`codeAttempts`, `resetAttempts`, `resendCooldowns`, `forgotCooldowns` (clé = **IP**, donc 1 entrée par IP visitante) et `inviteTimestamps` sont des `Map` sans eviction. Contrairement à `InMemoryRateLimiter` qui a un `sweep()` (`rate-limiter.ts:66-73`), celles-ci grossissent sans limite → **fuite mémoire / DoS par rotation d'IP** sur un service plafonné `MemoryMax=300M`.

### 6. `/api/hooklet/*` sans rate limiter (`index.ts:107-128`)

Les limiters sont montés sur workspaces/memberships/auth/sync/hooks-public/admin — **pas** sur la surface utilisateur hooklet (endpoints, events, replay, devices, test-push). Un compte peut y marteler (ex. `/devices/test` → boucle d'envoi Expo).

### 7. Réassignation silencieuse des tokens de device push (`routes/hooklet.ts:292-307`)

`POST /devices` sur un `expo_push_token` **déjà enregistré par un autre utilisateur** le bascule vers l'appelant (`UPDATE ... SET user_id = ?`). Quiconque obtient un token (log mobile, screenshot) **détourne les notifications webhook** de la victime. Fix : refuser le vol (403 si `user_id` différent), ou exiger une preuve de possession.

---

## 🟡 P3 — Mineur / défense en profondeur

8. **Injection HTML dans l'email de bienvenue** (`email.ts:171`) : `name` (libre à l'inscription, ≤ 80 car.) est interpolé sans échappement dans le HTML → contenu/phishing injectable dans l'email. Échapper (`escapeHtml`).
9. **Modulo bias dans les codes** (`email.ts:119-126`) : `bytes[i] % 10` alors que le commentaire affirme « rejection loop » — les chiffres 0-5 sont surreprésentés (256 % 10 = 6). Faible impact (5 tentatives max) mais le commentaire est faux.
10. **`source_ip` hooklet lu depuis XFF sans le garde `TRUSTED_PROXY`** (`hooklet-hooks.ts:86-87`) : incohérent avec `clientIp()` ; l'IP stockée est falsifiable par le sender.
11. **Oracles d'énumération résiduels** : `/verify` et `/reset-password` renvoient `attemptsRemaining` (`auth.ts:322,555`) — le `/verify-reset-code` l'a corrigé (`:484`), pas les deux autres ; timing `/login` (scrypt court-circuité pour un email inconnu → réponse ~100 ms plus rapide) ; `404` vs `401` sur le slug hooklet distingue endpoint existant/inexistant.
12. **Membership non re-vérifiée sur WS** : un membre retiré du workspace continue de recevoir les broadcasts jusqu'à la révocation de son token (7 j max).
13. **Rétention** : `activity_log`, `password_resets` (rows expirés), `invitations` (non consommées) ne sont jamais purgés ; `hooklet_events` conserve bodies + IP (borné à 200/endpoint, OK). Le §19.3 de `FONCTIONNEMENT.md` prévoit ces purges — non implémentées.
14. **Divers** : comparaison `a.length === b.length` avant `timingSafeEqual` (admin token, webhook secret) fuit la longueur du secret (négligeable) ; `issueSession` marque `provider: "password"` même pour OAuth (cosmétique) ; `id`/`name` des entités sans limite de longueur propre (bornés par le body 5 Mo).

---

## ✅ Points forts vérifiés (à conserver)

- Zéro concaténation SQL utilisateur ; `PRAGMA`/`ALTER` réservés aux migrations internes.
- Séparation de domaine HMAC (session ≠ tickets WS, `ws-ticket.ts:36-42`) + test ajouté.
- Codes de vérification/reset hashés (HMAC keyed), TTL, budget de tentatives, invalidation.
- Lockout login persistant en base, générique côté client ; anti-énumération soignée (400 génériques).
- `bodyLimit` 5 Mo en compteur de stream (chunked-safe) ; `maxPayload: 4096` WS ; `bufferedAmount > 1 Mo → terminate`.
- XFF accepté uniquement derrière `TRUSTED_PROXY` (et Caddy écrase le header) ; origin check identique HTTP et WS.
- Invitations single-use via `UPDATE ... WHERE used = 0` en transaction ; isolation tenant + `baseVersion` (concurrence optimiste) ; garde anti-DoS push (500/512 Ko) + tests.
- Error handler global sans stack trace ; `safeParseJson` sans fuite de schéma.
- CORS allowlist + credentials, wildcard refusé silencieusement non-credentials ; guards de boot (secret, bypass).

---

## Ordre de correction recommandé

| # | Finding | Effort |
| --- | --- | --- |
| 1 | P1-1 purge `activity_log` dans le DELETE workspace | XS (1 ligne + test) |
| 2 | P1-2 logique `exp`/`expires` du recheck WS | S |
| 3 | P2-3 bornes `updatedAt` | XS |
| 4 | P2-5 sweep des maps anti-abus | S |
| 5 | P2-4 hash des secrets hooklet (+ migration) | M |
| 6 | P2-6 limiter `/api/hooklet/*` · P2-7 devices | XS/S |
| 7 | P3 (8-13) | S au total |
