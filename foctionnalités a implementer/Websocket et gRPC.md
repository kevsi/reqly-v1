# Spec — Client WebSocket standalone & Client gRPC (Reqly)

Positionnement : deux protocoles manquants, jugés peu différenciants à combler en priorité (case à cocher attendue chez un outil "complet", mais coûteux à développer pour un gain de conversion limité). À traiter après mock server, docs, monitors, partage public.

---

## Client WebSocket

### MVP

- [ ] Connexion à une URL WebSocket (`ws://` / `wss://`)
- [ ] Envoi de messages (texte/JSON) sur la connexion ouverte
- [ ] Affichage des messages entrants en temps réel
- [ ] Configuration des headers/authentification à la connexion (comme une requête HTTP classique)
- [ ] Historique de connexion : <cite index="319-1">retrouver les détails d'une connexion passée en un clic, sans avoir à ressaisir les paramètres du handshake</cite>
- [ ] Timeline unifiée des événements (connexion, message envoyé, message reçu, déconnexion) sur une même vue

### v1.5

- [ ] Aperçu détaillé des messages envoyés/reçus (formatage JSON, taille, timestamp)
- [ ] Sous-protocoles WebSocket (header `sec-websocket-protocol`) mémorisés par connexion
- [ ] Génération de messages de test/fake pour développer le frontend avant que le backend WebSocket ne soit prêt (proche du mock server, mais pour ce protocole)
- [ ] Intégration avec les variables d'environnement Reqly existantes

### Hors scope pour l'instant

- Simulation de charge / multi-connexions simultanées (relève plutôt d'un outil de perf dédié)

---

## Client gRPC

### MVP

- [ ] Support des 4 modes d'appel : unary, streaming client, streaming serveur, streaming bidirectionnel
- [ ] Chargement d'un fichier `.proto` pour définir le service (import manuel)
- [ ] <cite index="342-1">Support de la réflexion serveur : le client peut découvrir automatiquement les services et méthodes exposés par le serveur, sans fichier .proto ni schéma créés à la main</cite>
- [ ] Autocomplétion des champs du message à partir du schéma Protobuf
- [ ] Vue requête/réponse côte à côte, avec les types Protobuf sous-jacents visibles au survol

### v1.5

- [ ] <cite index="330-1">Timeline unifiée de tous les événements sur une connexion en streaming</cite>, avec filtrage par type de message pour les flux bruyants
- [ ] Support multi-fichiers Protobuf (imports croisés entre plusieurs `.proto`)
- [ ] Génération d'un message d'exemple en un clic à partir du schéma (y compris pour les types streaming)
- [ ] Historique des appels gRPC passés, consultable pour rejouer ou déboguer un ancien bug
- [ ] Cache du schéma récupéré par réflexion pour éviter de le re-fetcher à chaque appel

### Hors scope pour l'instant

- Génération de mocks gRPC dédiés (le mock server HTTP reste prioritaire ; gRPC mock viendrait en v2 du mock server, pas ici)
- Support gRPC-Web spécifique aux navigateurs

---

## Pourquoi rester en priorité moyenne

Ces deux protocoles sont cohérents avec l'audience technique de Reqly (le scanner de code repère déjà des frameworks backend comme Go/Rust où gRPC est courant), mais :

- Ils sont **coûteux à développer** (protocole binaire pour gRPC, gestion de connexions persistantes pour WebSocket) comparé au reste du backlog
- Leur absence peut faire perdre une comparaison ponctuelle, mais ne fait pas gagner ou perdre une vente comme mock server/docs/monitors/partage public
- À netto reprioriser une fois que les quatre fonctionnalités 🔴 (mock server, docs, monitors, partage public) sont livrées

---

## Gratuit vs payant

Ce sont des protocoles supplémentaires dans le client, pas des services qui tournent en continu (contrairement aux monitors ou au hosting de doc) — donc pas de coût récurrent direct à faire porter par un abonnement.

- **Gratuit** : les deux clients (WebSocket et gRPC) dans leur intégralité, au même niveau que le client HTTP actuel de Reqly — c'est une fonctionnalité de complétude produit, pas un levier de monétisation en soi.
- **Payant** : rien de spécifique à ces protocoles ; seules les features transverses déjà payantes (sync équipe, monitors sur ces protocoles si un jour ajoutés, etc.) s'appliqueraient normalement.