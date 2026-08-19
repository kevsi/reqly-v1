# Gates d’autorisation de l’agent IA Reqly

Ce document décrit le chemin réel d’autorisation des actions IA. Il couvre deux circuits distincts : le circuit **agent/tool calling** de la sidebar et le circuit **actions JSON legacy** du cloud-engine. Les deux circuits ne partagent pas exactement les mêmes gates.

## 1. Circuit agent/tool calling

### Ordre d’évaluation réel

Pour un tool call reçu par la sidebar, l’ordre est le suivant :

1. **Mode `plan` ou mode `act`** : dans `reqy-web/src/ai/hooks/use-ai-sidebar-chat.ts:589-610`, le mode `plan` capture les tool calls dans `pendingPlan` et retourne sans les exécuter. En mode `act`, la boucle appelle `executeTools`.
2. **Approbation du plan** : `use-ai-sidebar-chat.ts:912-930` passe temporairement le mode en `act`, puis relance le message avec les appels du plan. L’approbation du plan ne contourne donc pas `gatedExecute`; elle permet d’entrer dans le circuit d’exécution.
3. **Calcul de la confirmation effective** : `use-ai-sidebar-chat.ts:640-645` appelle `gatedExecute(tc, preApproved || autoApply)`. Un plan approuvé (`preApproved`) ou le toggle `autoApply` fournit alors `confirmed = true`.
4. **Permission persistée de l’outil** : `use-ai-sidebar-chat.ts:131-158` appelle `getPermission(tc.name)`.
   - `deny` retourne immédiatement une erreur et n’exécute pas l’outil (`:136-143`).
   - `ask` avec `confirmed === false` retourne `requireConfirmation: true` (`:145-152`).
   - Sinon, `executeToolCall` est appelé (`:154-157`).
5. **Exécution du handler** : `reqy-web/lib/llm-tools.ts` contient le catalogue `REQLY_TOOLS`, les paramètres et les handlers. `executeToolCall` est atteint après le gate de permission de la sidebar.

### Permissions par défaut

`reqy-web/src/ai/agent/permissions.ts:5-45` classe les outils à effets de bord et les outils read-only. `defaultPermission` (`:49-51`) donne `ask` aux side effects et `allow` aux outils read-only. Les permissions persistées sont lues par `loadPermissions` (`:53-60`), modifiées par `savePermission` (`:62-66`) et résolues par `getPermission` (`:68-70`).

Les outils à effets de bord incluent notamment `create_collection`, `create_request`, `execute_request`, `delete_collection`, `delete_request`, `run_collection`, `import_collection`, les changements de workspace et `clear_workspace_cache`. Les outils read-only incluent notamment `list_collections`, `get_request_context`, `search_requests`, `explain_response`, `export_collection` et les opérations de lecture de workspace.

### Cas de l’exécution d’une requête/cURL

`ai-code-execution-card.tsx:1-67` n’exécute rien directement. Il affiche la méthode, l’URL, le nombre de headers et la présence d’un body, puis fournit uniquement les callbacks `onConfirm` et `onCancel`.

Après confirmation, `use-ai-sidebar-chat.ts:162-225` construit un tool call `execute_request` avec `confirmed = true` (`:193-200`) et le soumet à `gatedExecute`. Il ne s’agit donc pas d’un chemin séparé qui contournerait le gate.

### Mode `autoApply`

Le toggle d’auto-application n’ignore pas `deny` : `gatedExecute` évalue toujours `getPermission` avant l’exécution. Il sert à fournir `confirmed = true` à l’outil (`use-ai-sidebar-chat.ts:640-645`). Une permission `ask` peut ainsi être exécutée sans nouvelle boîte de confirmation lorsque l’auto-application est activée; une permission `deny` reste bloquée.

## 2. Circuit actions JSON legacy

Le hook `reqy-web/src/ai/hooks/use-ai-engine.ts:204-225` appelle `dispatchAIActions` avec `allowAutoApply: Boolean(store.aiAutoApply)`.

`reqy-web/src/ai/cloud-engine/actions/dispatch.ts` ne consulte pas `getPermission`. Dans ce circuit, le gate est uniquement `options.allowAutoApply` et, pour certaines actions, le champ `action.payload.autoApply` ou `action.payload.reason`.

| Action                            | Gate réel                                                                                    | Comportement                                                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `FILL_REQUEST` avec `payload.run` | `payload.run && options.allowAutoApply` (`dispatch.ts:20-43`)                                | Remplit toujours la requête; exécute uniquement si les deux conditions sont vraies.                                       |
| `ADD_ASSERTIONS`                  | `payload.autoApply && options.allowAutoApply` (`dispatch.ts:45-64`)                          | Ajoute les assertions; transmet le booléen d’auto-application au handler.                                                 |
| `CREATE_VARIABLE`                 | Aucun gate d’autorisation explicite (`dispatch.ts:66-84`)                                    | Crée la variable ou la dérive d’un chemin de réponse.                                                                     |
| `SUGGEST_FIX`                     | `payload.autoApply && options.allowAutoApply` pour appliquer le patch (`dispatch.ts:86-108`) | Notifie toujours; applique le patch uniquement si les deux conditions sont vraies.                                        |
| `GENERATE_DOC`                    | Aucun gate d’autorisation explicite (`dispatch.ts:110-118`)                                  | Envoie le Markdown au handler documentaire.                                                                               |
| `EXPLAIN`                         | Aucun gate d’autorisation explicite (`dispatch.ts:120-128`)                                  | Envoie l’explication au handler de notification.                                                                          |
| `EXECUTE_REQUEST`                 | `payload.reason && !options.allowAutoApply` bloque (`dispatch.ts:130-158`)                   | Sans `allowAutoApply`, l’exécution est bloquée et enregistrée dans `blocked`; sinon la requête est remplie puis exécutée. |
| `RUN_BATCH`                       | `!options.allowAutoApply` bloque (`dispatch.ts:160-188`)                                     | Un batch n’est lancé que si l’auto-application est autorisée.                                                             |

Ce circuit est distinct du circuit agent : `permissions.ts` ne s’applique pas aux actions JSON legacy. La protection de ce circuit repose sur `allowAutoApply` transmis par `useAIEngine`.

## 3. Priorité entre les gates

Pour la sidebar, la priorité effective est :

> **Mode plan → approbation du plan → permission `deny` → permission `ask`/confirmation → exécution du handler.**

Le toggle `autoApply` et l’approbation d’un plan ne passent jamais devant `deny`; ils influencent seulement la valeur `confirmed` transmise à `gatedExecute`.

Pour les actions JSON legacy, la priorité est différente :

> **Présence du champ d’action → `allowAutoApply` global → éventuel `payload.autoApply` ou `payload.reason` → handler.**

Les actions de lecture/notification/documentation et `CREATE_VARIABLE` n’ont pas de consultation du registre de permissions dans `dispatch.ts`.

## 4. Outils appelables et effets

Le catalogue et les handlers sont définis dans `reqy-web/lib/llm-tools.ts`. Un outil peut produire un résultat, une erreur, un usage ou demander confirmation. Les arguments affichés dans la timeline sont masqués par `maskSensitiveObject` dans `use-ai-sidebar-chat.ts:623-637`, mais le masquage d’affichage ne remplace pas le gate d’autorisation.

Toute modification du catalogue, de la classification side effect/read-only, du mode plan/action, de `gatedExecute`, de `allowAutoApply` ou du dispatch legacy doit être accompagnée d’une mise à jour de ce document et des tests correspondants.
