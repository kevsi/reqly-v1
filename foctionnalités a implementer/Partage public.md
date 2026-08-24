# Spec — Partage public / run-in-browser d'une collection (Reqly)

Positionnement : un lien public qui laisse quelqu'un tester une collection sans installer Reqly ni créer de compte — le levier de croissance virale identifié dans l'audit produit.

---

## MVP (v1 — indispensable pour rivaliser avec Postman/Hoppscotch)

### Génération du lien

- [ ] Lien public généré en un clic depuis n'importe quelle collection
- [ ] Consultation sans compte ni installation : la personne qui reçoit le lien voit la collection directement dans le navigateur
- [ ] Bouton "Run"/exécution directement depuis la page publique (pas juste une lecture passive)
- [ ] Export en JSON téléchargeable pour ceux qui préfèrent réimporter dans leur propre outil

### Bouton embarquable

- [ ] Bouton "Run in Reqly" à intégrer dans un site, une doc ou un README — <cite index="293-1">clic qui permet à un consommateur d'API de forker la collection instantanément dans son propre espace</cite>
- [ ] Snippet HTML/Markdown prêt à copier-coller pour ce bouton
- [ ] <cite index="298-1">Objectif : amener un nouvel utilisateur de zéro à sa première réponse 200 OK en le moins d'étapes possible</cite>

### Synchronisation

- [ ] Le lien public reste lié à la collection source : <cite index="305-1">à chaque mise à jour de la collection, la doc/le lien publié reste automatiquement synchronisé, sans avoir à republier</cite>
- [ ] Visibilité configurable : public (n'importe qui avec le lien), ou restreint (lien + accès limité)

---

## v1.5 (différenciant, à faire vite après le MVP)

- [ ] Fork : la personne qui reçoit le lien peut copier la collection dans son propre espace Reqly en gardant un lien vers l'original, plutôt qu'un simple import figé
- [ ] Compteur de forks/vues (savoir combien de personnes ont récupéré la collection — utile pour mesurer la traction)
- [ ] Notification au propriétaire quand quelqu'un fork ou consulte la collection publique
- [ ] Environnement/variables associés au lien, pour que la personne obtienne une première réponse fonctionnelle sans tout reconfigurer à la main

## v2 (utile mais non bloquant)

- [ ] Page publique listant toutes les collections publiques d'un utilisateur/organisation (façon mini "API network")
- [ ] Personnalisation légère de la page publique (logo, description) sans passer par la doc hébergée complète
- [ ] Suivi des changements : abonnement des personnes qui ont forké pour être notifiées quand la collection source évolue

---

## Explicitement hors scope pour l'instant

- Un vrai réseau/marketplace d'APIs publiques façon "Postman API Network" — ambition trop large pour l'instant, à revisiter une fois la base d'utilisateurs plus grande
- Édition collaborative en temps réel sur la version publique (réservé au partage équipe privé, pas au partage public)

---

## Gratuit vs payant

Contrairement au mock server, aux monitors et à la doc hébergée, cette fonctionnalité est avant tout un **levier de croissance**, pas un centre de coût récurrent lourd — chaque partage public amène un nouvel utilisateur potentiel vers Reqly.

- **Gratuit, sans limite artificielle** : génération du lien, bouton embarquable, consultation et exécution par les visiteurs, synchronisation avec la collection source. Restreindre cette fonctionnalité irait à l'encontre de son but (plus il y a de partages, plus il y a de visibilité gratuite pour Reqly).
- **Payant, en option seulement** : personnalisation avancée de la page publique, statistiques détaillées de forks/vues, gestion d'un catalogue de collections publiques pour une organisation.

L'objectif : ne jamais limiter le partage lui-même — c'est ta pub gratuite. Monétiser seulement le confort et les insights autour du partage, pas l'acte de partager.