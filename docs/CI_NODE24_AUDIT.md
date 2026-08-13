# Audit de compatibilité Node 24 des GitHub Actions

Date de vérification : 13 août 2026.

## Résultats officiels

- `actions/checkout` : la page officielle indique une mise à jour vers le runtime Node 24. La page affiche la release `v7.0.1` comme dernière release.
- `actions/setup-node` : la page officielle indique que l’action a été mise à niveau de Node 20 vers Node 24. La page affiche la release majeure `v7.0.0` comme dernière release et demande un runner GitHub Actions `v2.327.1` ou ultérieur.

## Conséquence pour reqly-v1

Le workflow actuel utilise des SHA correspondant à des versions antérieures (`checkout@v4`, `setup-node@v4`, ainsi que les versions historiques de `pnpm/action-setup` et `upload-artifact`). Il faut vérifier les releases officielles de ces deux dernières actions avant de modifier les SHA. La migration recommandée est d’utiliser les dernières versions majeures compatibles Node 24, tout en conservant des SHA complets et en ajoutant temporairement `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` au niveau du workflow pour tester explicitement le nouveau runtime.

- `pnpm/action-setup` : la documentation officielle recommande désormais `pnpm/setup` pour pnpm 11 et plus, car il installe le binaire autonome pnpm et peut installer Node.js. L’action historique `pnpm/action-setup` reste destinée à pnpm 10 et antérieur. La page affiche `v6.0.10` comme dernière release de l’action historique.
- `actions/upload-artifact` : la page officielle affiche `v7.0.1` comme dernière release et indique que `upload-artifact@v4+` n’est pas pris en charge sur GHES. Le dépôt utilisé ici est GitHub.com, donc cette restriction ne s’applique pas.

## Choix retenu

Pour limiter le risque dans cette CI déjà complexe, la migration conservera d’abord `pnpm/action-setup`, mais le passera à sa dernière version majeure documentée (`v6`) et passera `checkout` à `v7`, `setup-node` à `v7` et `upload-artifact` à `v7`. Le workflow forcera temporairement Node 24 via `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true`. Une migration séparée vers `pnpm/setup` pourrait supprimer `setup-node`, mais elle modifierait davantage la mécanique d’installation et n’est pas nécessaire pour traiter l’avertissement Node 20.
