# Spec — Monitors (exécutions planifiées + alertes) (Reqly)

Positionnement : des monitors qui restent synchronisés avec le code scanné (comme le mock server et la doc), pour éviter le problème n°1 des collections qui deviennent obsolètes et déclenchent de fausses alertes.

---

## MVP (v1 — indispensable pour rivaliser avec Postman Monitors/Checkly)

### Exécution planifiée

- [ ] Rejouer une collection/route à intervalle régulier (ex. toutes les 5 min, 1h, 1 jour)
- [ ] Génération automatique des monitors de base à partir des routes détectées par le scanner (moins de setup manuel qu'ailleurs)
- [ ] Exécution depuis le cloud Reqly ou depuis un agent local/interne (pour monitorer des APIs privées sans les exposer publiquement)
- [ ] Historique des exécutions avec statut (succès/échec) et temps de réponse

### Assertions & détection de panne

- [ ] Vérification du code de statut HTTP attendu
- [ ] Vérification du corps de réponse / schéma (détecter un changement de forme, pas juste un crash)
- [ ] Vérification des headers
- [ ] Seuil de latence acceptable (alerte si la réponse est anormalement lente, pas juste si elle échoue)
- [ ] Vérification de l'expiration du certificat SSL

### Alertes

- [ ] Notifications par email
- [ ] Notifications par Slack / webhook générique
- [ ] Distinction entre "échec", "dégradé" (lent mais fonctionnel) et "rétabli" (pour éviter le bruit)
- [ ] Configuration par monitor : qui est notifié, sur quel canal

---

## v1.5 (différenciant, à faire vite après le MVP)

- [ ] Monitors multi-étapes : chaîner plusieurs requêtes (ex. login → récupérer un token → appeler une route protégée), avec extraction de valeurs d'une réponse pour l'étape suivante
- [ ] Monitors dérivés directement des tests/assertions déjà écrits dans Reqly (pas une config séparée à maintenir — le point faible le plus cité chez Postman, où une collection de test qui devient obsolète produit de fausses alertes en production)
- [ ] Retry automatique avant déclenchement d'une alerte (éviter les faux positifs sur un blip réseau isolé)
- [ ] Politique d'escalade (si personne n'accuse réception en X minutes, notifier quelqu'un d'autre)
- [ ] Checks depuis plusieurs régions géographiques (confirmer qu'une panne n'est pas juste un problème réseau local)
- [ ] Page de statut publique simple (afficher l'état de disponibilité aux utilisateurs externes)

## v2 (utile mais non bloquant)

- [ ] Monitoring as code : définir les monitors en fichier versionnable (comme les collections), reviewable en pull request
- [ ] Intégrations PagerDuty / SMS / appel vocal pour les alertes critiques
- [ ] Dashboards de tendance de performance dans le temps (pas juste up/down)
- [ ] Génération de monitors via langage naturel / agent IA ("crée un monitor sur /api/v2/checkout toutes les 30s")
- [ ] Intégration CI/CD : déclencher un monitor après chaque déploiement plutôt qu'attendre le prochain intervalle planifié

---

## Explicitement hors scope pour l'instant

- Observabilité complète façon Datadog (traces, logs, APM) — trop loin du cœur de Reqly, à laisser aux outils spécialisés
- Monitoring de sessions navigateur complexes (façon Playwright/Checkly browser checks) — pertinent pour du test E2E web, pas pour une API

---

## Gratuit vs payant

Comme pour la doc hébergée, l'exécution planifiée depuis le cloud Reqly a un coût récurrent réel (infra qui tourne en continu, alerting), donc une partie payante est cohérente — c'est d'ailleurs la fonctionnalité la plus citée comme "moteur d'abonnement" chez les leaders du marché, car elle délivre de la valeur en continu après la vente.

- **Gratuit** : un nombre limité de monitors actifs, fréquence d'exécution raisonnable (ex. toutes les 15-30 min), alertes email, historique récent.
- **Payant** : fréquence élevée (jusqu'à la minute), monitors multi-étapes illimités, checks multi-régions, intégrations Slack/PagerDuty/SMS, page de statut publique, rétention d'historique longue, exécution via agent privé pour APIs internes en volume.

L'objectif : que n'importe qui puisse surveiller une API critique gratuitement en usage basique, mais que l'usage intensif ou en équipe (fréquence élevée, alerting avancé, multi-région) justifie l'abonnement — la même logique que le mock server et la doc hébergée.