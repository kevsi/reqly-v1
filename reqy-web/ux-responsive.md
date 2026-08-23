---
name: ux-review-design
description: >
  Use this skill whenever the user asks for a UX review, UX audit, UI health check,
  accessibility review, responsive review, or usability analysis of a website,
  desktop app, mobile app, or web application. Trigger for requests such as:
  "audite l'UX de mon site", "review mes formulaires", "pourquoi mon champ API key
  propose de l'enregistrer comme mot de passe", "est-ce que mon site est responsive",
  "check l'accessibilité", "mon UI a l'air pas pro", or "trouve les problèmes UX".
  Also trigger for narrower UX-related complaints without the word "UX": browser
  autofill or password-manager prompts on non-password fields, broken mobile layouts,
  horizontal overflow, touch targets that are difficult to tap, missing loading/error/
  empty states, inconsistent spacing or visual hierarchy, poor keyboard navigation,
  missing focus indicators, low contrast text, inaccessible form errors, unclear
  destructive actions, or confusing API workflows.

  This skill enforces evidence-based auditing. Every confirmed finding must be linked
  to actual project evidence: a file and line, a reproducible runtime behavior, or a
  clearly identified design-system/configuration rule. Never invent findings from a
  generic checklist. When the code or runtime cannot be inspected, state the limitation
  explicitly and classify recommendations as unverified guidance rather than confirmed
  findings.
---

# Revue UX fondée sur des preuves

## Principe directeur

Une revue UX fiable combine trois niveaux de preuve :

1. **Preuve statique** : le code, le style, le composant ou la configuration montre le problème.
2. **Preuve comportementale** : un test dans le navigateur, la WebView ou l'appareil reproduit le problème.
3. **Preuve normative ou heuristique** : le problème est relié à WCAG, une guideline de plateforme, une heuristique UX reconnue ou une exigence produit.

Ne jamais présenter une hypothèse comme un problème confirmé.

Chaque finding confirmé doit préciser :

- le niveau de preuve ;
- le fichier et la ligne lorsque le problème est visible dans le code ;
- l'extrait de code pertinent ;
- le comportement utilisateur concerné ;
- la sévérité ;
- le correctif concret ;
- la méthode de vérification après correction.

Une revue UX n'est pas une checklist générique. Ne pas écrire « améliorez l'accessibilité », « ajoutez des états de chargement » ou « rendez le site responsive » sans avoir vérifié le code, le rendu ou le comportement concerné.

Si le code réel, l'URL ou l'environnement d'exécution n'est pas accessible :

- le dire clairement ;
- ne pas produire de findings prétendument confirmés ;
- fournir uniquement les principes applicables ou un plan d'audit ;
- demander le code, le dépôt, l'URL ou les fichiers nécessaires pour continuer.

## Périmètre

Le périmètre dépend de la demande. Ne pas auditer toutes les catégories si l'utilisateur décrit un problème précis.

### Catégories générales

1. **Inputs et champs sensibles**
   - labels ;
   - aide contextuelle ;
   - validation ;
   - autofill ;
   - gestionnaires de mots de passe ;
   - clés API, tokens et secrets ;
   - copie, affichage et masquage.

2. **Responsive et interaction tactile**
   - débordement horizontal ;
   - breakpoints ;
   - redimensionnement ;
   - clavier virtuel ;
   - tailles et espacements des cibles ;
   - lisibilité sur petits écrans.

3. **États et feedback**
   - chargement ;
   - succès ;
   - erreur ;
   - état vide ;
   - état désactivé ;
   - progression ;
   - double soumission ;
   - layout shift.

4. **Accessibilité**
   - sémantique HTML ;
   - navigation clavier ;
   - focus ;
   - contraste ;
   - labels ;
   - messages d'erreur ;
   - ARIA ;
   - images ;
   - zoom et reflow.

5. **Cohérence visuelle**
   - tokens de design ;
   - couleurs ;
   - typographie ;
   - espacements ;
   - variantes de composants ;
   - états interactifs ;
   - thèmes clair et sombre.

6. **Workflows d'outils API et prévention des erreurs**
   - environnement sélectionné ;
   - requête en cours d'exécution ;
   - méthode HTTP et URL ;
   - authentification ;
   - headers et paramètres ;
   - secrets ;
   - requêtes destructives ;
   - suppression ;
   - confirmation ;
   - différence entre sauvegarde et exécution ;
   - historique et synchronisation ;
   - feedback après une action distante.

