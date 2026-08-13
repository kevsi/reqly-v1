# Audit et recommandations — Sidebar AI de reqy-web

**Périmètre :** interface AI de `reqy-web` uniquement. Hooklet mobile est exclu.  
**Méthode :** lecture des composants React, inspection du layout et observation du rendu local de l’application.  
**Conclusion courte :** le problème n’est pas l’absence de fonctionnalités ; c’est l’absence d’une hiérarchie produit claire, aggravée par une intégration d’ouverture qui semble défaillante et par la coexistence de deux expériences AI.

## 1. Verdict produit

La sidebar AI possède déjà une base fonctionnelle solide : conversations persistantes, historique, suggestions, contexte attaché, modes Plan/Action, règles, permissions, plans d’actions, streaming, retry et saisie enrichie. Cependant, elle ressemble davantage à une console interne d’agent qu’à une fonctionnalité intégrée à un produit API professionnel.

Le sentiment de manque de finition vient principalement de quatre éléments. D’abord, trop de contrôles techniques sont exposés simultanément dans une barre très compacte. Ensuite, plusieurs libellés sont ambigus, notamment `Auto` et `Accès`. Troisièmement, l’état vide met en avant des démonstrations génériques au lieu du contexte de la requête active. Enfin, le code conserve deux expériences AI distinctes : la nouvelle `AiSidebar` et le `AiAssistantModal` legacy.

> **Point bloquant prioritaire :** dans le rendu local, le bouton AI change d’état mais `AiSidebar` reste à `style="width:0" inert aria-hidden="true"`. Avant de juger définitivement le design ou de le peaufiner, il faut rétablir l’ouverture réelle du panneau.

## 2. Constats détaillés

| Domaine              | Constat observé                                                                                                                                    | Impact utilisateur                                                                                      | Gravité  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------- |
| Ouverture            | `AppLayout` monte `AiSidebar`, mais le panneau reste à largeur nulle après activation dans le rendu local.                                         | L’utilisateur peut croire que le bouton ne fonctionne pas ou que l’assistant est absent.                | Bloquant |
| Architecture produit | `AiSidebar` coexiste avec `AiAssistantModal` dans `ApiSidebar`.                                                                                    | Deux expériences concurrentes, risque de comportements et de styles différents.                         | Élevée   |
| Hiérarchie           | Header, modes, autonomie, règles et permissions sont affichés avant la conversation.                                                               | L’objectif principal — poser une question ou agir sur la requête — est visuellement secondaire.         | Élevée   |
| Densité              | Les contrôles `Plan`, `Action`, `Auto`, `Règles`, `Accès` tiennent dans une barre de 40 px avec de très petits textes.                             | Impression de panneau technique, lisibilité faible et découverte limitée.                               | Élevée   |
| Terminologie         | `Auto` ne précise pas ce qui est automatisé ; `Accès` ne décrit pas les permissions.                                                               | Risque d’erreur de compréhension sur une fonctionnalité sensible.                                       | Élevée   |
| État vide            | Les suggestions sont génériques : exécuter un endpoint fictif, créer une collection, importer GitHub.                                              | L’assistant paraît démonstratif plutôt que contextuel et immédiatement utile.                           | Moyenne  |
| Confiance            | La note sur l’action explicite existe, mais n’est pas reliée au contrôle d’autonomie.                                                              | La promesse de sécurité est informative mais pas opérationnelle.                                        | Moyenne  |
| Responsive           | La largeur par défaut est de 400 px, avec une plage de 300 à 600 px.                                                                               | À largeur réduite, la barre de contrôles risque de devenir illisible ou de se compresser excessivement. | Moyenne  |
| Microcopy            | Une partie des libellés de l’état vide est en français, tandis que certains contrôles et actions sont codés ou affichés de manière plus technique. | Impression de produit hétérogène.                                                                       | Moyenne  |

## 3. Recommandation de direction visuelle

La direction recommandée est celle d’un **copilote API sobre, contextuel et contrôlable**, plutôt qu’un panneau futuriste. La sidebar doit se comporter comme une surface de travail secondaire : elle aide à comprendre, préparer et exécuter une action sur la requête ou le projet actif, sans concurrencer l’éditeur principal.

La composition recommandée est structurée en quatre zones. Le header doit afficher l’identité `Reqly AI`, le fournisseur ou modèle courant, un indicateur de disponibilité et seulement les actions `Nouvelle conversation`, `Historique` et `Fermer`. Une seconde zone, compacte et éventuellement repliable, doit afficher le contexte actif : requête, collection, environnement et projet. La zone principale doit rester réservée à la conversation et aux plans d’action. Le footer doit contenir la saisie, les pièces jointes, le bouton d’envoi et un indicateur discret du niveau d’autorisation.

Les réglages avancés — mode Plan/Action, auto-application, règles, permissions et tokens — ne devraient pas être présentés comme cinq boutons de même importance. Ils doivent être regroupés dans un bouton ou un panneau `Contrôles de l’agent`, avec un résumé d’état lisible : `Plan · confirmation requise` ou `Action · exécution autorisée`.

## 4. Architecture d’interface recommandée

