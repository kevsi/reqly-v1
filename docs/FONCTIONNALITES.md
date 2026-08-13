# Reqly — Documentation fonctionnelle

**Version documentée :** 0.1.0  
**Dernière mise à jour :** 13 août 2026  
**Périmètre :** application web `reqy-web` et application desktop Tauri. Hooklet mobile est volontairement exclu.

## 1. Positionnement du produit

Reqly est un client de test et d’exploration d’API destiné aux équipes qui doivent préparer, exécuter, vérifier et organiser des requêtes HTTP. L’application combine un éditeur de requêtes, un historique persistant, des collections, un exécuteur de scénarios, des espaces de travail, des fonctions d’analyse de projets et plusieurs intégrations destinées au développement quotidien.

L’application est disponible sous deux formes. Dans le navigateur, les requêtes passent par le proxy serveur afin de contourner les restrictions CORS et d’appliquer les protections réseau. Dans la version desktop Tauri, le frontend conserve la même interface mais délègue certaines opérations natives au backend Rust, notamment l’exécution réseau, la capture HTTP, le système de fichiers, Git et la file offline.

> **Principe d’utilisation :** créer ou sélectionner une requête, configurer son endpoint et son contexte d’exécution, l’envoyer, inspecter la réponse, puis conserver le résultat dans l’historique ou une collection.

## 2. Fonctionnalités principales

| Domaine                       | Fonctionnalités disponibles                                                                                                                                                | État documenté                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Requêtes REST                 | Méthodes GET, POST, PUT, PATCH, DELETE, HEAD et OPTIONS ; headers ; paramètres de requête ; authentification ; corps JSON, form-data, x-www-form-urlencoded, raw et binary | Disponible                                           |
| Réponses                      | Statut, durée, taille, headers, cookies, corps formaté, aperçu et inspection brute                                                                                         | Disponible                                           |
| Variables                     | Environnements, variables clé/valeur, interpolation `{{VARIABLE}}`, suggestions et mappings de variables                                                                   | Disponible                                           |
| Collections                   | Collections, dossiers, réordonnancement drag-and-drop, duplication, import, export et exécution groupée                                                                    | Disponible                                           |
| Historique                    | Persistance locale, recherche, filtrage, réexécution et restauration dans l’éditeur                                                                                        | Disponible                                           |
| GraphQL                       | Éditeur de requêtes, variables, headers, introspection, documentation de schéma, diff de schéma, subscriptions et génération de code                                       | Disponible                                           |
| SSE                           | Connexion à un flux Server-Sent Events, reconnexion, filtrage et historique des événements                                                                                 | Disponible                                           |
| Test Runner                   | Assertions, scripts pré/post-requête, datasets CSV/JSON, exécution de collections, résultats détaillés et export JUnit                                                     | Disponible                                           |
| Capture HTTP                  | Proxy de capture desktop, sessions capturées, filtres et génération de collections testables                                                                               | Disponible sur desktop                               |
| IA                            | Assistant, génération de requêtes et de tests, analyse et providers configurables                                                                                          | Disponible selon le provider configuré               |
| Analyse de projets            | Import local ou GitHub, détection de frameworks, routes, ports et mécanismes d’authentification                                                                            | Disponible, surtout desktop pour l’import local      |
| SDK                           | Génération de spécifications OpenAPI et de SDK clients téléchargeables                                                                                                     | Disponible                                           |
| Workspaces et synchronisation | Espaces personnels ou d’équipe, membres, invitations, synchronisation et résolution de conflits                                                                            | Disponible selon la configuration de synchronisation |
| Git                           | Initialisation, ouverture, statut, historique, branches, staging, commit, pull, push et synchronisation de collections                                                     | Disponible sur desktop                               |
| Modules                       | Activation de modules applicatifs, notamment encode/decode                                                                                                                 | Disponible                                           |
| Sécurité                      | CSP avec nonce, headers de sécurité, authentification du proxy, protection SSRF et stockage de session                                                                     | Disponible                                           |

## 3. Parcours utilisateur recommandés

### 3.1 Envoyer une première requête

Depuis la page principale, sélectionner la méthode HTTP, saisir une URL complète puis ouvrir les sections `Headers`, `Query Params` ou `Body` selon le besoin. Pour une requête JSON, sélectionner le type `JSON`, saisir le contenu dans l’éditeur puis cliquer sur `Send`. Le panneau de réponse affiche le statut, les métadonnées réseau, les headers, les cookies et le corps retourné.

L’exécution web utilise `/api/proxy`. Cette route valide le payload, contrôle l’URL, applique les protections SSRF et transmet la requête au serveur distant. La version desktop utilise le client natif Rust via IPC ; elle n’est donc pas soumise au même modèle CORS que le navigateur.

### 3.2 Utiliser un environnement

Ouvrir le sélecteur d’environnement depuis la barre supérieure, créer ou sélectionner un environnement, puis ajouter les variables nécessaires. Une variable peut être utilisée dans l’URL, les headers, les paramètres ou le corps avec la syntaxe `{{BASE_URL}}`. L’autocomplétion propose les variables connues et les tests E2E couvrent la création d’une variable puis son utilisation dans une URL.

Les secrets ne doivent pas être écrits en clair dans une collection partagée. Les paramètres sensibles doivent être conservés dans les mécanismes de stockage prévus par l’application et vérifiés avant tout export.

### 3.3 Organiser les requêtes