### Périmètre à adapter

Pour une demande large, identifier :

- les écrans concernés ;
- les parcours prioritaires ;
- la stack ;
- la plateforme ;
- les utilisateurs ciblés ;
- les catégories à couvrir.

Pour une demande précise, commencer directement par le composant ou le comportement concerné.

Exemples :

- Champ API key : catégorie 1, puis éventuellement accessibilité.
- Interface cassée à 860 px : catégorie 2.
- Bouton d'envoi sans feedback : catégorie 3.
- Formulaire inutilisable au clavier : catégorie 4.
- Thème sombre incohérent : catégorie 5.
- Bouton « Envoyer » qui utilise par erreur la production : catégorie 6.

## Niveaux de preuve

Utiliser l'un des niveaux suivants dans chaque finding.

### Confirmé par le code

Le problème est directement visible dans un fichier réel.

Exemple :

```md
Preuve : code
Fichier : src/components/ApiKeyField.tsx:42
```

### Confirmé par le runtime

Le problème a été reproduit dans un navigateur, une WebView, un appareil ou un test automatisé.

Exemple :

```md
Preuve : runtime
Test : Playwright à 375×812 px
```

### Confirmé par la configuration

Le problème découle d'une configuration réelle du projet.

Exemple :

```md
Preuve : configuration
Fichier : tailwind.config.ts:18
```

### À vérifier manuellement

Le code indique un risque, mais le comportement dépend de l'environnement.

Exemple :

```md
Statut : à vérifier manuellement
Raison : le comportement du gestionnaire de mots de passe dépend du navigateur,
de sa version et des extensions installées.
```

### Non vérifié

Utiliser cette catégorie uniquement pour des recommandations générales lorsque le projet n'est pas accessible. Ne pas les présenter comme des findings.

## Workflow d'audit

### Étape 0 — Cadrer

Avant l'audit, déterminer :

- la plateforme : navigateur, desktop, mobile, WebView ;
- la stack : React, Next.js, Vue, Svelte, Tauri, Electron, etc. ;
- le périmètre ;
- l'existence d'un symptôme précis ;
- la possibilité de lire les fichiers ;
- la possibilité d'exécuter l'application ;
- les dimensions et thèmes importants ;
- les parcours critiques.

Ne pas demander une clarification si le contexte permet déjà de commencer.

### Étape 1 — Inventorier les fichiers

Commencer par localiser les composants UI, les formulaires, les layouts et les styles.

Exemples :

```bash
find . \
  \( -path './node_modules' -o -path './.git' -o -path './dist' \) -prune \
  -o \( -iname '*.tsx' -o -iname '*.jsx' -o -iname '*.vue' -o -iname '*.svelte' \) \
  -print
```

```bash
rg -n \
  'type\s*=\s*["'\'']password["'\'']|autocomplete|autoComplete|api.?key|token|secret|password' \
  src app components
```

```bash
rg -n \
  '<input|<textarea|<select|<form|onClick|role=["'\'']button|tabIndex|outline:\s*none' \
  src app components
```

```bash
rg -n \
  'loading|isLoading|pending|error|success|empty|disabled|aria-|focus-visible' \
  src app components
```

Lire ensuite :

- `package.json` ;
- la configuration Next.js ;
- `tailwind.config.*` ;
- `globals.css` ;
- les tokens CSS ;
- les composants UI partagés ;
- les layouts ;
- les fichiers de thème ;
- les tests existants ;
- la configuration Tauri ou Electron si elle existe.

Ne pas conclure à partir du seul résultat de recherche. Lire le contexte du composant.

### Étape 2 — Construire une carte des parcours

Pour les écrans importants, identifier :

- le point d'entrée ;
- l'action principale ;
- les champs requis ;
- les états intermédiaires ;
- les erreurs possibles ;
- la confirmation ;
- le résultat attendu ;
- la possibilité d'annuler ou de revenir en arrière.

Pour une application API, examiner au minimum :

- créer une requête ;
- modifier une requête ;
- exécuter une requête ;
- sauvegarder une requête ;
- copier une réponse ;
- gérer une clé API ;
- changer d'environnement ;
- supprimer une requête ;
- importer ou synchroniser des données.

### Étape 3 — Inspecter par catégorie

Pour chaque catégorie applicable :

