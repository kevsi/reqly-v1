# Reqly — Validation locale et GitHub Actions

**Version documentée :** 0.1.0  
**Dernière mise à jour :** 13 août 2026  
**Périmètre :** `reqy-web`, `src-tauri`, `recli`, `sync-server` et les workflows CI associés. Hooklet mobile est exclu.

## 1. Principes de validation

Le dépôt utilise pnpm workspaces et Turborepo. Les contrôles généraux sont exécutés depuis la racine afin de respecter le graphe de dépendances entre `@reqly/shared`, l’application web, le serveur de synchronisation et les outils CLI.

La validation est organisée en quatre niveaux : qualité statique, tests unitaires, tests E2E web et validation desktop Tauri. Un échec dans un niveau bloquant doit empêcher la production des artefacts dépendants. Le workflow GitHub Actions installe les versions déclarées dans le dépôt et conserve les rapports Playwright lorsqu’un test E2E échoue.

## 2. Commandes locales

| Objectif                  | Commande                                                          |
| ------------------------- | ----------------------------------------------------------------- |
| Installer les dépendances | `pnpm install --frozen-lockfile`                                  |
| Lint global               | `pnpm lint`                                                       |
| Typecheck global          | `pnpm typecheck`                                                  |
| Tests unitaires globaux   | `pnpm test`                                                       |
| Suite E2E web complète    | `pnpm test:e2e`                                                   |
| E2E web ciblé             | `pnpm --dir reqy-web exec playwright test tests/e2e/home.spec.ts` |
| Build web                 | `pnpm build`                                                      |
| Développement Tauri       | `pnpm tauri:dev`                                                  |
| Build Tauri               | `pnpm tauri:build`                                                |
| Tests Rust Tauri          | `cargo test --locked` depuis `src-tauri/`                         |
| Formatage Rust            | `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`       |
| Vérification Rust         | `cargo check --manifest-path src-tauri/Cargo.toml --locked`       |

Pour une exécution qui reproduit le comportement CI de Playwright, utiliser `CI=true`. Dans ce mode, Playwright ne réutilise pas un serveur existant et génère également le rapport HTML dans `reqy-web/playwright-report/`.

## 3. Pipeline GitHub Actions

Le workflow est défini dans [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). Les jobs de qualité `typecheck`, `lint` et `test` constituent le socle commun. Le job `e2e` dépend de ce socle, installe Chromium avec ses dépendances Linux, exécute `pnpm --dir reqy-web test:e2e` et téléverse `playwright-report/` ainsi que `test-results/` avec `if: always()`.

Les jobs de production dépendent du gate E2E :

| Job             | Rôle                                              | Dépendances principales                           |
| --------------- | ------------------------------------------------- | ------------------------------------------------- |
| `typecheck`     | Vérification TypeScript des packages concernés    | `@reqly/shared` construit avant les consommateurs |
| `lint`          | ESLint sans warning autorisé                      | Aucune                                            |
| `test`          | Tests unitaires et scan de secrets                | Installation complète du monorepo                 |
| `e2e`           | Parcours fonctionnels web Playwright              | `typecheck`, `lint`, `test`                       |
| `build-web`     | Build Next.js SSR et contrôle de taille du bundle | `typecheck`, `lint`, `test`, `e2e`                |
| `tauri-check`   | Formatage, compilation et tests Rust              | Toolchain Rust et dépendances Linux               |
| `build-desktop` | Build Tauri Ubuntu, macOS et Windows              | `typecheck`, `lint`, `test`, `e2e`, `tauri-check` |
| `build-docker`  | Image Docker et démarrage de contrôle             | `typecheck`, `lint`, `test`, `e2e`                |

Le gate E2E ne remplace pas les tests unitaires. Les deux niveaux sont complémentaires : les tests unitaires couvrent les fonctions et modules isolés, tandis que Playwright vérifie le rendu, l’hydratation, les interactions et les parcours représentatifs dans un serveur Next.js de production.

## 4. Configuration Playwright

