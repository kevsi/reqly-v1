**Spec — Mock Server Reqly**

Positionnement : le seul mock server généré **depuis le code source scanné**, pas depuis une spec importée. Local-first, sans compte, sans quota artificiel.

---

## MVP (v1 — indispensable pour rivaliser avec Postman/Apidog)

### Génération

- [ ] Génération automatique du mock à partir des routes détectées par le scanner de code (11 frameworks, 4 langages) — pas besoin d'OpenAPI en entrée
- [ ] Import OpenAPI/Swagger en complément (pour les cas où le code n'est pas scannable ou en Beta)
- [ ] Import Postman Collection (pour faciliter la migration des utilisateurs Postman)
- [ ] Régénération incrémentale à chaque nouveau scan du code (le mock reste synchronisé avec les routes réelles, sans divergence silencieuse)

### Données de réponse

- [ ] Données réalistes générées automatiquement selon le nom/type du champ (email → adresse email plausible, date → date, id → UUID/int, etc.), sans configuration manuelle
- [ ] Réponses statiques (valeur fixe définie par l'utilisateur)
- [ ] Réponses dynamiques/randomisées respectant le schéma (type, format, contraintes)
- [ ] Override manuel champ par champ (l'auto-génération reste active sur les champs non précisés)
- [ ] Support des objets imbriqués et tableaux

### Routing & matching

- [ ] Matching sur méthode HTTP + path (avec params de path `:id`, wildcards)
- [ ] Matching conditionnel sur query params, headers, body (retourner une réponse différente selon ce qui est envoyé)
- [ ] Plusieurs réponses possibles par route, sélection par règle ou par défaut
- [ ] Codes de statut configurables par route (200, 400, 404, 500…)

### Simulation de comportement réseau

- [ ] Latence configurable (fixe ou aléatoire dans une plage)
- [ ] Simulation de pannes : erreurs 500, timeout, connexion coupée, réponse malformée
- [ ] Taux d'échec probabiliste (ex. 10 % de 500 sur une route) pour tester la résilience

### Exécution

- [ ] Lancement local via CLI (`reqly mock start`)
- [ ] Support Docker / headless pour CI
- [ ] Logs des requêtes reçues en temps réel (visible dans la TUI)
- [ ] Rechargement à chaud de la config sans redémarrer le serveur

---

## v1.5 (différenciant, à faire vite après le MVP)

- [ ] Mode stateful léger : mémoire persistante entre requêtes pour simuler un flux CRUD (créer → lire → modifier → supprimer une ressource) sans base de données externe
- [ ] Scripts de transformation (logique custom en JS/Python pour construire une réponse à partir de la requête reçue)
- [ ] Templating dynamique dans les réponses (réutiliser des valeurs de la requête entrante dans la réponse)
- [ ] Sync équipe self-hébergée (le mock suit la même logique RBAC/activity log que le reste de Reqly)
- [ ] Export/partage de la config de mock (fichier versionnable, committable en Git)

## v2 (utile mais non bloquant)

- [ ] GitHub Action / intégration CI prête à l'emploi
- [ ] Mode proxy : rediriger certaines routes vers le vrai backend et mocker seulement les autres
- [ ] Enregistrement de trafic réel → génération automatique de mocks à partir de requêtes capturées
- [ ] Support GraphQL
- [ ] Support WebSocket (mocks de flux bidirectionnels)
- [ ] Analyse locale (sans LLM) : détection de champs manquants ou incohérents entre le mock et le code réel au fil des scans

---

## Explicitement hors scope pour l'instant

- Mock hébergé cloud avec URL publique (dépend de la fonctionnalité "partage public" à traiter séparément)
- gRPC (trop coûteux à développer pour le gain de conversion actuel)
- Design-first / contrat d'API comme source de vérité (contraire au positionnement code-first)

---

## Sources d'inspiration (licences permissives, réutilisables librement)

- **Mockoon** (MIT) — référence pour le local-first et l'UX de config
- **WireMock** (Apache-2.0) — référence pour le matching de requêtes
- **Hoverfly** (Apache-2.0) — référence pour l'injection de pannes réseau
- **MockServer** (Apache-2.0) — référence pour l'injection de latence/erreurs
- **Prism** (Apache-2.0) — référence pour la génération depuis OpenAPI (mode import)