Depuis `Collections`, créer une collection puis ajouter des requêtes et des dossiers. Les éléments peuvent être déplacés par glisser-déposer, dupliqués et ouverts dans l’éditeur. Une requête déjà ouverte doit réactiver l’onglet existant plutôt que créer un doublon. Les collections peuvent ensuite être exportées ou transmises à l’exécuteur de scénarios.

### 3.4 Exécuter une collection

Depuis `Runner`, choisir une collection, un environnement et, si nécessaire, un dataset. Les assertions et scripts sont exécutés dans l’ordre défini. Le rapport distingue les succès, les échecs et les éléments ignorés, puis expose la durée, les détails de l’assertion et les statistiques globales. Un export JUnit est disponible pour les intégrations de CI externes.

### 3.5 Utiliser GraphQL

La page GraphQL fournit un onglet par requête, un endpoint, un éditeur de query, des variables et des headers. L’utilisateur peut lancer une introspection, consulter la documentation du schéma, comparer deux snapshots, exécuter une subscription et générer du code client. Le panneau de réponse sépare la réponse, le code généré et le diff de schéma.

### 3.6 Utiliser SSE

La page SSE accepte une URL de flux, un mode d’authentification et des options de headers. Après connexion, les événements reçus sont affichés dans une liste et peuvent être filtrés ou effacés. La reconnexion est gérée par le hook SSE lorsque la connexion est interrompue.

### 3.7 Capturer du trafic HTTP sur desktop

La fonction Capture démarre un proxy local sur un port configuré, observe les requêtes et réponses qui le traversent, puis expose les sessions capturées. Une session peut être filtrée et transformée en collection de tests avec des assertions initiales. Cette fonction dépend des permissions et capacités réseau du système desktop ; elle n’est pas équivalente à une capture passive disponible dans un navigateur standard.

## 4. Import, export et intégrations

Reqly prend en charge les scénarios d’import et d’export utiles au transfert d’un patrimoine de tests. Les formats et intégrations sont résumés ci-dessous.

| Intégration   | Usage                                                                             |
| ------------- | --------------------------------------------------------------------------------- |
| Postman       | Import de collections et export vers Postman selon la configuration du connecteur |
| OpenAPI       | Import de spécifications et export d’une collection sous forme de spécification   |
| Bruno         | Import de collections Bruno                                                       |
| GitLab        | Import de projets selon l’authentification configurée                             |
| GitHub        | Import de repositories et analyse de projets                                      |
| JSON Reqly    | Format natif pour sauvegarder ou transférer les données Reqly                     |
| SDK Generator | Production d’un SDK à partir d’une spécification OpenAPI                          |
| Git desktop   | Versionnement de collections et synchronisation avec un dépôt local ou distant    |

Les intégrations externes peuvent nécessiter une authentification ou des variables d’environnement. Leur disponibilité dépend de la configuration du projet et des permissions accordées par le service tiers.

## 5. IA et automatisation assistée

L’assistant IA peut être utilisé pour formuler une requête, générer des assertions, expliquer une réponse ou proposer une correction. Les providers configurables incluent notamment OpenAI, Anthropic, OpenRouter, Gemini, DeepSeek, Grok, Ollama et Opencode Zen. Les modèles locaux nécessitent un service local disponible ; les providers distants nécessitent une clé ou un connecteur valide.

Les actions d’agent disposent de permissions et de modes d’application contrôlés. Une action qui pourrait modifier une collection ou exécuter une requête doit être relue par l’utilisateur lorsque le mode automatique n’est pas explicitement activé.

## 6. Persistance, synchronisation et desktop

La persistance web repose principalement sur IndexedDB, avec des mécanismes de repli prévus pour les environnements où IndexedDB n’est pas disponible. La version desktop ajoute un adaptateur de fichiers Tauri et une file offline Rust. Cette file conserve les requêtes à rejouer, respecte l’ordre FIFO et retire une entrée après confirmation d’envoi.

Le desktop Tauri expose également des commandes IPC pour l’exécution native, la capture, Git, le système de fichiers, les notifications, les serveurs MCP, OAuth et la clé de chiffrement de session. Les commandes sont déclarées dans `src-tauri/src/lib.rs` et les types partagés sont maintenus avec le pont TypeScript prévu à cet effet.

## 7. Limites et périmètre non couvert

Certaines capacités restent dépendantes de l’environnement ou ne font pas partie du périmètre actuel. Le client WebSocket générique n’est pas documenté comme protocole autonome ; les subscriptions GraphQL et SSE couvrent des usages temps réel spécifiques. La capture HTTP et les opérations de fichiers nécessitent la version desktop. Les services synchronisés, les providers IA et les intégrations GitHub, GitLab ou Postman nécessitent leurs paramètres d’authentification.

**Hooklet mobile n’est pas couvert par ce document.** Son développement et sa validation feront l’objet d’un chantier distinct.

## 8. Références internes

[1]: ../reqy-web/app/ "Routes et pages de l’application web"
[2]: ../reqy-web/components/ "Composants fonctionnels REST, GraphQL et SSE"
[3]: ../reqy-web/lib/ "Moteurs d’exécution, persistance, intégrations et sécurité"
[4]: ../src-tauri/src/lib.rs "Entrée Tauri et registre des commandes IPC"
[5]: ../src-tauri/src/store.rs "File offline et stockage de session desktop"
[6]: ../reqy-web/tests/e2e/ "Scénarios E2E Playwright"