1. localiser le composant ;
2. lire le contexte complet ;
3. noter le fichier et les lignes ;
4. vérifier le comportement associé ;
5. comparer avec les tokens et composants existants ;
6. rechercher les occurrences similaires ;
7. vérifier si le problème est isolé ou systémique.

### Étape 4 — Tester le runtime

Lorsque l'environnement le permet, utiliser :

- Playwright pour les interactions ;
- les outils développeur du navigateur ;
- axe-core ou axe DevTools ;
- Lighthouse comme signal complémentaire ;
- l'Accessibility Tree ;
- un lecteur d'écran lorsque nécessaire ;
- plusieurs tailles de viewport ;
- les thèmes clair et sombre ;
- le clavier uniquement ;
- un appareil tactile ou une émulation tactile.

Exemples de dimensions à tester :

- largeur très étroite ;
- largeur mobile courante ;
- largeur tablette ;
- largeur intermédiaire où le contenu change ;
- fenêtre desktop redimensionnée ;
- zoom navigateur à 200 %.

Ne pas limiter les tests à 375, 768 et 1024 px. Les breakpoints doivent être guidés par le contenu.

### Étape 5 — Vérifier avant d'affirmer

Distinguer systématiquement :

- ce que le code prouve ;
- ce que le test reproduit ;
- ce qui dépend du navigateur ;
- ce qui dépend d'une extension ;
- ce qui dépend d'une plateforme ;
- ce qui reste à tester.

Pour un comportement d'autofill, ne jamais affirmer qu'un gestionnaire précis se déclenchera ou ne se déclenchera pas sans test correspondant.

### Étape 6 — Rédiger le rapport

Classer les findings par sévérité, puis par catégorie.

Ne pas cacher les résultats positifs. Une bonne revue indique aussi les éléments déjà solides.

## Catégorie 1 — Inputs et champs sensibles

### Labels et instructions

Vérifier que chaque champ possède :

- un label visible lorsque le contexte l'exige ;
- un `htmlFor` correspondant à l'`id`, ou une association sémantique équivalente ;
- une description si le format ou la conséquence n'est pas évident ;
- un message d'erreur relié au champ ;
- un état obligatoire compréhensible ;
- un exemple ou une contrainte utile avant la soumission.

Un placeholder ne remplace pas un label. Un `aria-label` peut être approprié lorsque le design impose l'absence de label visible, mais il ne doit pas être utilisé pour masquer une information nécessaire à tous les utilisateurs.

### Clés API, tokens et secrets

Distinguer trois situations :

1. un mot de passe de compte ;
2. un secret technique tel qu'une clé API ;
3. une valeur sensible mais non persistante.

Ne pas appliquer automatiquement la même stratégie aux trois.

Pour une clé API, vérifier :

- `type` ;
- `name` et `id` ;
- `autocomplete` ;
- présence dans un formulaire de connexion ;
- bouton d'affichage ou de masquage ;
- copie ;
- persistance ;
- expiration ;
- feedback après sauvegarde ;
- possibilité de supprimer ou remplacer la clé ;
- présence éventuelle dans les logs ou messages d'erreur.

`autocomplete="off"` peut réduire l'autocomplétion générale, mais ne constitue pas une garantie contre l'enregistrement ou la détection d'un mot de passe par les navigateurs modernes ou les extensions.

Ne pas utiliser `type="text"` uniquement comme méthode universelle pour éviter les gestionnaires de mots de passe. Si le secret doit rester masqué à l'écran, `type="password"` peut rester pertinent. Le choix doit dépendre du besoin de visibilité et être vérifié dans les environnements ciblés.

### Heuristiques d'autofill

Certains navigateurs et gestionnaires utilisent plusieurs signaux :

- `type` ;
- `name` ;
- `id` ;
- labels ;
- structure du formulaire ;
- présence d'un nom d'utilisateur ou d'un email ;
- attributs `autocomplete`.

Éviter de renommer artificiellement les champs avec des noms aléatoires uniquement pour tromper l'autofill. Cela peut dégrader l'accessibilité, les tests et la maintenance.

Les attributs spécifiques suivants peuvent réduire le risque avec certains gestionnaires, mais ils ne sont pas des standards universels et ne constituent pas une garantie :

```html
<input
  id="api-key"
  name="apiKey"
  type="password"
  autocomplete="off"
  data-1p-ignore
  data-lpignore="true"
  data-bwignore="true"
/>
```

