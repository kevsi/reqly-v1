# Reqly — Direction artistique de la documentation

## Trois pistes initiales

### The Request Arcade
Une documentation pensée comme une salle d’arcade éditoriale : chaque concept est une machine à comprendre, avec des défis courts, des réponses visuelles et des récompenses de progression.
Probability: 0.07

### Field Notes / Bureau des Signaux
Une esthétique de carnet d’enquête technique, faite de fragments, d’annotations et de schémas vivants. L’utilisateur avance comme un explorateur qui relie des indices.
Probability: 0.03

### Midnight Protocol
Un univers de console nocturne, précis et cinétique, où les requêtes deviennent des trajectoires lumineuses et les réponses des événements à décoder.
Probability: 0.08

## Approche choisie — The Request Arcade

### Design Movement
Neo-brutalisme éditorial teinté de culture arcade et de signalétique de laboratoire : formes franches, typographie expressive, contrastes assumés et petits accidents graphiques contrôlés.

### Core Principles
1. **Comprendre en jouant** : chaque section transforme une notion de Reqly en action, choix ou mini-défi plutôt qu’en bloc de texte.
2. **Montrer avant d’expliquer** : les flux HTTP, variables, collections et assertions sont visualisés comme des objets manipulables.
3. **Énergie sans bruit** : la couleur et la motion donnent du rythme, mais la hiérarchie reste lisible et le contenu reste prioritaire.
4. **Une documentation avec un point de vue** : on parle comme une équipe qui connaît la frustration des outils lourds et veut rendre le travail plus direct.

### Color Philosophy
La base est un papier bleu nuit presque noir, choisi pour évoquer une table de contrôle et faire ressortir les signaux. Le corail orange sert de marqueur d’action et de chaleur humaine ; le vert acide signale les réponses valides ; le jaune pâle sert aux annotations et à la découverte. La couleur n’est jamais décorative : elle indique ce que l’utilisateur peut faire, comprendre ou vérifier.

### Layout Paradigm
Une scène en deux plans : une barre latérale verticale agit comme une borne d’arcade et contient la carte de progression ; le contenu principal se déploie en panneaux asymétriques, avec un fil narratif qui alterne explication, démonstration et interaction. Les blocs ne sont pas uniformément centrés : ils s’alignent sur une grille éditoriale décalée, comme des cartes posées sur une table.

### Signature Elements
Les **tickets de mission** donnent à chaque chapitre un objectif concret. Les **lignes de signal** relient visuellement les étapes d’une requête. Les **pastilles de score** indiquent la difficulté, le temps de lecture ou l’état de validation sans transformer la documentation en jeu artificiel.

### Interaction Philosophy
Les interactions doivent récompenser la curiosité. Un clic révèle une couche, un hover donne un indice, une sélection met en évidence le chemin d’une requête. Les actions sont immédiates, réversibles et accompagnées d’un retour clair. Les raccourcis clavier restent instantanés ; les transitions expressives sont réservées aux changements de chapitre, aux drawers et aux moments de découverte.

### Animation
Les entrées utilisent des translations courtes et une opacité progressive, avec un léger décalage de 40 à 60 ms entre cartes. Les lignes de signal se dessinent rapidement lors d’une démonstration. Les boutons répondent par une compression subtile et les panneaux par un déplacement depuis leur point d’origine. Aucune animation essentielle ne dépend du mouvement : `prefers-reduced-motion` désactive les effets non nécessaires.

### Typography System
Les titres utilisent **Space Grotesk**, en graisses 600 à 700, pour leur géométrie nette et leur présence d’affiche. Le corps utilise **DM Sans**, plus souple pour les explications longues. Les fragments de requête utilisent **IBM Plex Mono**, avec une taille légèrement augmentée et une couleur de signal dédiée. Les titres sont courts, verbaux et orientés action ; les paragraphes restent compacts et respirés.

### Brand Essence
Reqly est l’atelier desktop qui transforme les requêtes API en objets clairs, testables et partageables, pour les développeurs qui veulent moins de friction et plus de contrôle.

Personality: **curieux, direct, ingénieux**.

### Brand Voice
Les titres parlent en verbes et en images : « Fais parler ton endpoint. » ou « Une requête, trois indices, zéro magie noire. » Les CTA invitent à essayer plutôt qu’à consommer : « Ouvrir la mission », « Voir le trajet », « Tester ce scénario ». Le microcopy reste complice sans devenir infantilisant.

### Wordmark & Logo
Le symbole est un chevron de requête formé de deux parenthèses carrées qui se répondent, traversées par une petite étincelle de signal. Il fonctionne seul en favicon et dans la barre latérale ; le mot-symbole Reqly est composé en capitales compactes avec une entaille diagonale dans le « Q » pour rappeler un curseur d’exécution.

### Signature Brand Color
**Signal Coral — `#FF6B4A`**. Cette couleur propriétaire porte l’action, l’audace et la chaleur de l’outil sans tomber dans le bleu générique des plateformes développeur.

## Style Decisions

La couleur environnementale dominante de Reqly est le bleu nuit : les rails de navigation, les zones d’exécution, les transitions de chapitre et les cadres visuels doivent évoquer une table de contrôle nocturne. Le papier crème reste réservé aux surfaces de lecture et aux respirations éditoriales.

Le corail Signal Coral est réservé à l’action principale, à la mission courante et aux emphases décisives. Le vert acide indique la validation, les états passants et l’ouverture ; le jaune pâle indique les tickets, annotations et indices de découverte.

Chaque grande section doit contenir au moins un motif Request Arcade — ticket de mission, ligne de signal, pastille de statut ou flux de requête manipulable — afin que la documentation garde une logique de parcours et ne retombe pas dans une grille SaaS générique.

### Alignement avec apiPlayground-main

L’application réelle est la source de vérité visuelle. Le site de documentation reprend désormais son **canvas clair**, ses **neutres froids**, son **primaire vert émeraude**, ses états sémantiques, ses composants opérationnels, ses bordures fines et ses rayons modérés. Les motifs Request Arcade restent présents sous forme d’interactions, de progression et de signalétique légère, mais ne doivent plus remplacer le langage visuel de l’interface produit.

La capture fournie du mode sombre devient la référence prioritaire pour l’ambiance : **noir profond légèrement texturé**, rail latéral compact, panneaux denses, bordures discrètes et **émeraude comme couleur d’action**. Les surfaces claires restent réservées à d’éventuelles variantes de thème, pas à l’identité principale de la documentation.
