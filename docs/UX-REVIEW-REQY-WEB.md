# Revue UX — reqy-web (client API) — Évaluation heuristique structurée — 23 août 2026

Méthode : skill `ux-review` — fondations NN/g (10 heuristiques) + Laws of UX (Yablonski) + playbook `dev-tool-gui`. Compense la limite solo-dev par **3 évaluateurs indépendants** sur des scopes disjoints, scénarios concrets imposés. Sévérité Nielsen 0-4.

## Scénarios évalués

| Scope                                                    | Scénarios                                                                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **A. Flow cœur requête HTTP**                            | A1 premier succès sans doc · A2 debug en boucle (500/timeout/refus) · A3 power user 6 onglets pressé                                 |
| **B. Collections / Environnements / Variables / Import** | B1 migration Postman · B2 env dev/prod + `{{token}}` oublié · B3 imports ratés (cURL/YAML)                                           |
| **C. Runner + Assistant IA**                             | C1 validation de prod 50 req × dataset · C2 run long/interruption · C3 IA sans clé puis gros JSON · C4 corriger une assertion via IA |

---

## Findings — Sévérité 3 (majeurs, priorité haute)

### [3] R1 — Ctrl+Entrée ne fonctionne pas depuis les champs URL/body

- **Où** : A1/A3 — le geste n°1 du produit.
- **Heuristique** : #7 accélérateurs ; Jakob (convention Postman/Insomnia).
- **Preuve** : `hooks/use-shortcuts.ts:104` (`allowInInputs` réservé à formatJson) + `use-keyboard-shortcuts.ts:35`.
- **Impact** : le raccourci phare échoue là où l'utilisateur vient de taper son URL → abandonné.
- **Correctif** : `allowInInputs` pour `sendRequest` (+ saveRequest, cf. R17).

### [3] R2 — Le sélecteur d'environnement peut mentir sur l'env actif

- **Où** : B2 — après suppression de l'env actif.
- **Heuristique** : #1 état système ; #5 prévention.
- **Preuve** : affichage `|| environments[0]` (`environment-selector.tsx:64`) vs exécution stricte sans fallback (`use-request-execution-core.ts:40-41`) → pastille « prod » alors que zéro variable injectée.
- **Correctif** : supprimer le fallback ; état explicite « Aucun environnement » (pastille grise).

### [3] R3 — Les headers ne sont pas gardés : `Bearer {{token}}` littéral part en vraie requête

- **Où** : B2 — pire cas du produit.
- **Heuristique** : #5/#9 ; asymétrie avec URL/body qui sont bloqués.
- **Preuve** : garde limité à url/body/authToken (`use-request-execution-core.ts:157-161`) ; interpolation headers existe (`request-executor.ts:244-249`).
- **Impact** : 401 incompréhensible → l'utilisateur débogue son API au lieu de son env.
- **Correctif** : étendre le check aux headers résolus (boucle, faible risque).

### [3] R4 — « Rejouer la requête » de l'historique ne rejoue pas

- **Où** : A2 — affordance mensongère répétée.
- **Preuve** : bouton ↺ → `loadRequestIntoActiveTab` seulement (`history-panel.tsx:310-318` → `request-tabs-manager.tsx:702-705`) alors que `loadAndSendRequest` existe (`use-request-tab-execution.ts:325-346`).
- **Correctif** : brancher ↺ sur `loadAndSendRequest` ; clic-ligne = charger.

### [3] R5 — Run en cours : dialogue fermable → plus aucun accès Stop ni progression

- **Où** : C2 — run de prod long.
- **Heuristique** : #3 contrôle ; « annulation toujours visible » (dev-tool).
- **Preuve** : seul Stop vit dans le modal (`runner/page.tsx:1531-1541`) ; réouverture conditionnée à `{report && …}` (`:838-848`) or `report=null` jusqu'à la fin.
- **Correctif** : condition `(report || isRunning)` + libellé « Voir la progression » + Stop dupliqué dans la bande d'état.

### [3] R6 — Re-run Failed falsifie le rapport et l'export JUnit

- **Où** : C1 — workflow standard (échouer puis rejouer).
- **Preuve** : fusion écrase `summary.total` (50→3) et durées (`runner/page.tsx:730-739`) ; JUnit `tests="3"` (`junit-export.ts:38-44`).
- **Correctif** : recalculer `summary` via `summarize()` sur résultats fusionnés ; conserver startedAt ; durée « cumulée/dernier passage » explicite.

### [3] R7 — Fermer l'onglet pendant un run = run + rapport perdus ; zéro historique de runs