Les attributs spécifiques doivent être ajoutés uniquement si :

- le comportement indésirable est réellement observé ;
- le gestionnaire concerné est identifié ;
- le compromis est documenté ;
- le champ reste accessible et utilisable.

Toujours classer le résultat comme dépendant de l'environnement lorsque le test n'a pas été exécuté.

### Affichage et masquage

Un champ sensible peut utiliser :

- un champ natif `password` ;
- un bouton « Afficher » / « Masquer » ;
- un champ texte lorsque la valeur doit être vérifiable ;
- une valeur partiellement masquée après sauvegarde ;
- un bouton de copie séparé.

Le bouton d'affichage doit :

- être un vrai `<button>` ;
- avoir un nom accessible ;
- conserver le focus ;
- communiquer son état ;
- ne pas modifier la valeur ;
- ne pas provoquer une perte de saisie.

Exemple :

```tsx
<button
  type="button"
  aria-label={visible ? "Masquer la clé API" : "Afficher la clé API"}
  aria-pressed={visible}
  onClick={() => setVisible((value) => !value)}
>
  {visible ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
</button>
```

### Validation

Vérifier que :

- la validation ne sanctionne pas chaque frappe sans nécessité ;
- les champs requis sont indiqués avant l'envoi ;
- les erreurs identifient le champ concerné ;
- le message explique comment corriger ;
- le serveur reste la source d'autorité pour les règles sensibles ;
- les erreurs réseau sont distinctes des erreurs de validation ;
- le focus est déplacé de manière prévisible ;
- une erreur globale reste accessible.

Exemple d'erreur actionnable :

```text
Clé API invalide. Vérifie qu'elle appartient à l'environnement sélectionné,
puis colle-la à nouveau sans espaces au début ni à la fin.
```

### Copie

Pour une clé affichée après génération ou sauvegarde :

- proposer une action « Copier » ;
- confirmer le succès ;
- gérer l'échec de l'API Clipboard ;
- ne pas copier automatiquement sans action explicite ;
- éviter d'afficher la clé complète plus longtemps que nécessaire ;
- ne pas écrire la clé dans les logs.

## Catégorie 2 — Responsive et tactile

### Débordement

Rechercher :

- largeurs fixes ;
- `min-width` excessifs ;
- tableaux sans stratégie mobile ;
- `white-space: nowrap` ;
- éléments flex sans `min-width: 0` ;
- longues URLs ;
- clés API ou tokens non tronqués ;
- modales plus larges que la fenêtre ;
- panneaux Tauri sans zone de scroll.

Ne pas ajouter globalement `overflow-x: hidden` pour masquer un problème sans identifier sa cause. Cela peut rendre du contenu inaccessible.

### Cibles interactives

Distinguer :

- le minimum WCAG 2.2 AA ;
- les recommandations ergonomiques de plateforme.

WCAG 2.2 prévoit un minimum de 24 × 24 CSS pixels dans son critère Target Size (Minimum), avec des exceptions liées à l'espacement et au contexte. Pour le confort tactile, viser environ 44 × 44 px sur les interfaces inspirées d'iOS et 48 × 48 dp sur Android lorsque l'espace le permet.

Vérifier :

- la taille de la zone réellement cliquable, pas seulement celle de l'icône ;
- l'espacement entre contrôles ;
- les boutons d'icône ;
- les actions dans les tableaux ;
- les contrôles de pagination ;
- les boutons fermer, afficher, copier et supprimer.

### Texte et focus mobile

Sur mobile, tester :

- taille des champs ;
- zoom automatique d'iOS ;
- position du clavier ;
- scroll vers le champ actif ;
- boutons d'action accessibles avec le clavier ouvert ;
- modales qui dépassent la hauteur disponible ;
- utilisation de `dvh` lorsque c'est pertinent ;
- safe areas sur appareils avec encoche.

Ne pas affirmer qu'une taille d'écran précise est toujours problématique. Reproduire le comportement dans un navigateur ou appareil réel.

### Breakpoints

Les breakpoints doivent être ajoutés lorsqu'un composant ne fonctionne plus, et non seulement pour correspondre à des appareils connus.

Tester les largeurs intermédiaires :

- avant et après chaque breakpoint ;
- pendant la réduction progressive de la fenêtre ;
- avec des contenus longs ;
- avec des traductions plus longues ;
- avec la sidebar ouverte et fermée.

