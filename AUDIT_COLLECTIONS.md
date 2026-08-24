# Audit — Page Collections (reqy-web)

**Date :** 2026-08-21
**Périmètre :** `components/collections-panel.tsx` (837 l.), `collection-row.tsx` (552 l.), `hooks/use-request-store.ts`, `hooks/store/{collections,folders,sync,persistence}.ts`, `app/(app)/collections/page.tsx` (617 l.), imports/exporteurs, sync WebSocket.

---

## Verdict global : 7/10 — fonctionnel mais 5 fonctionnalités mortes/cassées + 1 HIGH sécurité

---

## 1. SÉCURITÉ

| # | Sévérité | Finding | Statut |
|---|---|---|---|
| H1 | **HAUTE** | **Persistance disque non assainie** : `sanitizeStore` (persistence.ts:207-231) ne retire que `authorization`/`x-api-key` — pas `cookie`, `proxy-authorization`, tokens dans le body/queryParams, ni `history`/`currentRequest`/`lastResponse` (persistés verbatim). Le sanitiser **sync** (store-sync.ts) est plus strict → incohérence disque/réseau | ⚠️ À CORRIGER |
| M1 | MOYENNE | Imports (JSON/OpenAPI/Bruno) **sans limite de taille** ni profondeur `$ref` → DoS mémoire/CPU (fichier 500 Mo → OOM) | ⚠️ À CORRIGER |
| M2 | MOYENNE | Import Postman : le champ `requests` (non validé Zod) est privilégié sur `routes` ; `method` casté sans validation d'enum | ⚠️ À CORRIGER |
| M3 | MOYENNE | **Sync WS : token de session dans le header `Sec-WebSocket-Protocol`** (sync-ws.ts:50) — visible dans les logs proxys/load-balancers | ⚠️ À CORRIGER (ticket WS ou doc) |
| M4 | MOYENNE | Recherche sémantique : envoie **noms + URLs + corps** de toutes les requêtes à un service d'embeddings externe, déclenché au montage du panneau | ⚠️ Consentement/documentation |
| M5 | MOYENNE | Outil LLM `import_collection` : contenu fourni par l'IA parsé puis inséré **sans validation** (méthode, headers) | ⚠️ À CORRIGER |
| L1-L7 | BASSE | `Object.assign`/YAML `__proto__` localisés (aucune pollution globale), noms d'export avec caractères de traversal (sécurité par le dialog OS), `localStorage` try/catch | ✅ Acceptés |

**Vérifié non vulnérable :** pas de `dangerouslySetInnerHTML` sur les noms (tout est échappé React) ; `requestItemSchema` (Zod) filtre les clés inconnues (`__proto__`) à l'import JSON ; aucune pollution de prototype globale trouvée.

## 2. FONCTIONNALITÉ — 28 câblées / 5 cassées / 4 manquantes

### ✅ Câblées (28)
Créer/renommer/supprimer/dupliquer collection (avec confirmation) · dossiers (créer/renommer/supprimer) · drag de requête vers dossier · réordonner requêtes racine · déplacer requête entre collections · exporter JSON (simple + bulk) · importer JSON/Postman/OpenAPI/Bruno/GitLab · recherche texte + filtre méthode + tri · sélection multiple + suppression bulk · lancer une collection (runner) · charger/envoyer une requête.

### ❌ Cassées (5) — annoncées par props/API mais non fonctionnelles
| # | Fonctionnalité | Problème |
|---|---|---|
| 1 | **Réordonner les collections (DnD)** | Prop `onReorderCollections` jamais déstructurée dans le panneau |
| 2 | **Déplacer / imbriquer / réordonner les dossiers** | `onMoveFolder` → `_onMoveFolder` ignoré ; `onReorderFolders` jamais transmis ; `moveFolder`/`reorderFolders` jamais appelés |
| 3 | **Réordonner les requêtes DANS un dossier** | Le DnD envoie toujours `folderId=null` → no-op silencieux |
| 4 | **Déposer une requête d'une AUTRE collection sur un dossier** | `moveRequestToFolder` ne cherche que dans la collection cible → no-op silencieux |
| 5 | **Dossiers perdus à l'export/import** | `exportCollection` omet `folders` ; l'import ignore `folders` et `description` |

### ⚠️ Manquantes (4)
Édition couleur/icône/description · renommer une requête dans le panneau · export par requête · **confirmation avant suppression d'une requête** (incohérent avec collection/dossier).

## 3. EXPÉRIENCE UTILISATEUR