| Zone              | Contenu recommandé                                                                                       | À retirer de la vue principale                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Header            | `Reqly AI`, statut connecté/non configuré, nouvelle conversation, historique, fermeture                  | Halos et micro-indicateurs décoratifs trop nombreux              |
| Contexte          | `Requête active`, méthode, endpoint, collection et environnement sous forme de chips ou résumé repliable | Suggestions génériques indépendantes du contexte                 |
| Conversation      | Messages, streaming, citations, étapes d’action, plan à confirmer                                        | Contrôles de sécurité persistants dans la même ligne que le mode |
| Contrôles avancés | Mode, autonomie, règles, permissions et usage dans un panneau secondaire                                 | Boutons `Auto`, `Règles`, `Accès` toujours visibles              |
| Saisie            | Placeholder orienté tâche, mention `@`, commandes `/`, pièces jointes, envoyer/arrêter                   | Hint permanent trop petit et trop peu contrasté                  |

## 5. Microcopy proposée

| Libellé actuel                          | Proposition                                         | Raisonnement                                             |
| --------------------------------------- | --------------------------------------------------- | -------------------------------------------------------- |
| `Plan`                                  | `Planifier`                                         | Verbe explicite et compréhensible hors jargon agentique. |
| `Action`                                | `Exécuter`                                          | Décrit le résultat attendu.                              |
| `Auto`                                  | `Approbation automatique` ou `Confirmation requise` | Rend visible la conséquence de l’option.                 |
| `Règles`                                | `Règles de l’agent`                                 | Évite de confondre avec les règles de la requête.        |
| `Accès`                                 | `Permissions d’action`                              | Explique ce qui est contrôlé.                            |
| `Prêt à vous aider`                     | `Que voulez-vous faire sur cette requête ?`         | Oriente immédiatement vers une tâche.                    |
| `Exécute GET /api/users`                | `Analyser la requête active`                        | Utilise le contexte réel et évite un endpoint fictif.    |
| `Crée une collection 'Tests API'`       | `Générer des tests pour cette réponse`              | Relie l’IA au flux de travail API.                       |
| `L’IA n’agit que sur demande explicite` | `Confirmation requise avant toute modification`     | Promesse de sécurité plus concrète.                      |

## 6. Priorisation de mise en œuvre

| Priorité | Travail                                                                                                                | Résultat attendu                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| P0       | Corriger l’ouverture et la largeur effective de `AiSidebar`; ajouter un test d’intégration du toggle header/raccourci. | Le panneau s’ouvre réellement, se ferme avec `Escape` et reste accessible au clavier.    |
| P0       | Choisir une seule expérience AI et retirer ou désactiver proprement le modal legacy.                                   | Un seul modèle mental, une seule histoire visuelle et moins de régressions.              |
| P1       | Réduire la barre de contrôles à un résumé d’état plus un panneau avancé.                                               | La conversation redevient le point focal.                                                |
| P1       | Remplacer `Auto` et `Accès` par des libellés explicites et relier l’état de confiance à l’autonomie réelle.            | Meilleure compréhension et meilleure sécurité perçue.                                    |
| P1       | Introduire un bloc `Contexte actif` repliable.                                                                         | Suggestions et réponses mieux ancrées dans la requête, l’environnement et la collection. |
| P2       | Refaire l’état vide avec deux ou trois tâches contextuelles, pas des commandes de démonstration.                       | Activation plus rapide et impression de produit spécialisé.                              |
| P2       | Harmoniser espacements, rayons, couleurs et animations avec les autres panneaux de reqy-web.                           | Plus de sobriété et de cohérence visuelle.                                               |
| P3       | Ajouter une revue responsive aux largeurs 300, 360 et 400 px, ainsi qu’aux écrans mobiles.                             | Pas de compression illisible ni de débordement des contrôles.                            |

## 7. Ce qu’il faut éviter

Il ne faut pas ajouter davantage de gradients, d’icônes ou d’animations pour compenser le manque de hiérarchie. Il ne faut pas non plus exposer en permanence tous les réglages de l’agent sous forme de boutons minuscules. Enfin, il serait risqué de modifier uniquement les couleurs ou les arrondis sans résoudre d’abord l’ouverture réelle de la sidebar et la coexistence avec le modal legacy.

## 8. Conclusion

La sidebar n’est pas à reconstruire fonctionnellement ; elle doit être **simplifiée, contextualisée et unifiée**. La séquence correcte est donc : corriger le montage et l’ouverture, choisir la surface AI officielle, réduire les contrôles visibles, clarifier l’autonomie et les permissions, puis seulement appliquer la finition visuelle. Cette approche donnera une interface plus professionnelle sans perdre les capacités déjà implémentées.

## Références internes

- [`src/ai/components/ai-sidebar.tsx`](../reqy-web/src/ai/components/ai-sidebar.tsx) — composition de la sidebar, état vide, contrôles et saisie.
- [`src/ai/components/ai-agent-controls.tsx`](../reqy-web/src/ai/components/ai-agent-controls.tsx) — modes Plan/Action, auto-application, règles et permissions.
- [`src/ai/components/ai-chat-input.tsx`](../reqy-web/src/ai/components/ai-chat-input.tsx) — champ de saisie et affordances clavier.
- [`app/(app)/layout.tsx`](<../reqy-web/app/(app)/layout.tsx>) — montage et contexte de la sidebar.
- [`components/api-sidebar.tsx`](../reqy-web/components/api-sidebar.tsx) — coexistence avec `AiAssistantModal` legacy.
- [`components/ai-assistant-modal.tsx`](../reqy-web/components/ai-assistant-modal.tsx) — seconde expérience AI héritée.
- [`src/ai/hooks/use-ai-sidebar-width.ts`](../reqy-web/src/ai/hooks/use-ai-sidebar-width.ts) — largeur par défaut, minimum, maximum et redimensionnement.