## Catégorie 3 — États et feedback

Pour chaque action asynchrone, vérifier les états suivants :

- initial ;
- chargement ;
- succès ;
- erreur ;
- nouvelle tentative ;
- annulé ;
- vide ;
- non autorisé ;
- hors ligne ;
- timeout ;
- conflit ou synchronisation en cours.

### Chargement

Un état de chargement doit :

- être visible ;
- empêcher les doubles soumissions lorsque nécessaire ;
- conserver le contexte de l'action ;
- ne pas faire disparaître inutilement le contenu ;
- exposer un statut accessible ;
- réserver suffisamment d'espace pour éviter un déplacement important.

Exemple :

```tsx
<button type="submit" disabled={isPending}>
  {isPending ? "Enregistrement en cours…" : "Enregistrer"}
</button>
```

Ne pas utiliser `disabled` seul si l'utilisateur doit comprendre pourquoi une action n'est pas disponible. Fournir une explication visible ou accessible.

### Erreurs

Une erreur utile indique :

- ce qui s'est passé ;
- l'élément concerné ;
- l'action attendue ;
- si l'action peut être retentée ;
- si la donnée a été conservée.

Éviter les messages génériques tels que :

```text
Une erreur est survenue.
```

Préférer :

```text
La requête n'a pas pu être envoyée après 30 secondes.
Vérifie l'URL et ta connexion, puis réessaie.
```

### États vides

Un état vide doit être visuellement différent d'un chargement bloqué.

Il devrait contenir :

- un titre ;
- une explication courte ;
- une action principale lorsque c'est pertinent ;
- éventuellement un exemple ou une aide.

Exemple :

```text
Aucune requête sauvegardée.
Crée ta première requête pour la retrouver ici.
[Créer une requête]
```

### Succès

Les actions importantes doivent fournir un feedback :

- sauvegarde ;
- copie ;
- synchronisation ;
- import ;
- suppression ;
- exécution ;
- changement d'environnement.

Le feedback doit être suffisamment proche de l'action et suffisamment durable pour être compris, sans interrompre inutilement le flux.

## Catégorie 4 — Accessibilité

### Sémantique

Préférer :

- `<button>` à `<div onClick>` ;
- `<a>` à un élément cliquable qui navigue ;
- `<main>`, `<nav>`, `<header>` et `<footer>` aux conteneurs génériques ;
- `<label>` pour les champs ;
- `<fieldset>` et `<legend>` pour les groupes de contrôles ;
- `<table>` pour les données tabulaires.

Un `div` avec `role="button"` et `tabIndex` est un signal d'alerte. Il peut être nécessaire dans certains composants complexes, mais un vrai `<button>` doit être utilisé lorsque c'est possible.

### Clavier et focus

Vérifier :

- tous les contrôles atteignables au clavier ;
- ordre logique ;
- absence de piège de focus ;
- fermeture prévisible des modales avec Échap ;
- retour du focus après fermeture ;
- focus visible ;
- absence de `outline: none` sans remplacement équivalent ;
- navigation dans les menus, popovers et tableaux ;
- activation avec Entrée et Espace selon le type de contrôle.

Ne pas se limiter à vérifier la présence de `:focus-visible`. Vérifier aussi le contraste et la visibilité réelle du focus sur chaque fond.

### Contraste

Les exigences WCAG 2.2 couramment utilisées sont :

- 4,5:1 pour le texte normal ;
- 3:1 pour le texte large ;
- 3:1 pour certains composants et indicateurs visuels.

Vérifier les couleurs résolues, y compris :

- variables CSS ;
- opacités ;
- gradients ;
- états hover et disabled ;
- thème sombre ;
- texte dans les champs ;
- placeholder ;
- texte sur arrière-plan animé.

Ne pas signaler un problème de contraste uniquement parce qu'une classe semble « gris clair ». Calculer le contraste de la couleur finale.

### Images

Vérifier :

- `alt` descriptif pour les images porteuses de sens ;
- `alt=""` pour les images décoratives ;
- nom accessible pour les icônes interactives ;
- absence de texte important uniquement dans une image ;
- alternatives pour les graphiques ou schémas importants.

### Formulaires et erreurs

Une erreur ne doit pas être communiquée uniquement par :

- une bordure rouge ;
- une icône sans nom ;
- un changement de couleur ;
- un toast qui disparaît avant d'être lu.