- **Où** : C2 — traçabilité = valeur cœur du runner.
- **Preuve** : `report` en useState uniquement (`:412`) ; pas de beforeunload/abort cleanup ; sidebar IA persiste déjà ses sessions (l'infra existe).
- **Correctif** : beforeunload si isRunning + abort au unmount + persistance N derniers rapports (« Runs précédents »).

### [3] R8 — Taxonomie d'erreurs réseau trompeuse + code cassé

- **Où** : A2 — debug en boucle.
- **Preuve** : proxy émet `SSRF_BLOCKED`, client attend `BLOCKED_SSRF` (`proxy/route.ts:255` vs `request-executor.ts:327`) → message générique ; tout échec amont → BAD_GATEWAY « Le proxy a rencontré une erreur » alors que c'est souvent la cible (refusée/TLS/éteinte).
- **Correctif** : corriger le libellé ; distinguer ECONNREFUSED/CERTIFICATE/timeout avec pistes d'action (« serveur injoignable — est-il démarré ? »).

### [3] R9 — Ctrl+K triplement bindé (palette + modal raccourcis simultanés)

- **Preuve** : `api-header.tsx:74-84` + `layout.tsx:66-69` + `shortcut-defs.ts:50-54` ; matching par `title` casse en FR.
- **Correctif** : router via SHORTCUT_DEFS uniquement ; matcher par `data-testid`.

### [3] R10 — Fermetures en masse sans protection des onglets non sauvegardés

- **Preuve** : fermeture unitaire protégée mais `closeOthers/closeToRight/closeAllTabs` sans check `isSaved` (`use-request-tabs-state.ts:183-204`) ; « Save All » bascule isSaved sans sauvegarder réellement.
- **Correctif** : même garde que l'unitaire (ou compteur « N onglets non sauvegardés ») ; rendre Save All réel ou le renommer.

### [3] R11 — Post-import : aucune orientation vers la collection créée

- **Où** : B1 — migration Postman de 200 requêtes.
- **Preuve** : succès = toast seul (`collections/page.tsx:150-162`) ; liste triée par nom, aucun highlight.
- **Correctif** : scrollIntoView + ring 2 s sur la collection importée, badge « Nouveau », ou lien dans le toast.

---

## Findings — Sévérité 2 (mineurs significatifs)

| #   | Titre                                                                                                     | Preuve                                                              | Correctif                                                                |
| --- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| R12 | Mode Performance muet : aucune position N/M                                                               | `executor.ts:162-190` sans callback ; barre figée                   | thread `onRequestDone` comme mode functional                             |
| R13 | Dataset CSV : échecs silencieux (state écrit jamais rendu)                                                | `const [, setDatasetError]` (`page.tsx:403`)                        | rendre l'erreur + préview 3 lignes + alerte colonnes ≠ placeholders      |
| R14 | Dataset masque « Itérations » sans le dire ; CTA compte reqs, pas exécutions                              | `runner.ts:76-83` ; CTA `:1464`                                     | badge « 50 × 12 = 600 », désactiver itérations                           |
| R15 | « En cours : X » montre la dernière terminée                                                              | `onRequestDone` post-complétion (`runner.ts:112`)                   | renommer « Terminée : X (23/50) »                                        |
| R16 | Pas de pont IA depuis le rapport Runner (échecs visibles, correctif ailleurs)                             | `page.tsx:248-270` vs flux existant `assertion-correction.tsx`      | stocker extrait body + monter AssertionCorrection                        |
| R17 | AIModal non interrompable (`signal: undefined`), pas de stop ni chrono                                    | `AIModal.tsx:659,825-845` vs sidebar complète                       | AbortController + bouton Square + stall timeout                          |
| R18 | Troncature IA 2000 chars invisible ; gros JSON peu lisibles                                               | `prompt.ts:24,30-35`                                                | hint « contexte tronqué » + blocs json repliés                           |
| R19 | Sidebar sans clé : erreur brute au lieu du formulaire inline                                              | `use-ai-sidebar-chat.ts:305-310`                                    | pré-check `isAiConfigured()` → formulaire inline                         |
| R20 | Apply correction IA : ancrage par index regex (risque mauvaise cible), fallback silencieux `expected:200` | `request-tabs-manager.tsx:279-285`, `propose-correction.ts:222-228` | ancrage par id stable ; refuser suggestion incomplète ; CTA « Relancer » |
| R21 | Variables non résolues : diagnostic sans nom de variable ni warning inline                                | `notifyUnresolvedVariables` mappings only                           | lister placeholders+champ ; surligner ambre `{{…}}` en édition           |
| R22 | Aucun type « secret » sur les variables (tokens en clair, screenshots)                                    | `variables-panel.tsx:150-154`                                       | flag secret + œil (Eye/EyeOff déjà importés) + exclusion exports         |
| R23 | Partial-success incohérent entre canaux d'import (Postman compte, JSON drop silencieux)                   | `collections-panel.tsx:369-370` vs `page.tsx:130-148`               | résultat unique `{créées, ignorées[], causes}` partagé                   |
| R24 | Onglets non réordonnables                                                                                 | `request-tab-bar.tsx` sans DnD                                      | réutiliser dnd-kit horizontal                                            |
| R25 | Réponse : ni recherche, ni copie granulaire header/valeur                                                 | `response-content-renderer.tsx:92-126`                              | filtre in-response + copie au clic par ligne/nœud                        |
| R26 | Exécution mono-vol globale : onglet B affiche « Envoi… » à tort, cancel touche la mauvaise requête        | `abortRef` unique (`use-request-execution-core.ts:23,173`)          | Map tabId→AbortController, isLoading par tab                             |
| R27 | Erreurs import sans ligne/cause ; pas de collage YAML (asymétrie cURL)                                    | `openapi-import-parser.ts:36,56`                                    | mapper diagnostics YAML ligne/colonne + onglet Coller                    |
| R28 | i18n : Runner mi-FR/mi-EN (~35 chaînes), SDKs 100 % FR, toasts store hardcodés FR, bruno-import FR brut   | audits antérieurs + `collections.ts:93`                             | extraction i18n systématique                                             |
| R29 | Graphiques dashboard hex fixes hors tokens (thèmes indiscernables)                                        | `dashboard/page.tsx:29-35`                                          | lire `--chart-N` computed style                                          |

## Findings — Sévérité 1 (cosmétiques)

Ctrl+S double-exécuté · modal raccourcis ignore les remappings · export OpenAPI annulé télécharge quand même (`catch {}` → blob) · suffixes duplication incohérents ((Copy)/(2)/i18n) · cibles tactiles size-5/6 · flash de langue FR au chargement EN · code mort `components/runner/*` divergent (RunConfigPanel avait datasetError !) · hint Ctrl+Drag=dupliquer invisible · logo/search viewport-mix corrigés récemment.

---

## Ce qui fonctionne déjà bien (à préserver)

1. **Abort visible bout-en-bout** : Cancel rouge → signal → fetch → « Requête annulée » distinct du timeout
2. **Scriptabilité exemplaire** : Copy as cURL/fetch, import cURL inverse, code snippets multi-langages, exports JSON/JUnit
3. **Validation avant envoi** : Send désactivé sans URL, blocage dur `{{non résolu}}` sur url/body/authToken, normalisation URL tolérante, sync params↔URL
4. **Feedback Doherty** : Send→spinner instantané, skeletons, flash+jauge réponse, timings pro DNS/connect/TTFB segmentés
5. **Interpolation live vert/rouge + copie `{{clé}}`** (reconnaissance>rappel modèle)
6. **Prévisualisation avant engagement** sur tous les imports (KPI, badges Nouveau/Existe, options)
7. **DnD collections solide** : activation 8 px, capteur clavier, overlay, zones réactives, Ctrl=dupliquer, persistant
8. **Confirmations destructives récentes** : libellés nommés, sort des enfants annoncé et tenu, dernier env protégé
9. **Sidebar IA très mature** : stop accessible, stall timeout 45 s, phases typées, usage tokens, historique persisté anti-perte, Plan conditionné à l'approbation
10. **Erreurs transport repliables** « Détails techniques » — progressive disclosure correct

---

## Priorisation (ratio impact/effort)

**Quick wins (< 1 h chacun)** : R1 (`allowInInputs` 1 ligne) · R4 (brancher fonction existante) · R2 (supprimer fallback) · R3 (étendre boucle de garde) · R8 libellé SSRF · R13 (rendre un state existant) · R5 (condition + dupliquer bouton)

**Chants moyens** : R6 recalcul summary · R7 persistance runs · R10 garde masse · R11 orientation post-import · R16-R20 ponts IA · R26 exécution par onglet

**Chants longs** : R24 tabs DnD · R25 recherche réponse · R28 extraction i18n globale · R22 type secret

**À tester avec de vrais utilisateurs** (la méthode signale la limite) : le libellé « Environnement » vs « Env » est-il compris ? Le concept de variables dynamiques (mappings) est-il découvert spontanément ? Ces questions nécessitent un retour réel, pas une intuition d'évaluateur.
