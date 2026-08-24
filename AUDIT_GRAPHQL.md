# Audit de sécurité — Fonctionnalité GraphQL (reqly)

**Date :** 2026-08-21

---

## ⚠️ Constat préalable : il n'existe PAS d'endpoint GraphQL serveur dans ce projet

La recherche exhaustive (dépendances, routes `app/api/**`, sync-server, Rust) confirme :
**aucun serveur GraphQL** (ni Apollo, ni Yoga, ni Mercurius, ni `/api/graphql`).

Le projet possède en revanche un **client GraphQL complet** (équivalent GraphiQL/Postman) :
- `lib/graphql/{execute,introspect,subscribe,codegen,format}.ts`
- `components/graphql/*` (19 composants : éditeur, builder, schéma docs, diff, subscriptions)
- Dépendances : `graphql@^16` (parse/print/buildClientSchema), `cm6-graphql` (éditeur)

Les requêtes sont envoyées à des **API GraphQL tierces** via le proxy existant `/api/proxy`.
En conséquence, les attaques classiques contre **notre** serveur (introspection de notre API,
depth/complexity DoS, batching, bypass d'auth sur nos résolveurs) **ne sont pas applicables** —
il n'y a pas de résolveurs à protéger. L'audit ci-dessous évalue donc le client réel contre
ces mêmes catégories.

---

## 1. Évaluation des vulnérabilités (sur ce qui existe réellement)

| Catégorie | Applicable ? | Verdict |
|---|---|---|
| **Introspection abuse** | N/A côté serveur ; le client **émet** volontairement des requêtes d'introspection (`lib/graphql/introspect.ts`, 6 niveaux `ofType`) vers l'endpoint tiers pour les docs/autocomplétion | ✅ Comportement voulu ; risque nul pour notre infra |
| **Query depth / complexity (DoS)** | Les requêtes transitent par `/api/proxy` : **SSRF complet** (blocage IP privées, DNS pinning, redirect `manual`) + **rate-limit 100 req/min** (bucket global) + gate par cookie visiteur | ✅ Protégé par le proxy existant (mêmes protections que REST) |
| **Batching attacks** | N/A — pas de serveur GraphQL | ✅ Sans objet |
| **Authorization bypass** | Le client transmet les headers fournis par l'utilisateur (Authorization, cookies…) à l'endpoint tiers via le proxy — par design (l'utilisateur teste SON endpoint avec SES tokens) | ✅ Par design ; pas de contournement possible de notre côté |
| **Injection** | La requête est envoyée telle quelle à l'endpoint tiers (comportement attendu d'un client API). Aucune injection dans NOS systèmes : `JSON.parse` du corps dans try/catch, génération de code via `JSON.stringify` | ✅ Aucune injection interne |
| **XSS** | Composants GraphQL : **aucun `dangerouslySetInnerHTML`** — rendu `<pre>`/textes échappés par React (vérifié : response-viewer, codegen, schema-doc, diff) | ✅ |

## 2. Findings réels

### 🔶 MEDIUM — Les subscriptions WebSocket contournent entièrement le proxy
**Fichier :** `reqy-web/lib/graphql/subscribe.ts:28`

```ts
const wsUrl = endpoint.replace(/^http/i, "ws");
const ws = new WebSocket(wsUrl, "graphql-transport-ws");
```

Le navigateur se connecte **directement** à l'endpoint `ws://…` : pas de passage par
`/api/proxy` → **aucune** des protections du proxy ne s'applique (SSRF, rate-limit,
auth visiteur). L'URL provient de la saisie utilisateur (non validée pour ws — seuls
`http/https` sont validés par `validateGraphqlUrl`), donc un utilisateur peut ouvrir une
subscription vers `ws://169.254.169.254`, `ws://192.168.x.x`… depuis son propre navigateur.
Risque limité (action volontaire de l'utilisateur sur sa machine), mais incohérence de
posture : **HTTP = protégé par le proxy, WS = connexion directe**.
→ Recommandation : router les subscriptions via le proxy (SSE/`/api/proxy-sse`),
ou au minimum valider l'hôte (mêmes règles que `validateGraphqlUrl`).

### 🔶 BASSE — Messages d'erreur techniques en anglais
**Fichiers :** `lib/graphql/execute.ts:56`, `lib/graphql/introspect.ts:127`

- `Proxy request failed (HTTP 502)` — expose le statut HTTP brut
- `Invalid proxy response` — message interne sans explication
- `WebSocket error` (subscribe.ts:58) — générique mais incompréhensible
- Erreurs affichées telles quelles dans l'UI (banner du `graphql-tabs-manager`)

Aucune fuite de stack trace ni de schéma interne (bon point), mais des messages peu
actionnables pour un utilisateur lambda. Les libellés UI sont i18n (`graphql.*`),
pas les erreurs d'exécution.

### 🔶 BASSE — JSON non-JSON silencieusement avalé
`execute.ts:62-67` : si le corps n'est pas du JSON valide, `graphqlJson` reste `{}` et
l'appelant voit une réponse vide sans explication (ex. : un endpoint qui renvoie du HTML
d'erreur, ou une page de login au lieu de JSON).

### 🔶 INFO — Divers
- `endpointHash()` (introspect.ts:144) : hash faible (djb2-like) — utilisé uniquement
  comme clé UI locale pour le cache de schéma → acceptable
- `subscribe.ts` : messages malformés ignorés silencieusement (catch vide) — OK ;
  la méthode `send()` envoie `{type:"data"}` (non standard graphql-ws) — utilisée
  uniquement en interne
- **Mixed content** : page en HTTPS + subscription `ws://` (non chiffré) → bloqué par
  le navigateur, ou autorisé en dev — à noter pour les utilisateurs du mode web

## 3. Analyse de couverture

| Bonne pratique GraphQL serveur | Présent ? | Commentaire |
|---|---|---|
| Limitation de profondeur de requête | N/A | Pas de serveur GraphQL |
| Analyse de complexité / aliases | N/A | Idem |
| Persisted queries | N/A | Idem |
| Auth sur introspection | N/A | Idem |
| Échappement des sorties (XSS) | ✅ | React escape, pas de `dangerouslySetInnerHTML` |
| Protection SSRF du chemin HTTP | ✅ | `/api/proxy` : CIDR privés, DNS pinning, redirect manual |
| Rate limiting | ✅ | 100 req/min global (avec ses limites connues — cf. audit capture) |
| Validation de l'URL cible | ⚠️ Partiel | `http/https` seulement ; `ws/wss` non validés |
| Erreurs non fuiteuses (pas de stack) | ✅ | Aucune stack trace exposée |
| Erreurs user-friendly | ⚠️ | Anglais technique, statuts HTTP bruts |

**Zones oubliées :** la validation de l'hôte pour les **subscriptions** (point MEDIUM),
et la traduction/softening des erreurs d'exécution.

## 4. Revue des erreurs (Error Handling)

| Scénario | Message actuel | Qualité |
|---|---|---|
| Endpoint injoignable | `Proxy request failed (HTTP 502)` | ⚠️ Technique, anglais |
| Endpoint non-GraphQL (HTML) | Vue vide (`{}`) sans message | ❌ Silence trompeur |
| Erreurs GraphQL (errors[]) | Affichées joliment dans le response viewer (JSON) | ✅ |
| Introspection refusée par le tiers | `Proxy request failed (HTTP 400/403)` | ⚠️ Technique |
| Erreur WebSocket | `WebSocket error` | ⚠️ Générique |
| Erreur réseau navigateur | gérée par le viewer (`Network Error`) | ✅ |

**Aucune fuite de stack trace / chemins internes / schéma** — l'erreur la plus
"parlante" est un statut HTTP, ce qui est acceptable pour un outil de développement,
mais améliorable (proposition ci-dessous).

## 5. Recommandations

1. ~~**Subscriptions via le proxy** (ou validation d'hôte ws/wss identique à http/https)
   — supprime le contournement de posture.~~ ✅ **CORRIGÉ (2026-08-21)** — `validateSubscriptionEndpoint()`
   (`lib/graphql/errors.ts`) : schéma http/https/ws/wss validé, URL malformée rejetée,
   mixed content (ws:// sur page https) refusé avec message clair ; `subscribe.ts`
   remonte l'erreur via `onMessage` et renvoie un handle no-op. La solution complète
   (routage des subscriptions via le proxy serveur) reste documentée comme évolution.
2. ~~**Erreurs conviviales** : mapper `Proxy request failed (HTTP x)` → messages français.~~ ✅ **CORRIGÉ**
   — `friendlyGraphQLError()` (`lib/graphql/errors.ts`) appliqué à `execute.ts`, `introspect.ts`
   et `subscribe.ts` : 401/403/404/429/5xx avec messages français actionnables, détail
   technique conservé en fin de message.
3. ~~**Signaler les réponses non-JSON** au lieu de renvoyer `{}` silencieusement.~~ ✅ **CORRIGÉ**
   — `execute.ts` retourne désormais une erreur explicite avec un aperçu (300 caractères)
   de la réponse reçue.
4. **Checklist serveur** si un vrai endpoint GraphQL est un jour ajouté — voir ci-dessous.

### Checklist serveur GraphQL (si un endpoint est ajouté au projet)

> Le projet est aujourd'hui un **client** GraphQL. Si un endpoint serveur est un jour
> ajouté (ex. : API publique du sync server), appliquer ces contrôles **avant** mise en prod :

**DoS / Complexité**
- [ ] **Limitation de profondeur** de requête (ex. max depth 12) — middleware GraphQL
- [ ] **Limitation de complexité/aliases** (ex. `graphql-cost` / `graphql-query-complexity`) avec un budget par requête
- [ ] **Désactiver le batching** (ou le limiter fortement) si le serveur ne le supporte pas
- [ ] **Persisted queries** ou allowlist d'opérations en production (optionnel mais recommandé)
- [ ] **Taille max** de la requête entrante (body limit, ex. 1 Mo) + timeout d'exécution

**Auth & données**
- [ ] **Auth sur TOUS les résolveurs** (pas seulement les mutations) — vérifier les permissions par champ
- [ ] **Introspection contrôlée** : désactivée en production, ou limitée aux rôles admin
- [ ] **Jamais d'erreurs internes exposées** : masquer les stack traces, `extensions` internes, messages de résolveur bruts
- [ ] **`process.env` / secrets jamais renvoyés** dans les erreurs ou le schéma

**Infrastructure**
- [ ] **Rate limiting par IP + par utilisateur** (le rate limiter Upstash existant peut être réutilisé)
- [ ] **CORS restreint** à l'origine de l'application (jamais `*` avec credentials)
- [ ] **Protection SSRF** si le serveur fait des fetch (résolveurs « webhook », « import URL ») — réutiliser `lib/security/ssrf.ts` (désormais isomorphe)
- [ ] **Logging** : pas de tokens/query complètes dans les logs ; corrélation par ID de requête
- [ ] **Vérifier la dépendance** : `graphql@16` seule est actuellement présente (parse/buildClientSchema côté client) — ajouter un serveur (graphql-yoga, apollo-server) = nouvelle surface d'attaque à auditer

**Tests**
- [ ] Tests de sécurité : depth limit, complexity, auth par résolveur, introspection fermée, erreurs sans fuite
- [ ] Fuzzing léger de la requête entrante (structure invalide, types inconnus)

---

## Conclusion

La fonctionnalité GraphQL est un **client** vers des API tierces, correctement protégé
sur le chemin HTTP par le proxy existant (SSRF + rate-limit + auth visiteur), sans XSS
ni injection interne. **1 point MEDIUM** (subscriptions hors proxy) et **3 points basse
priorité** (messages d'erreur, réponses non-JSON, validation ws). Aucune vulnérabilité
critique ou haute.

**Mise à jour (2026-08-21)** : les 3 recommandations techniques sont implémentées et
testées (validation des subscriptions, erreurs françaises actionnables, détection des
réponses non-JSON) ; `lib/security/ssrf.ts` a été rendu **isomorphe** (remplacement de
`node:net` par une implémentation locale — 25 tests SSRF inchangés), ce qui permet de
réutiliser la protection SSRF côté client si besoin.
