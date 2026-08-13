# Audit de la sidebar AI de reqy-web

## Observations initiales

Le rendu local de `reqy-web` expose l’assistant via un bouton Sparkles dans le header, avec le hint « Ouvrir l’assistant IA (Cmd+I) ». Dans l’état ouvert, la sidebar contient un header `IA`, des contrôles `Plan`, `Action`, `Auto`, `Règles`, `Accès`, un historique, une zone de conversation vide et un champ de saisie.

L’état vide visible affiche : `Prêt à vous aider`, puis « Exécute des requêtes, gère des collections, navigue dans l'app. ». Trois suggestions sont proposées : « Exécute GET /api/users », « Crée une collection 'Tests API' », « Importe le projet depuis GitHub ». Un badge de confiance affiche « L'IA n'agit que sur demande explicite ». Le pied de saisie affiche « Entrée pour envoyer · Maj+Entrée pour une nouvelle ligne · ⌘I pour fermer ».

## Première impression visuelle

Le produit principal est très sombre, dense et orienté outil développeur. La sidebar reprend ce langage avec beaucoup de micro-contrôles et de petites tailles de texte. La hiérarchie est fonctionnelle mais peu éditorialisée : le nom du produit, le rôle de l’assistant, le mode actif, le niveau d’autonomie et la prochaine action attendue ne sont pas regroupés en une proposition claire.

Le rendu observé montre également une barre d’actions très compacte sous le header. Les libellés `Plan`, `Action`, `Auto`, `Règles` et `Accès` se retrouvent sur une seule ligne, ce qui donne une impression de panneau technique plutôt que d’assistant produit fini, surtout lorsque la largeur de la sidebar est réduite.

## Hypothèses à vérifier

1. Le principal problème perçu est probablement la **densité de contrôles** avant même le premier message.
2. Le terme `Auto` est trop ambigu pour un réglage potentiellement sensible ; il devrait exprimer clairement l’autonomie ou l’approbation.
3. La sidebar semble mélanger trois niveaux : conversation, configuration de l’agent et sécurité. Ces niveaux devraient être séparés par une hiérarchie plus nette.
4. L’état vide propose des actions utiles, mais elles sont présentées comme trois boutons génériques plutôt que comme des scénarios guidés liés au contexte de la requête active.
5. Le pied de saisie utilise une très petite taille de texte et une affordance faible pour les raccourcis, ce qui renforce l’impression de finition incomplète.

## Observation d’intégration importante

Le bouton AI du header devient visuellement actif après clic, mais la sidebar dockée n’apparaît pas dans la capture du shell principal. Le texte de la sidebar reste détectable dans le DOM, ce qui suggère que le composant est rendu mais que son état d’ouverture ou son positionnement n’est pas effectivement intégré au layout visible. Il faut vérifier le montage du composant `AiSidebar`, le provider `AiSidebarContext` et la composition de la page principale. Cette anomalie dépasse la seule question esthétique : elle peut expliquer une impression de produit inachevé si l’assistant n’est pas toujours visible ou si son ouverture ne modifie pas clairement l’espace de travail.

## Vérification d’ouverture

Dans le navigateur local, le bouton AI du header a été activé et les raccourcis `Ctrl+I` puis `Meta+I` ont été testés. Le bouton change d’état visuel, mais le panneau reste absent du viewport et l’élément `data-testid="ai-sidebar"` conserve `style="width:0" inert aria-hidden="true"` dans le DOM inspecté. Le layout principal monte bien `AiSidebar` et fournit `AiSidebarContext`, tandis que `ApiHeader` lit ce contexte. Cette divergence mérite d’être traitée comme un bug fonctionnel prioritaire avant un relooking : l’interface peut contenir une sidebar AI complète mais ne pas la rendre réellement accessible depuis le shell.

## Évaluation UI/UX

### Hiérarchie

La sidebar essaie de faire tenir dans un espace étroit l’identité de l’assistant, le statut de connexion, la création de session, l’historique, le mode Plan/Action, l’auto-application, les règles, les permissions, l’usage de tokens, les messages, les plans d’action, les erreurs et la saisie. Cette couverture fonctionnelle est riche, mais la hiérarchie visuelle ne distingue pas suffisamment la conversation principale des réglages d’autonomie. Un utilisateur voit d’abord une rangée de commandes plutôt qu’un espace de travail conversationnel.

### Cohérence produit

Le shell principal est un outil API compact, avec une forte densité de contrôles et des libellés souvent en capitales dans les panneaux de requête. La sidebar reprend la même densité, mais ajoute plusieurs gradients, halos, badges et micro-animations. Le résultat n’est pas incohérent techniquement, mais il manque une grammaire visuelle plus sobre et plus systématique pour donner une impression d’outil professionnel.

### Terminologie et confiance

`Plan` et `Action` sont compréhensibles pour un utilisateur avancé, mais `Auto` ne dit pas clairement ce qui sera automatiquement appliqué. Le bouton `Accès` est plus vague que `Permissions` ou `Autorisation d’actions`. La note « L’IA n’agit que sur demande explicite » est rassurante, mais elle est isolée dans l’état vide au lieu d’être reliée au statut opérationnel de l’agent et à un contrôle d’autonomie explicite.

### État vide

Les trois suggestions sont pertinentes, mais elles sont orientées vers des commandes génériques et ne tiennent pas compte du contexte de la requête active. Elles ressemblent à des raccourcis de démonstration plutôt qu’à des entrées de travail. Un état vide professionnel devrait présenter une phrase de valeur, un contexte détecté et deux ou trois tâches prioritaires, par exemple analyser la requête actuelle, générer un test ou expliquer une réponse.

### Intégration fonctionnelle

Le layout principal monte bien `AiSidebar` avec une largeur par défaut de 400 px, mais le rendu local conserve la sidebar à `width:0` après activation du bouton et des raccourcis. `ApiHeader` et `AppLayout` utilisent bien le même contexte, ce qui indique un défaut de comportement ou d’intégration à corriger avant toute amélioration esthétique. Le projet conserve aussi `AiAssistantModal` dans `ApiSidebar`, avec une seconde expérience AI legacy. Cette coexistence crée un risque de doublon produit : deux surfaces AI, deux modèles d’interaction et deux identités visuelles.
