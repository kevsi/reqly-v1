# Audit complet du monorepo apiPlayground (package "reqly")

Racine du dépôt : répertoire courant. Packages présents :

- reqy-web (app Next.js)
- recli (CLI)
- reqly-landing (site vitrine)
- mcp-docs (docs Next.js)
- hooklet-mobile (Expo/React Native)
- src-tauri (Rust/Tauri)
- sync-server
- packages/shared
- scripts, docs

Un audit partiel existe déjà dans `reqy-web-audit-report.md` : lisez-le pour ne pas le dupliquer, vérifiez/corrigez ses conclusions si possible, mais votre périmètre est le DÉPÔT ENTIER (pas seulement reqy-web).

## Consignes

Produisez un audit approfondi couvrant :

1. SÉCURITÉ : secrets/API keys/tokens en dur, fichiers .env committés (vérifiez .gitignore), eval/fonctions dangereuses, surfaces XSS/CSRF/injection, failles d'auth/autorisation, vulnérabilités de dépendances (lancez `pnpm audit` à la racine et dans chaque package pertinent ; ignorez `npm audit` car le projet utilise pnpm/lockfile pnpm).
2. QUALITÉ DE CODE : règles de lint strictes (no-explicit-any, no-unused-vars, exhaustive-deps), état du typecheck, code mort, gestion d'erreurs, TODO/FIXME/console.log restants.
3. ARCHITECTURE : structure monorepo, couplage entre packages, duplication, séparations claires.
4. TESTS : couverture, tests manquants, et SURTOUT : est-ce que `pnpm test`, `pnpm lint`, `pnpm typecheck` passent actuellement ? LANCEZ-LES et rapportez les vrais résultats (codes de sortie réels). Note : turbo peut exiger un champ `packageManager` dans le package.json racine — signalez-le comme un problème de config si c'est le cas, et trouvez un moyen de contourner (ex. lancer les scripts directement dans chaque package) pour obtenir les vrais résultats de lint/typecheck/test.
5. DÉPENDANCES : packages obsolètes ou risqués, cohérence du lockfile.
6. CI/CD : revue du contenu de `.github/workflows`.
7. PERFORMANCE & CONFIG : taille des bundles (il y a un gate de 500KB gzip), config de build.

## Exigences de rigueur

- Soyez concret : citez chemins de fichiers et numéros de ligne.
- LANCEZ réellement les commandes vérifiables (pnpm audit, pnpm lint, pnpm typecheck, pnpm test) et rapportez leurs vrais codes de sortie/sorties — n'inventez rien. Si une commande est trop longue ou échoue à cause de l'environnement, dites-le explicitement.
- N'inventez AUCUNE vulnérabilité, AUCUN fichier, AUCUN résultat de test.

## Format de sortie

Rapport markdown structuré avec :

- Une section par domaine (les 7 ci-dessus)
- Une sévérité (Critical/High/Medium/Low) pour chaque constat
- Une liste priorisée des 10 principales choses à corriger
- Une section `VERIFICATION` finale listant les commandes réellement exécutées et leurs vrais résultats

Écrivez le rapport final dans le fichier `AUDIT_REPORT.md` à la racine du dépôt (en plus de l'afficher).
