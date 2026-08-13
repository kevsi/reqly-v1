# Plan i18n FR/EN — Reqly

Objectif : basculer FR ↔ EN depuis Settings, choix persisté, re-render sans reload, compatible `output: 'export'`.

## Décisions d'architecture

- **Librairies** : `i18next` + `react-i18next`, client-side uniquement. Pas de routing par locale, pas de `generateStaticParams`, pas de `/fr/` `/en/` dans les paths.
- **Namespace unique** : un seul `locales/{fr,en}.json` par langue, keys « plates » préfixées (`runner.x`, `collections.x`, `settings.x`, `errors.x`, `common.x`). Plus simple que les namespaces i18next imbriqués, évite la config `defaultNS`.
- **Persistance** : ajout de `language: Language` au `RequestStore` existant. Le store est déjà persisté en entier dans `storageAdapter` (IndexedDB web / FS Tauri) sérialisé par `sanitizeStore` (`...store` → le champ voyage avec le reste). Aucun nouveau mécanisme de persistance.
  - `language` liquidé dans `buildInitialStore()` (défaut `'fr'`) et lu dans `loadFromStorage()` (clé `parsed.language === "en" ? "en" : "fr"`) + migration `migrateWorkspaceIds` (no-op pour language).
- **Hydration** : pas traduit tant que le store n'est pas hydraté. Le store possède déjà `isLoaded: boolean` (set par `initStore` / `StoreInitializer`) — on s'appuie dessus, pas de `suppressHydrationWarning`.
  - `i18n.init({ lng, fallbackLng: "fr", resources })` : `lng` initial = `fr` (défaut rendu serveur/SSG).
  - `<I18nProvider>` dans le layout racine qui lit `useRequestStore(s => s.language)` + `isLoaded` :
    - `!isLoaded` → rendu squelette (labels vides / skeleton), aucune string traduite rendue.
    - `isLoaded` → `i18n.changeLanguage(language)` (async, puis re-render via `i18n.on("languageChanged")` côté mise à jour d'état). Toutes les strings viennent de `useTranslation()`.
  - Ainsi le premier rendu client == rendu SSG (fr), et le bascule se fait après hydration → zéro `hydration mismatch`.
- **Changement de langue Live** : `setLanguage(lang)` (mutation du store, `commit`) → `language` change → provider effectue `changeLanguage`.

## Fichiers

### Créés

```
src/i18n/index.ts                    // init i18next (resources, fallback, export useTranslation/i18n)
src/i18n/locales/fr.json              // FR (réutilise les strings FR déjà présentes)
src/i18n/locales/en.json              // EN (traductions à écrire)
components/i18n-provider.tsx          // lit store.language, sync i18n.changeLanguage, gate isLoaded
components/settings/language-select.tsx // Select FR/EN dans Apparence
```

### Modifiés

```
hooks/request-types.ts                // + language: Language (type)
hooks/store/persistence.ts            // default `fr` + loadFromStorage mapping
hooks/use-request-store.ts            // buildInitialStore + `setLanguage` exposed via store (reuses `set`/`commit`)
app/(app)/layout.tsx                    // montage <I18nProvider> (au-dessus du contenu)
components/settings/sections/apparence-section.tsx // + <LanguageSelect/>
```

> Persistance grillée en cascade : `language` fait partie du JSON store sauvé, donc rien de plus à câbler (cross-tab reload inclus via `setReloadHandler`).

### Fichiers de strings à traduire (phase implémentation, un par un)

Runner: `app/(app)/runner/page.tsx`, `runner/loading.tsx`, `request-panel.tsx`, `request-panel-url-bar.tsx`, `request-tab-bar.tsx`, `body-editor.tsx`, `key-value-editor.tsx`, `response-status-bar.tsx`, `response-panel.tsx`, `response-headers-tab.tsx`, `response-cookies-tab.tsx`, `response-test-results.tsx`, `response-timeline.tsx`, `response-ai-summary.tsx`.
Collections: `collections/page.tsx`, `collections/loading.tsx`, `collection-row.tsx`, `collections-folder-tree.tsx`, `collections-request-tree-item.tsx`, `collections-empty-state.tsx`, `collections-search-bar.tsx`, `collections-selection-toolbar.tsx`, `collections-delete-dialog.tsx`, `collections-modal.tsx`, `collections-panel.tsx`, `request-save-dialog.tsx`, `request-unsaved-close-dialog.tsx`.
Sidebar/header: `api-sidebar.tsx`, `api-header.tsx`, `account-menu.tsx`, `module-nav-list.tsx`.
Globaux: `error-boundary.tsx`, `history-panel.tsx`, `request-tabs-manager.tsx`, `auth-section.tsx`, `environment-selector.tsx`, `workspace-selector.tsx`, `sync-signed-out-banner.tsx`, `keyboard-shortcuts-modal.tsx` + `lib/shortcut-defs.ts`, `dashboard/page.tsx`, `dashboard/charts-content.tsx`, `settings/page.tsx`, tous les `components/settings/**`.
IA: `ai-assistant-modal.tsx`, sidebar AI (`use-ai-sidebar-chat.ts` prompts — prompts LLM **pas** traduits à la volée, voir exclusions).

## Inventaire des clés (par feature)

### common.*

```
common.cancel, common.save, common.delete, common.rename, common.close,
common.loading, common.error, common.retry, common.ok, common.apply, common.confirm,
common.add, common.export, common.copy, common.copied, common.clear, common.unknown,
common.connected, common.disconnected, common.noDataYet, common.variables,
common.timeAgo.{justNow,minutes,hours,days}, common.milliseconds
```

### `runner.*`

```
runner.title, runner.description, runner.send, runner.sending, runner.sendRequest,
runner.sendAndSave, runner.sendAndDownload, runner.running, runner.method, runner.url.placeholder,
runner.url.enterHint, runner.url.invalidVariableSyntax, runner.export, runner.copied,
runner.copy, runner.cancel, runner.key, runner.value, runner.add,
runner.loading, runner.emptyEssay,
runner.status.{passed,failed,skipped,errored}, runner.filter.{all,errors,noResults},
runner.assertion.{statusEquals,statusIn,statusNot,responseTime,jsonPath,schema,generic,actual},
runner.assertion.jsonPathOp.{equals,contains,exists,notExists}, runner.assertions.{title,empty},
runner.scriptOutput, runner.run, runner.noCollections, runner.selectCollectionFirst,
runner.selectCollectionPlaceholder, runner.requestCount, runner.noRequests,
runner.dataset.{title,optional,rowCount,iterations,columns,fileLabel,clear,pool,load,upload,
runner.dataset.errors.{pasteData,noCsvRows,parseFailed},
runner.progress.{executing,complete}, runner.noRunsYet, runner.empty.description,
runner.verdict.{allPassed,failures}, runner.exportJson, runner.exportJUnit, runner.reRunFailed,
runner.integrity.{hash,verify,intact,modified}, runner.requests.title, runner.requests.count,
runner.variables, runner.prettyCount, runner.autocomplete.{chain,history,commonHeaders,noResults},
runner.pathVariables.{title,add,empty}, runner.queryParams.{title,add,empty},
runner.headers.{title,add,empty}, runner.tests.{title,empty,emptyDescription},
runner.scripts.title, runner.body.{title,format,formatTooltip,valid,invalid,parsed,raw,
 empty,addField,placeholderBinary,placeholderRaw,type}, runner.curl.{title,import,imported,
 importedDescription,errors.*}, runner.tabs.{*,*...scroll,nbreak,nrematch,unsavedHint,
 saveTooltip,duplicateTooltip,allTabs,newTab,save,duplicate,rename,close,closeOthers,
 closeToRight,closeAll,saveAll}, runner.pathVariables
```

### `collections.*`

```
collections.list.{title,description,import,export,importing,exporting,newCollection},
collections.list.loading, collections.list.totalCount, collections.list.searchPlaceholder,
collections.list.newCollectionName, collections.list.importedCollectionName,
collections.list.reorderSuccess, collections.list.runAll,
collections.import.{postmanImported,renamedDueToConflict,openApiDone,openApiImported,
 singleCollectionImported,collectionsImported,unrecognizedFormat,invalidJson},
collections.errors.{postmanNotConnected,generic,postmanExportFailed,exportFailed,
 noCollectionsSelected,openApiExportFailed},
collections.export.{postmanSuccess,postmanCollectionCreated,postmanExportImpossible, saved,downloaded},
collections.request.{newRequestName,loadedInEditor,loadedAndSent,add,move,
 remove,removeConfirm,loadAndExecute,copySuffix,saveDialogTitle,saveDialogDescription,
 nameLabel,namePlaceholder,collectionOptionalLabel,noCollection,drafts,save},
collections.folder.{new,newFolderPrompt,add,rename,renamePrompt,delete,remove,deleteConfirm,
 addSubfolder,move,moveTitle,rootOption,create,name,namePlaceholder,empty,uncategorized},
collections.toolbar.{deleteConfirm,collectionCount,requestCount,selected,
 selectedCollections,selectedRequests,clear,selectAll,deselectAll,filtersSort,sortName,sortRecent,sortRequests},
collections.empty.{noSearchResultsTitle,noSearchResultsDescription,noCollectionsTitle,
 noCollectionsDescription,createCollection,folderEmpty,noRequestsTitle,noRequestsDescription,noFoldersYet},
```

Quatre clusters hors du schéma initial → ajoutés : `collections.import.*`, `collections.export.*`, `collections.common.*`. Les strings partagés (`Cancel`, `Delete`, `Rename`, `OK`) pointent vers `common.*`.

### `settings.*`

```
settings.sidebar.{apparence,ai,notifications,integrations,keyboard,mcp,modules,ariaLabel,expand,collapse},
settings.apparence.{title,description,
 theme,themeDescription,moreThemes,accent,accentDescription,accentError,accentReset,
 animations,animationsDescription, lan.addTitle, languageOptionFr, languageOptionEn},
settings.ai.* (per ai-section strings),
settings.notifications.* (per notifications-section: push enabled, system push, notify events, test),
settings.integrations.{postman.*,jina.*,github.*,gitlab.*,associate,manage,throttle,disconnected,connected},
settings.keyboard.{title,description,resetAll,editShortcut,resetShortcut,pressKey,confirm},
settings.modules.{title,description,kinds,empty,version,byAuthor,activate,enabled,disabled,install,uninstall},
wireless-remember.interpolated keys `{{name}}`, `{{count}}`, `{{path}}`, `{{error}}`.
```

### `sidebar.*` + `header.*`

```
sidebar.nav.{dashboard, apiEndpoints, collections, projects, workspaces, runner, capture, settings, documentation, sdks, graphql, git, sse},
sidebar.ai.ask (Ask Monu IA / Ask Reqly AI), sidebar.collapse, sidebar.expand,
header.{newRequest, search, shortcuts, notifications, emptyNotifications, profile, account},
account.{signIn, signOut, profile}
```

### `errors.*` / `history.*` / `env.*` / `workspace.*` / `keyboard.*` / `notificationsUi.*` / `dashboard.*` / `auth.*`

```
errors.unexpectedError, errors.somethingWentWrong, errors.details, errors.retry,
errors.reloadPage, errors.editorCrashed, errors.responseCrashed,
history.title, history.searchPlaceholder, history.filter.errors, history.groups.*,
history.loadMore, history.noMatches, history.empty, history.noMatchesHint, history.emptyHint,
history.emptySubHint, history.clearDialogTitle, history.clearDialogDescription,
history.followUpTooltip, history.replayTooltip, history.removeTooltip,
history.removeDialogTitle, history.removeDialogDescription, history.drawerTitle,
env.* (env.selector placeholders, env.manage, env.addVariable, env.noVariables, env.deleteDialog*),
workspace.* (workspace labels, create/rename/delete dialogs),
keyboard.* (title, closeHint, categories, shortcut descriptions),
notificationsUi.* (builtin titles/bodies),
dashboard.* (title, stats, charts, range, health, columns),
auth.* (types, labels, placeholders, hints),
sync.banner.* (title, description, signIn, signUp),
request.decorated.crash (requestCtx crash banners)
```

> Les agents de recherche ont listé ~60 clés `runner`, ~80 `collections`, ~70 `settings`, ~50 globales/`common`. L'inventaire détaillé ligne-par-ligne est dans les rapports de recherche déjà produits.

## Ce qu'on ne traduit JAMAIS

- Noms de champs techniques : `Authorization`, `Content-Type`, `x-api-key`, `ACCESS_TOKEN`, `METHOD`, JSON/Form/x-www/Raw/Binary (labels de type de body)
- Valeurs de headers, status codes (`2xx`, `404`, `201`, `OK` en donnée)
- Contenu affiché tel quel : JSON, code, réponses API brutes, `curl`, snippets
- Noms de marque de providers (OpenAI, GitHub, Postman, ...)
- Noms visuels de thèmes (`Clair`, `Océan`, `Minuit` → restent identifiants)
- Les chaînes libellées `SKIP` dans l'inventaire ci-dessous

### Exclusions et notes de phacé

1. **System prompts IA** (ReqlyAI, sidebar AI, `lib/llm-tools` descriptions) : prompts et descriptions d'outils restent **en dur en français** (ce sont des données de contexte LLM, pas de l'UI). Voir note ii18n du pivot.
2. **`window.prompt`/`confirm`** natifs : toast/dialog natifs (folder name, etc.) — garder inline comme aujourd'hui (le browser persiste la langue), keys utilisées pour les labels inline.
3. **Dates/relatifs** : unseule implémentation `common.timeAgo` via i18next, les deux dupliques `m ago` (history + dashboard) convergent.
4. **`{{msg}}` chunks** dans `collections.toolbar.deleteConfirm` : fragment FR assemble `Supprimer X ?` — refactorisé en clé composée (une string complète avec interpolation), pas de traduction mot-à-mot de morceaux.
5. **Defaults stockés** (`New Collection`, `Drafts`, `(copy)`, `New Request`) : hoeee.injectés via clé par défaut (en: début), mais **ne pas** inclure leur valeur dans le store (chaînées stockées plus tôt). NB : `Drafts` existe déjà en démo sonner pas un key (données persistées).

## Critères d'acceptation (rappel)

1. Switch FR/EN dans Settings sans reload.
2. Langue persistée après redémarrage (Tauri + web).
3. Zéro warning hydration mismatch au démarrage (gate via `isLoaded`).
4. `npm run build` (`output: export`) passe.
5. Aucune string technique traduite par erreur.

## Ordre d'implémentation proposé (une fois validé)

0. `npm i i18next react-i18next` ; créer `src/i18n/` (fr.json vide de clés, en.json dupliqué) ; modifier `presence` (type + default + load) ; provider + language select ; composer layout.
1. Apparence (Settings) : `LanguageSelect` + côté strings.
2. Sidebar + header (navigation/AGENDA) — forte visibilité.
3. Runner (écran d'accueil).
4. Collections.
5. Global/history/env/workspace/dashboard/errors.
6. Build + vérif splash/mismatch.