Vérifier l'utilisation appropriée de :

- `aria-invalid` ;
- `aria-describedby` ;
- `role="alert"` ou `aria-live` lorsque nécessaire ;
- association entre le champ et son erreur ;
- résumé d'erreurs pour les formulaires longs.

Ne pas ajouter ARIA si le HTML natif fournit déjà le comportement correct.

### Zoom et reflow

Tester :

- zoom à 200 % ;
- largeur réduite ;
- texte augmenté ;
- contenu long ;
- traduction ;
- police système plus grande.

Le contenu ne doit pas être tronqué ou se superposer sans possibilité de lecture et d'interaction.

## Catégorie 5 — Cohérence visuelle

### Tokens

Lire d'abord le système visuel existant :

- variables CSS ;
- tokens Tailwind ;
- composants partagés ;
- variantes ;
- thèmes ;
- échelle d'espacement ;
- échelle typographique.

Ne pas considérer automatiquement toute valeur différente comme une erreur. Une valeur ad hoc est un finding uniquement si elle crée une incohérence, un défaut de rendu ou une dérive répétée.

### Couleurs

Rechercher les couleurs codées en dur, mais les classer selon leur impact :

- problème de thème ;
- contraste ;
- état interactif incohérent ;
- simple exception documentée.

Une couleur en dur n'est pas automatiquement un bug si elle correspond à une couleur de marque ou à une illustration.

### Espacement

Comparer les valeurs aux tokens réels du projet. Ne pas imposer une échelle 4 ou 8 px si le projet utilise volontairement une autre échelle.

Examiner :

- marges internes ;
- espacements entre sections ;
- groupes de champs ;
- panneaux ;
- modales ;
- boutons ;
- listes ;
- tableaux.

### Typographie

Vérifier :

- hiérarchie des titres ;
- taille et poids cohérents ;
- longueur des lignes ;
- hauteur de ligne ;
- troncature ;
- texte traduit ou long ;
- cohérence entre écrans.

### États visuels

Les composants de même importance doivent avoir des états cohérents :

- hover ;
- active ;
- focus ;
- disabled ;
- loading ;
- destructive ;
- selected.

Le focus ne doit pas être remplacé uniquement par un changement subtil de couleur.

## Catégorie 6 — Workflows API et prévention des erreurs

Cette catégorie est particulièrement importante pour les clients API, outils développeur et applications de synchronisation.

### Environnement

Vérifier que l'utilisateur sait clairement s'il agit sur :

- local ;
- développement ;
- staging ;
- production ;
- un serveur distant ;
- un workspace partagé.

L'environnement actif doit être visible au moment des actions à risque, pas uniquement dans un écran de configuration éloigné.

### Actions destructives

Vérifier les actions telles que :

- supprimer une requête ;
- vider un historique ;
- remplacer une collection ;
- envoyer une requête mutante ;
- écraser une synchronisation ;
- supprimer une variable ;
- révoquer un token.

Une confirmation doit expliquer :

- ce qui va être supprimé ou modifié ;
- si l'action est réversible ;
- la portée de l'action ;
- l'environnement concerné.

Ne pas demander une confirmation pour chaque action sans risque. Une confirmation excessive dégrade la fluidité et banalise les alertes.

### Exécution d'une requête

Avant l'envoi, l'interface doit rendre compréhensibles :

- méthode ;
- URL ;
- environnement ;
- authentification ;
- headers importants ;
- paramètres ;
- corps de requête ;
- action finale.

Après l'envoi, distinguer :

- erreur réseau ;
- erreur d'authentification ;
- erreur serveur ;
- erreur de validation ;
- réponse HTTP valide mais métier en échec ;
- timeout ;
- annulation.

### Secrets

Vérifier :

- visibilité ;
- stockage ;
- persistance ;
- rotation ;
- copie ;
- export ;
- synchronisation ;
- affichage dans l'historique ;
- affichage dans les logs ;
- messages d'erreur ;
- screenshots ou aperçu.

Ne pas exposer un secret dans un message d'erreur, un toast, une URL, un log ou un état visible par défaut.

### Synchronisation

Pour les fonctionnalités de synchronisation, vérifier :

- état en cours ;
- dernière synchronisation ;
- conflit ;
- échec ;
- nouvelle tentative ;
- sens de la synchronisation ;
- source de vérité ;
- perte potentielle de données ;
- indication de la version locale et distante.