La configuration se trouve dans [`reqy-web/playwright.config.ts`](../reqy-web/playwright.config.ts). Les tests utilisent un seul worker, un viewport de 1280 × 720 et l’URL `http://localhost:3000`. Le serveur géré par Playwright exécute `pnpm build && pnpm start -p 3000`.

Le rendu dynamique du layout racine est nécessaire à la propagation du nonce CSP aux scripts inline Next.js. Toute modification de la stratégie CSP ou du mode de rendu doit être accompagnée d’un run E2E complet, car un problème d’hydratation peut faire échouer des dizaines de scénarios sans révéler immédiatement la cause fonctionnelle.

En CI, le reporter est configuré en mode `list` et HTML. En local, seule la sortie `list` est utilisée par défaut. Les artefacts de test ne doivent pas être ajoutés au dépôt.

## 5. Smoke tests desktop Tauri

Le job `tauri-check` installe la toolchain Rust stable, les composants `rustfmt` et `clippy`, puis les dépendances Linux nécessaires à Tauri. Il exécute `cargo fmt --check`, `cargo check --locked` et `cargo test --locked` depuis `src-tauri/`.

Les smoke tests desktop couvrent notamment deux contrats à forte valeur : la sérialisation camelCase des structures IPC utilisées par le frontend et la disponibilité stable de la clé de chiffrement de session après initialisation. Les tests sont localisés dans [`src-tauri/src/store.rs`](../src-tauri/src/store.rs) avec les tests du stockage offline.

Le build desktop exécute `pnpm tauri:build` sur une matrice Ubuntu, macOS et Windows. Les bundles produits sont téléversés sous le nom `desktop-build-{os}`. Le build desktop n’est pas un simple export statique Next.js : il vérifie désormais le packaging Tauri et ses artefacts natifs.

## 6. Procédure de diagnostic en cas d’échec

En cas d’échec E2E, consulter d’abord le nom du scénario et le premier message d’erreur, puis télécharger l’artefact `playwright-e2e-report`. Vérifier ensuite si l’échec concerne le serveur de production, la CSP, un sélecteur localisé ou une fonctionnalité réellement cassée. Il ne faut pas affaiblir un test en supprimant une assertion utile ou en désactivant une règle ESLint sans comprendre la cause.

En cas d’échec Tauri, distinguer les catégories suivantes : outil Rust ou dépendance système manquante, erreur de compilation du backend, erreur de packaging, permission native ou problème spécifique à un runner macOS/Windows. Un `cargo test --no-run` ne constitue pas une validation suffisante des tests : le job doit exécuter `cargo test --locked`.

En cas d’échec Docker, vérifier séparément la construction de l’image, les variables publiques nécessaires au build Next.js et le démarrage du conteneur sur le port 3000. Le secret `AUTH_SIGNING_SECRET` doit rester injecté à l’exécution et ne doit pas être passé comme argument de build.

## 7. Résultats de référence

La suite E2E complète de `reqy-web` a été validée localement avec **107 tests passés sur 107** après stabilisation de la CSP et des sélecteurs fonctionnels. Le smoke run exécuté avec `CI=true` a également validé les trois scénarios de `home.spec.ts`. Le lint et le typecheck web sont verts.

La validation Cargo peut nécessiter une machine disposant d’un accès crates.io et des dépendances GTK/Tauri. Dans un environnement sans cache Rust complet, l’échec de résolution d’une dépendance ne doit pas être confondu avec un échec des tests applicatifs.

## 8. Références internes

[1]: ../.github/workflows/ci.yml "Workflow GitHub Actions"
[2]: ../reqy-web/playwright.config.ts "Configuration Playwright"
[3]: ../reqy-web/tests/e2e/ "Scénarios E2E web"
[4]: ../src-tauri/src/store.rs "Tests et contrats du stockage desktop"
[5]: ../src-tauri/Cargo.toml "Dépendances Rust et Tauri"
[6]: ../package.json "Scripts racine du monorepo"
