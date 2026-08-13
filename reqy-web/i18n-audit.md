# AUDIT i18n — reqy-web (fonctionnalité multilangue FR/EN)

Date : 2026-08-12 · Périmètre : `reqy-web` uniquement (l'app Next.js, `src/`, `app/`, `components/`, `hooks/`, `lib/`).
Méthode : lecture du code + scripts Node de comparaison de locales + greps + `tsc --noEmit`. Aucun résultat inventé : chaque constat est vérifié avec son fichier et sa ligne.
**Statut : audit initial + corrections appliquées le même jour (voir §7).**

---

## RÉSUMÉ EXÉCUTIF

- **Base saine** : architecture solide (i18next 26 + react-i18next 17, client-side, compatible `output: 'export'`), **parité parfaite des clés** entre `fr.json` et `en.json` (**1638 / 1638** après corrections, zéro clé manquante), typecheck **exit 0**.
- **3 bugs réels corrigés** : 1 clé utilisée mais absente (`request.sizeLabel`) et 2 textes français restés dans le fichier anglais (`auth.noVariables`, `graphql.address.historyDesc`).
- **Gros trous de couverture corrigés** : panneau IA (`src/ai/components/**` + règles d'analyse locales + labels de hooks), pages **Login/Signup**, **barre d'onglets** (`request-tab-bar.tsx`), sélecteur de thème, éditeur KV, arbre de dossiers, chaînes de requêtes, outil git.
- **Test de parité FR/EN ajouté** (`lib/__tests__/i18n-parity.test.ts`, 5 tests, environnement node) : clés identiques, formes plurielles complètes, aucune fuite de français dans `en.json`, valeurs identiques sous allowlist, intégrité des clés `t()` utilisées.
- **Restant** : `tunnel-facilitator.tsx` (code mort, « Recommandé : » en dur) ; tests composants bloqués par l'environnement (jsdom absent du store pnpm) ; la fonctionnalité entière n'est pas committée.

---

## 1. ARCHITECTURE (inchangée, saine)

| Élément               | Constat                                                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Librairies            | `i18next@26.3.6` + `react-i18next@17.0.11` (package.json), client-side uniquement                                                                                            |
| Init                  | `src/i18n/index.ts` — namespace unique `translation`, `lng: "fr"`, `fallbackLng: "fr"`, `returnNull: false`                                                                  |
| Structure des locales | JSON **imbriqué** (1638 clés aplaties), dérogation assumée au plan initial (« clés plates »)                                                                                 |
| Provider              | `components/i18n-provider.tsx` monté dans `app/layout.tsx` ; lit `store.language` + `isLoaded`, `changeLanguage` après hydration, met à jour `document.documentElement.lang` |
| Persistance           | `language` dans `RequestStore` → `sanitizeStore` → IndexedDB / FS Tauri, cross-tab                                                                                           |
| Mutation              | `setLanguage` (`hooks/store/preferences.ts`) → `commit` → save debounced                                                                                                     |
| Hydration             | `lng: "fr"` initial = rendu SSG → zéro `hydration mismatch`                                                                                                                  |

---

## 2. BUGS — clés manquantes / traductions fausses (corrigés ✅)

- **B1 ✅** — `request.sizeLabel` **ajoutée** dans `request` (FR « Taille : {{size}} », EN « Size: {{size}} ») ; affichée par `request-tabs-manager.tsx:515`.
- **B2 ✅** — `auth.noVariables` dans `en.json` : « Aucune variable » → **« No variables »**.
- **B3 ✅** — `graphql.address.historyDesc` dans `en.json` : « historique » → **« history »**.
- **B4 ✅** — `importExport.common.more` : **`more_one` ajouté** (FR/EN) — cas `count = 1` couvert.
- **B5 ✅** (trouvé par le test de parité) — `runner.verdictFailed` et `runner.iterationsLine` : forme `_one` **ajoutée** (le `count` fourni par `runner/page.tsx` retombait sur la forme singulière pour les pluriels).

---

## 3. COUVERTURE — écrans traduits pendant cette passe (✅)

### ✅ 3.1 Pages d'authentification — clés `authPage.*` créées (30 clés)

- `app/login/page.tsx` et `app/signup/page.tsx` : **100 % via `useTranslation`** (titres, labels, placeholders, boutons, erreurs de validation, étape de vérification, compteur, aria-labels). Les messages d'erreur provenant du serveur (`err.message`) restent tels quels (données backend).

### ✅ 3.2 Panneau IA complet — clés `ai.*` créées (~90 clés)

- `src/ai/components/ai-sidebar.tsx`, `ai-history-panel.tsx`, `ai-rules-panel.tsx`, `ai-plan-panel.tsx`, `ai-chat-message.tsx`, `ai-agent-controls.tsx`, `assistant-steps-renderer.tsx` (y compris `defaultLabelForKind` : « Through… » → `ai.steps.thinking`), `AIModal.tsx` (onglet Explain : headers, JWT, JSON), `RatingButtons.tsx`, `ai-permissions-popover.tsx` : **100 % via `useTranslation`**.
- Labels de hooks : `use-ai-sidebar-chat.ts` (« Requête HTTP », « Analyse terminée », « Mode plan — N action(s) », refus/confirmation, timeout) et `use-ai-engine.ts` (messages d'erreur) via `i18n.t` du singleton.
- **Moteur de règles locales** (`src/ai/local-engine/rules/{auth,ssl,server,performance,format}.ts`) : les 27 règles sont traduites via `i18n.t("ai.diag.<ruleId>.*")` (title/explanation/fix), avec interpolation (`{{ms}}`, `{{msg}}`, `{{value}}`, `{{kb}}`). Les **system prompts LLM restent en français** (choix du plan : contexte IA, pas de l'UI).

### ✅ 3.3 Assistant IA legacy — clés `ai.legacy.*` créées (18 clés)

- `components/ai-assistant-modal.tsx` : suggestions, placeholder, « Monu réfléchit… », disclaimers, toasts/notifications (message envoyé, réponse reçue, erreur) — **100 % via `useTranslation`**.

### ✅ 3.4 Barre d'onglets — clés `runner.tabs.*` créées (18 clés)

- `components/request-tab-bar.tsx` : tooltips (scroll, rename, unsaved, collections, duplicate, save, history, all tabs, new tab) + menu contextuel (Save/Duplicate/Rename/Close/Close Others/Close to the Right/Close All/Save All) — **100 % via `useTranslation`**.

### ✅ 3.5 Strings en dur isolées

- `key-value-editor.tsx` : « Click below to add your first entry » → `common.addEntryHint` (la seule ligne non surchargeable), aria « Disable »/« Enable » → `common.disable`/`common.enable` ; les défauts de props (`Key`/`Value`/`Add`/`No items added yet`) basculent sur `t()` quand les callers ne fournissent rien.
- `collections-folder-tree.tsx` : « Create folder », « New folder », `Folder name`, « Cancel »/« Create », « Move folder/request to... » → `collections.folder.*` + `common.*`.
- `request-chain-workflow.tsx` : toasts → `chain.*` (avec formes plurielles `savedDesc_*`, `executedDesc_*`).
- `theme-switcher.tsx` : « Change theme », « Theme », « Appearance », « Select a theme », **8 descriptions de thèmes** (déplacées en `descriptionKey`), « Active: », « resolved to » → `settings.apparence.*`.
- `git-remote-bar.tsx` : Fetch/Pull/Push/Remove, tooltip force-push, dialogue « Force push? » → `git.*` (avec `Trans` pour le body).
- `workspaces/page.tsx` : « Local workspace — cannot be shared » → `workspace.localTooltip`.

---

## 4. QUALITÉ & HYGIÈNE (corrigé ✅ / restant ⚠️)

- ✅ **Test de parité ajouté** (`lib/__tests__/i18n-parity.test.ts`, `// @vitest-environment node` — s'exécute sans jsdom) :
  1. jeux de clés FR/EN identiques ;
  2. paires plurielles `_one`/`_other` complètes ;
  3. aucune fuite de français dans `en.json` (accents + mots-outils) ;
  4. valeurs identiques FR/EN limitées à une allowlist explicite de termes techniques ;
  5. toute clé `t()` statique du codebase résolue par les locales.
- ✅ **Fuite d'état du test existant corrigée** : `sync-signed-out-banner.test.tsx` restaure `fr` en `afterEach` (i18next est un singleton).
- ✅ **Arbitrage FR** : `importExport.openapiExport.inferSchemas` (« Inférer les schémas depuis l'historique… »), `newProject.settingsLabel` (« Paramètres »), `newProject.noAiKeyDesc`, `routeModal.total` (« au total ») — traduits dans `fr.json`.
- ✅ **~15 clés mortes supprimées** (`common.clear/ok/rename/noDataYet`, `language.en/fr`, `response.copyResponse/fullscreen/openInModal`, `dashboard.range7d/30d/all`, `graphql.request.history/variables`, `graphql.builder.noSchema`, `settings.integrations.associate`, `settings.title`, `collections.searchPlaceholder`).
- ⚠️ **FOUC au démarrage** pour les utilisateurs EN (flash de français avant hydration) : non traité (trade-off de conception du plan, `I18nProvider` ne gate pas le rendu sur `isLoaded`).
- ⚠️ **`tunnel-facilitator.tsx`** : code mort (non importé nulle part), « Recommandé : » en dur — à supprimer ou archiver.
- ⚠️ **État git** : fonctionnalité i18n non committée (`src/i18n/` + 5 fichiers en `??`) sur 137 fichiers modifiés — aucun historique pour cette feature.

---

## 5. VÉRIFICATION (commandes réellement exécutées)

| Commande                                                               | Résultat                                                                                                                                     |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx tsc --noEmit` (reqy-web)                                          | **exit 0** — typecheck propre après toutes les refactorisations                                                                              |
| `npx vitest run lib/__tests__/i18n-parity.test.ts`                     | **5/5 tests passés** (node env, sans jsdom)                                                                                                  |
| Script parité clés (flatten fr/en)                                     | 1638 = 1638, 0 clé manquante de chaque côté                                                                                                  |
| Grep texte FR dans `en.json`                                           | 0 fuite (hors `language.fr` légitime)                                                                                                        |
| Grep JSX accentué (app/components/src-ai, hors locales/comments/tests) | 1 seul hit : `tunnel-facilitator.tsx` (mort)                                                                                                 |
| `npx vitest run` (tests composants)                                    | **Bloqué par l'environnement** : jsdom 29.1.1 absent du virtual store pnpm → `MODULE_NOT_FOUND`. Nécessite `pnpm install`. Non lié à l'i18n. |
| `npx eslint`                                                           | Non exécuté (interrompu par l'utilisateur)                                                                                                   |

---

## 6. PRIORITÉS RESTANTES

1. **Environnement** : `pnpm install` pour réparer le virtual store (jsdom) puis lancer la suite complète + `eslint`.
2. **Supprimer `tunnel-facilitator.tsx`** (code mort, non importé).
3. **Committer la fonctionnalité i18n** (aujourd'hui 10 fichiers `??` + 137 modifiés).
4. **FOUC** : décider si on gate le rendu sur `isLoaded` (squelettes) ou on documente le trade-off.
5. **Étendre le test de parité à l'exécution** (verrou `keySeparator`/pluriels au runtime i18next) si besoin.

---

## 7. CORRECTIONS APPLIQUÉES (journal)

- Locales : `request.sizeLabel` ajoutée ; `auth.noVariables`, `graphql.address.historyDesc` corrigées dans `en.json` ; `more_one` ajouté ; `verdictFailed_one`/`iterationsLine_one` ajoutés ; 15 clés mortes supprimées ; 3 strings anglaises traduites en FR ; namespaces créés : `authPage.*` (30), `runner.tabs.*` (18), `ai.*` (~90 dont `sidebar/history/rules/plan/chatMessage/agent/steps/modal/rating/permissions/hooks/legacy`), `ai.diag.*` (27 règles × title/explanation/fix), `chain.*` (8), `git.*` (8), `collections.folder.*` (5), `common.enable/disable/create/addEntryHint`, `settings.apparence.*` (12), `workspace.localTooltip`.
- Composants traduits : `app/login/page.tsx`, `app/signup/page.tsx`, `request-tab-bar.tsx`, `key-value-editor.tsx`, `collections-folder-tree.tsx`, `request-chain-workflow.tsx`, `theme-switcher.tsx`, `git-remote-bar.tsx`, `app/(app)/workspaces/page.tsx`, `ai-assistant-modal.tsx`, les 10 composants de `src/ai/components/`, `use-ai-sidebar-chat.ts`, `use-ai-engine.ts`, les 5 fichiers de `src/ai/local-engine/rules/`.
- Tests : `lib/__tests__/i18n-parity.test.ts` créé (5 tests) ; `sync-signed-out-banner.test.tsx` corrigé (restaure `fr`).