## Section stack — Tauri v2, Next.js, React et shadcn

Cette section s'applique uniquement lorsque la stack correspond réellement.

### Tauri v2 et WebView

Ne pas supposer qu'une application desktop est automatiquement à l'abri des comportements de navigateur.

Sous Windows, Tauri utilise WebView2. Les fonctions d'autofill générales peuvent être configurées, mais la désactivation de l'autofill général ne garantit pas la désactivation des suggestions de mots de passe ou de cartes bancaires.

Tester séparément :

- Windows/WebView2 ;
- macOS/WebKit ;
- Linux/WebKitGTK ;
- mobile si l'application le cible.

Ne pas présenter `generalAutofillEnabled=false` comme une solution universelle.

### Next.js en export statique

Si `output: "export"` est utilisé :

- vérifier que les données client sont chargées après l'hydratation ;
- prévoir un état initial explicite ;
- éviter de dépendre de fonctionnalités SSR absentes ;
- vérifier les accès à `window`, `document` et aux APIs Tauri ;
- éviter l'écran vide pendant l'initialisation ;
- vérifier les erreurs de chargement côté client ;
- tester le démarrage dans la fenêtre Tauri.

Ne pas considérer l'absence de SSR comme un problème en soi. Le finding doit décrire le défaut utilisateur observable.

### React

Vérifier :

- états de chargement ;
- conservation des données pendant une erreur ;
- focus après changement d'état ;
- clés de liste ;
- composants contrôlés ;
- formulaires longs ;
- boutons qui déclenchent plusieurs requêtes ;
- désynchronisation entre l'état visuel et l'état réel.

Les problèmes d'architecture ou de state management qui n'affectent pas directement l'utilisabilité sortent du périmètre principal de cette compétence.

### shadcn et Tailwind

Lire les tokens existants avant de juger les classes.

Vérifier :

- `bg-background` ;
- `text-foreground` ;
- `border-border` ;
- variantes de composants ;
- thème sombre ;
- couleurs sémantiques ;
- états focus et disabled ;
- cohérence entre composants shadcn et composants personnalisés.

Une couleur Tailwind brute n'est pas automatiquement un bug. La signaler lorsqu'elle provoque effectivement :

- une rupture de thème ;
- un mauvais contraste ;
- une incohérence entre composants ;
- une perte de lisibilité.

### Fenêtre desktop

Tester le redimensionnement réel de la fenêtre Tauri :

- largeur très étroite ;
- hauteur réduite ;
- sidebar ouverte ;
- modale ouverte ;
- panneau de détails ouvert ;
- long formulaire ;
- réponse API volumineuse ;
- tableau large.

Vérifier que :

- l'action principale reste accessible ;
- les boutons ne sont pas coupés ;
- les panneaux internes peuvent défiler ;
- le scroll horizontal est intentionnel ;
- le focus reste visible ;
- les modales ne dépassent pas la fenêtre.

### Modales et panneaux

Pour les modales et panneaux :

- gérer le focus ;
- permettre la fermeture ;
- ne pas couper les boutons ;
- conserver le contexte ;
- prévoir le scroll interne ;
- éviter le scroll simultané de plusieurs conteneurs sans raison ;
- tester avec une petite hauteur de fenêtre ;
- tester avec un clavier ouvert sur mobile.

## Outils recommandés

Utiliser les outils disponibles sans les considérer comme suffisants seuls.

### Inspection statique

- `rg` ou `grep` pour localiser les patterns ;
- analyse des composants ;
- lecture des tokens ;
- inspection des configurations ;
- recherche des états asynchrones ;
- recherche des handlers d'erreur.

### Tests navigateur

- Playwright pour les parcours ;
- captures à plusieurs dimensions ;
- navigation clavier ;
- états d'erreur ;
- états vides ;
- formulaires ;
- régression visuelle ;
- vérification de l'absence de double soumission.

### Accessibilité

- axe-core ;
- axe DevTools ;
- Accessibility Tree ;
- lecteur d'écran ;
- tests clavier ;
- calcul de contraste ;
- zoom à 200 %.

Les audits automatisés ne remplacent pas la vérification humaine de la compréhension, de la hiérarchie et des workflows.

## Format du rapport

Ne produire un fichier Markdown que si l'utilisateur le demande explicitement ou si le contexte de travail l'exige.

### 1. Résumé

