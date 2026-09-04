# AGENTS.md — reqy-web

Consignes pour toute génération/édition de code dans ce dossier (agents IA comme
humains). Rédigées après l'audit du 2026-09-03, qui a montré un projet solide
sur le fond mais accumulant des systèmes dupliqués, du texte non traduit et des
commentaires-plaidoirie — signature d'un code généré sans jamais être refactoré.

## Style de code

1. **Un fichier, une responsabilité.** Un composant de page dépasse ~800 lignes ?
   Extraire l'état dans un hook co-localisé (`hooks/use-*.ts` ou
   `app/(app)/<page>/hooks/`). Ne jamais "empiler" une nouvelle feature dans le
   fichier existant si elle a son propre cycle de vie.

2. **Pas de systèmes en double.** Avant d'ajouter un panneau/modal/éditeur,
   grep ce qui existe. Si un équivalent existe : l'étendre ou le remplacer —
   jamais en ajouter un second "nouveau" à côté de l'ancien. Les doublons sont
   la première source de confusion produit et de surface de sécurité.

3. **Supprimer plus que tu n'ajoutes.** Si ton changement rend un chemin de
   code obsolète (ancienne route, ancien composant, ancien champ), le retirer
   fait partie du changement — pas d'un futur "ménage plus tard". Le code mort
   n'est jamais inoffensif : c'est dans du code mort qu'a vécu notre seul RCE.

## Commentaires

Un commentaire déclare une **contrainte que le code ne montre pas**. Rien d'autre.

- ✅ `// SSM exécute en root : `~` = /root, chemins absolus obligatoires`
- ✅ `// node:vm n'est pas une frontière de sécurité — le process jetable l'est`
- ❌ `// 🔐 SECURITY: this endpoint must never act as an open proxy` (plaide,
  ne dit rien que le code ci-dessous ne montre pas)
- ❌ `// Feature 3: ...`, `// R12: ...`, `// Phase 7.2 — ...` (ticket-refs que
  personne ne pourra résoudre dans 6 mois)
- ❌ Commentaires de justification de PR ("audit fix", "previously broken")
- Pas d'emoji dans le code ni les commentaires.

**Langue** : l'arbitraire est la cohérence avec le fichier ouvert ; franglais
interdit au sein d'un même commentaire.

## i18n

**Aucune chaîne visible en dur.** Tout texte utilisateur passe par
`t("clé.espacée")` avec la clé dans `src/i18n/locales/fr.json` **et**
`en.json` (le test de parity échoue sinon). La règle ESLint
`reqly-i18n/no-hardcoded-jsx-text` (warn) signale les dérogations — ne pas en
ajouter. Les deux clés sont ajoutées dans le même commit que le code.

## Sécurité (rappels durables)

- **`node:vm` n'est pas une frontière de sécurité.** Toute exécution de JS
  fourni par l'utilisateur passe par un process jetable (fork + kill).
- Toute route qui fetch une URL contrôlée par l'utilisateur applique la garde
  SSRF (`lib/security/ssrf`) + pinning DNS (`createPinnedDispatcher`) — y
  compris les webhooks, y compris en desktop (CSRF : l'Origin est la seule
  frontière, cf. `isOriginAllowedForDesktopCSRF`).
- Un endpoint de production sans auth (desktop) est atteignable par CSRF depuis
  n'importe quel site : chaque route POST mutante réfléchit à sa garde origin.
- Aucun token serveur (GITHUB_TOKEN, JINA_API_KEY…) n'est attaché à une requête
  déclenchée par un appelant anonyme.

## Tests

- Un fix de sécurité s'accompagne du test qui rejoue l'attaque (voir
  `lib/__tests__/script-sandbox.test.ts` → les PoC d'évasion comme contrat).
- Un test qui mocke le mécanisme qu'il prétend tester (ex: mocker `node:vm`
  avec `new Function`) ne vaut rien — tester le vrai chemin ou ne pas écrire.