| Aspect | Verdict |
|---|---|
| État vide | ✅ `CollectionsEmptyState` joli + CTA « Créer une collection » |
| Loading | ⚠️ Le panneau ignore `isLoaded` du store → **flash de l'état vide** pendant l'hydratation |
| État d'erreur | ❌ **Aucune bannière d'erreur** dans le panneau ; échecs de sauvegarde (IndexedDB) et de sync **silencieux** (`console.warn` seulement) |
| Confirmations | ✅ Collection/dossier/bulk avec « Cette action est irréversible. » — ❌ requête sans confirmation |
| Toasts | ⚠️ Deux systèmes (custom + sonner) ; la plupart des mutations (créer/renommer/dupliquer) **n'affichent aucun toast** ; toasts de DnD en **français dur** affichés dans l'UI EN |
| Imports | ⚠️ Requêtes invalides **silencieusement ignorées** (« Collection importée » quand même) ; erreurs d'export avec suffixe technique anglais brut |
| Run collection vide | ❌ **Rien ne se passe** (aucun message) |

## 4. i18n

- ✅ UI live entièrement `t()`-wrapped (panel, row, toolbar, empty state, dialogs)
- ❌ **Couche store en dur** : `folders.ts` (« Requête déplacée », « Requêtes réorganisées »), `collections.ts` (« (Copy) »), `sync.ts` (« Sync Conflict — N change(s)… » + FR « Synchronisation indisponible » jamais traduit EN)
- 🧹 **`collections-folder-tree.tsx` (670 l.) + `collections-request-tree-item.tsx` : 100% anglais, ZÉRO importeur** (code mort)
- ✅ Correction d'exploration : la toolbar de sélection n'affiche **pas** de clé brute — i18next résout `t("key", {count})` vers `key_one/_other` (clés présentes). Faux positif.

## 5. QUALITÉ DU CODE

- **3 fichiers morts** : `collections-folder-tree.tsx` (670 l.), `collections-request-tree-item.tsx`, `hooks/use-request-dnd.ts` (191 l. — logique DnD **dupliquée** dans le panneau)
- 9× `as unknown as Parameters<typeof toast>[0]` inutiles
- 3 chemins d'import pour le même type (`@/hooks/request-types` / `use-request-store` / `@/lib/types`)
- Prop mortes : `onReorderCollections`, `_onMoveFolder`, `onReorderFolders` ; `const [_indexing, setIndexing]` jamais lu
- Re-indexation sémantique des **corps complets** à chaque changement de collections (perf)
- God components : panneau 837 l. (split : io / dnd / header) ; row 552 l.

## 6. MESSAGES D'ERREUR (exacts)

| Scénario | Message actuel | Verdict |
|---|---|---|
| JSON invalide | « Fichier JSON invalide » (FR/EN) | ✅ |
| Format inconnu | « Format non reconnu » | ✅ |
| Requêtes invalides dans un fichier valide | **Rien** (silencieux) | ❌ |
| Échec export Tauri | « Erreur export : \<erreur anglaise brute\> » | ⚠️ |
| Échec sauvegarde disque | **Rien** | ❌ |
| Échec push sync | **Rien** | ❌ |
| Conflit de sync | « Sync Conflict — N change(s) conflicted… » (EN cryptique) | ⚠️ |
| Workspace indisponible | « Synchronisation indisponible » (FR en mode EN) | ⚠️ |
| Run collection vide | **Rien** | ❌ |

---

## TOP 8 ACTIONS

1. **H1** — Aligner `sanitizeStore` sur le sanitiser sync (regex élargie) + assainir `history`/`currentRequest`/`lastResponse`/bodies
2. **M1** — Limiter la taille des fichiers d'import (10 Mo) + profondeur `$ref`
3. **M3** — Ne plus mettre le token en subprotocol WS (ticket à usage unique ou auth HTTP)
4. **Fonctionnel** — Corriger les 5 DnD cassés (folderId dans le reorder, garde cross-collection, export/import des dossiers)
5. **UX** — Confirmation de suppression de requête + toasts unifiés (`t()` + un seul système) + bannière d'erreur sync
6. **i18n** — Traduire la couche store (sonner FR → `t()`), supprimer les 3 fichiers morts
7. **M2/M5** — Valider `method`/headers par Zod dans l'import Postman et le tool LLM
8. **Perf** — Ne pas re-indexer les corps de requêtes à chaque changement

---

*Corrections d'exploration : le « raw key bug » de la toolbar est un faux positif (résolution plurielle i18next) ; la toolbar est fonctionnelle.*