Présenter en deux ou trois phrases :

- ce qui a été audité ;
- les plateformes et dimensions testées ;
- les limites éventuelles ;
- les problèmes les plus importants.

### 2. Findings

Classer par sévérité.

Utiliser ce format :

````md
### [Majeur] Titre du problème

- Catégorie : Inputs & champs sensibles
- Preuve : code / runtime / configuration / à vérifier
- Fichier : `src/components/ApiKeyField.tsx:42`
- Extrait :

  ```tsx
  <input type="password" autoComplete="off" />
  ```
````

- Impact utilisateur : le navigateur peut interpréter le champ comme un mot de passe
  de compte et proposer une sauvegarde inappropriée. Ce comportement dépend du
  navigateur et des extensions installées.
- Correctif recommandé :

  ```tsx
  <input
    id="api-key"
    name="apiKey"
    type="password"
    autoComplete="off"
    aria-describedby="api-key-help"
  />
  ```

- Vérification : tester dans les navigateurs et gestionnaires ciblés.

```

Chaque finding doit contenir :

- titre ;
- catégorie ;
- niveau de preuve ;
- fichier et ligne lorsque disponibles ;
- extrait minimal ;
- impact utilisateur ;
- correctif ;
- méthode de vérification.

### 3. Priorisation

Utiliser les sévérités suivantes :

- **Bloquant** : empêche un parcours essentiel, provoque une perte importante de données, expose un secret ou rend une action critique inaccessible.
- **Majeur** : gêne importante dans un parcours courant, erreur facile à provoquer, problème d'accessibilité significatif ou interface inutilisable sur une plateforme ciblée.
- **Mineur** : friction réelle mais contournable, incohérence, feedback incomplet ou problème limité à un contexte.
- **Cosmétique** : amélioration visuelle sans impact notable sur la compréhension ou l'utilisation.

Ne pas utiliser « Bloquant » uniquement parce qu'un problème est techniquement intéressant. La sévérité doit refléter l'impact réel.

### 4. Ce qui est déjà solide

Inclure les points positifs vérifiés :

- composants correctement sémantisés ;
- labels liés ;
- états de chargement présents ;
- messages d'erreur actionnables ;
- tokens correctement utilisés ;
- focus visible ;
- responsive correctement géré ;
- actions destructives clairement signalées ;
- feedback de succès présent.

Ne pas inventer de points positifs. Les relier au code ou au test lorsque possible.

### 5. Vérifications restantes

Lister séparément ce qui nécessite :

- un navigateur spécifique ;
- une extension de gestionnaire de mots de passe ;
- un appareil tactile ;
- un lecteur d'écran ;
- une connexion lente ;
- un test avec données volumineuses ;
- un test Windows/WebView2 ;
- un test macOS/WebKit ;
- un test de synchronisation concurrente.

## Anti-patterns à éviter

- Donner une checklist générique sans avoir inspecté le projet.
- Inventer un fichier, une ligne ou un extrait.
- Affirmer qu'un gestionnaire de mots de passe précis se déclenchera sans test.
- Présenter `autocomplete="off"` comme une garantie.
- Présenter les attributs `data-1p-ignore`, `data-lpignore` ou `data-bwignore` comme des standards universels.
- Recommander systématiquement `type="text"` pour les clés API.
- Affirmer que `type="password"` est toujours incorrect pour une clé API.
- Confondre les recommandations 44/48 px avec le minimum WCAG 2.2.
- Signaler un problème de contraste sans calculer la couleur finale.
- Signaler une couleur codée en dur comme bug sans vérifier son impact.
- Ajouter `overflow-x: hidden` pour masquer un débordement sans traiter sa cause.
- Utiliser ARIA lorsqu'un élément HTML natif suffit.
- Signaler un problème uniquement parce qu'une préférence personnelle n'est pas respectée.
- Classer comme Bloquant un problème qui ne perturbe pas réellement un parcours essentiel.
- Produire uniquement une liste de problèmes sans mentionner les éléments solides.
- Modifier l'action principale ou le design sans l'expliquer en termes d'impact utilisateur.
- Mélanger un finding confirmé avec une recommandation non vérifiée.
- Oublier les workflows propres aux outils API : environnement, secrets, exécution,
  synchronisation et actions destructives.
- Supposer qu'une application Tauri se comporte comme un navigateur ou comme une
  application native sur toutes les plateformes.
```
