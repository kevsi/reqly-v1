# Spec — Documentation API publiable/hébergée (Reqly)

Positionnement : une doc générée automatiquement **depuis le code scanné** (comme le mock server), toujours synchronisée, sans étape d'import de spec obligatoire.

---

## MVP (v1 — indispensable pour rivaliser avec Postman/Apidog/Swagger)

### Génération

- [ ] Génération automatique de la doc à partir des routes détectées par le scanner de code
- [ ] Génération à partir d'une collection Reqly existante (pour les routes non scannables)
- [ ] Import OpenAPI/Swagger en complément
- [ ] Régénération incrémentale à chaque nouveau scan (doc synchronisée avec le code réel, pas de divergence silencieuse)
- [ ] Descriptions, exemples de requête/réponse, schémas de données affichés automatiquement par endpoint

### Publication & hébergement

- [ ] URL publique hébergée en un clic (`docs.reqly.io/monprojet`)
- [ ] Option domaine personnalisé (`docs.monentreprise.com`)
- [ ] Choix visibilité : publique, privée (lien avec token), ou restreinte à l'équipe
- [ ] Pas d'infrastructure à gérer côté utilisateur (contrairement à un déploiement Docusaurus)

### Expérience de lecture

- [ ] Rendu moderne par défaut, sans travail de design requis
- [ ] Navigation par catégories/tags d'endpoints
- [ ] Recherche dans la doc
- [ ] Console "Try it" : exécuter une requête réelle directement depuis la page, avec ses propres identifiants/clé API
- [ ] Affichage de la requête + réponse en temps réel après un essai

---

## v1.5 (différenciant, à faire vite après le MVP)

- [ ] Versioning : garder plusieurs versions de l'API documentées en parallèle (ex. v1 et v2 accessibles séparément)
- [ ] Changelog automatique ou semi-automatique généré à partir des diffs de scan (ce qui a changé entre deux versions)
- [ ] Branding personnalisable (logo, couleurs, thème) sans CSS custom
- [ ] Analytics de consultation : quels endpoints sont lus, où les lecteurs décrochent, requêtes "Try it" les plus utilisées
- [ ] Export Markdown propre de toute la doc (réutilisable, lisible par un humain ou une IA)
- [ ] Génération automatique d'un fichier `llms.txt` pointant vers les pages clés de la doc

## v2 (utile mais non bloquant)

- [ ] Pages additionnelles éditables à la main (guides, quickstart, tutoriels) en plus de la référence auto-générée
- [ ] Commentaires/discussion par endpoint (façon ReadMe)
- [ ] Génération de SDK/exemples de code dans plusieurs langages à partir de la doc
- [ ] Serveur MCP généré automatiquement pour que les agents IA interrogent la doc directement (au-delà du simple llms.txt)
- [ ] Intégration Git (docs-as-code, PR pour éditer les pages manuelles)
- [ ] Multi-langue

---

## Explicitement hors scope pour l'instant

- Portail développeur complet façon ReadMe (forums, onboarding, gestion de communauté) — trop loin du cœur de Reqly
- Éditeur visuel de spec OpenAPI (couvert par la case "design-first", hors positionnement code-first)

---

## Gratuit vs payant

Le hosting public a un coût réel (bande passante, infra, disponibilité), contrairement au reste de Reqly qui est local — donc une partie payante est cohérente, comme chez Postman/ReadMe/Mintlify.

- **Gratuit** : génération de la doc (depuis le code ou la collection), export Markdown, doc hébergée sur un sous-domaine Reqly avec quota raisonnable de vues/mois, une seule version active.
- **Payant** : domaine personnalisé, analytics, versioning multiple, branding avancé, doc en équipe/privée avec contrôle d'accès, hébergement sans quota de trafic.

L'objectif : que la doc de base reste toujours gratuite et illimitée en usage local/génération — c'est l'hébergement public à grande échelle et les features "équipe" qui justifient l'abonnement, exactement comme le reste de la stratégie de monétisation identifiée pour Reqly (mock server, monitors, partage public).