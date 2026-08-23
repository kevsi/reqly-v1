# 🔍 Audit UX — reqy-web

> Audit basé sur la méthodologie du skill `ux-responsive` (preuves code/configuration, citations fichier:ligne, sévérité Bloquant/Majeur/Mineur/Cosmétique).
> Date : 2026-08-17

## 1. Résumé

L'application **reqy-web** (client API testing) est globalement **solide sur le plan responsive et accessibilité structurelle** : sidebar off-canvas sur mobile, onglets avec sémantique ARIA complète, stacking vertical requête/réponse, états de chargement et états vides bien gérés.

Les principaux problèmes se concentrent sur **3 axes** :

1. **Contraste** — le bouton primaire (vert clair + texte blanc) échoue WCAG AA, ainsi que les badges de méthode HTTP et les textes secondaires en `muted-foreground/60`.
2. **Formulaires sensibles** — le champ API key du modal IA et le mot de passe Basic Auth n'utilisent pas les bons attributs `autoComplete`/`spellCheck`.
3. **i18n** — le bouton « Send » affiche des chaînes anglaises en dur malgré la parité 1638/1638.

**Aucun problème bloquant (Bloquant) détecté.** 1 problème Majeur, 5 Mineurs, 1 Cosmétique.

---

## 2. Constats par sévérité

### 🔴 [Majeur] Contraste insuffisant sur les boutons primaires

- **Catégorie** : 4 — Contraste
- **Preuve** : configuration (calcul WCAG)
- **Fichier:ligne** : `reqy-web/app/globals.css:25-26` + `reqy-web/components/ui/button.tsx:20`
- **Extrait** :
  ```css
  --primary: oklch(0.696 0.17 162.48); /* vert clair ≈ #00BC7D */
  --primary-foreground: oklch(1 0 0); /* blanc */
  ```
  ```tsx
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  ```
- **Impact** : texte blanc sur vert clair ≈ **2.5:1** (seuil AA = 4.5:1 texte normal, 3:1 grand texte). Tous les boutons primaires (Send, Save, Test, etc.) ont un libellé difficile à lire, surtout en lumière ambiante. Le thème shadcn « green » utilise normalement un `--primary-foreground` sombre (`oklch(0.393 0.095 152.535)`) — ici il a été remplacé par du blanc.
- **Correctif** : passer `--primary-foreground` à un vert sombre (ex. `oklch(0.393 0.095 152.535)`) ou assombrir `--primary` (ex. `oklch(0.55 0.15 162)`).
- **Vérification** : recalculer le ratio avec un outil (axe DevTools / WebAIM) sur le bouton « Send ».

### 🟡 [Mineur] Contraste des badges de méthode HTTP (GET/PUT surtout)

- **Catégorie** : 4 — Contraste
- **Preuve** : configuration (calcul WCAG)
- **Fichier:ligne** : `reqy-web/lib/http-method-colors.ts:23-31` ; usage dans `reqy-web/components/request-panel-url-bar.tsx:337` (bouton Send `methodBg[method]` + `text-white`) et badges `text-[10px]`
- **Extrait** :
  ```ts
  GET: "bg-emerald-500 text-white ...",   // ≈ 2.4:1
  PUT: "bg-amber-500 text-white ...",     // ≈ 2.1:1
  ```
- **Impact** : texte blanc sur emerald-500/amber-500 ≈ **2.1–2.4:1**, sur des libellés très petits (`text-[10px]`). Le bouton Send hérite de la couleur de méthode → même problème que le point précédent.
- **Correctif** : pour les badges, utiliser `methodSubtle` (fond teinté + texte 600) ou des teintes 600/700 ; pour le bouton Send, garder un fond unique à contraste suffisant.
- **Vérification** : axe sur la page runner avec une requête GET et PUT.

### 🟡 [Mineur] Champ API key du modal IA : pas d'`autoComplete`, pas de toggle, pas de `htmlFor`

- **Catégorie** : 3 — Formulaires
- **Preuve** : code
- **Fichier:ligne** : `reqy-web/components/settings/ai-provider-modal.tsx:232-237`
- **Extrait** :
  ```tsx
  <label className="mb-1.5 block text-sm font-medium text-foreground">…</label>
  <Input type="password" value={apiKey} onChange={…} placeholder={…} disabled={…} />
  ```
- **Impact** : (1) le navigateur peut proposer d'enregistrer la clé API comme mot de passe ; (2) pas de bouton afficher/masquer pour vérifier la clé saisie ; (3) le `<label>` n'est pas associé au champ (`htmlFor`/`id` manquants) → lecteur d'écran moins fiable.
- **Contraste avec le bon pattern** : `reqy-web/components/settings/sections/tool-association-modal.tsx:104-116` fait exactement ce qu'il faut (`FieldLabel htmlFor="api-key"`, `autoComplete="off"`, `spellCheck={false}`).
- **Correctif** : aligner sur `tool-association-modal.tsx` + ajouter un toggle œil.
- **Vérification** : ouvrir le modal IA, vérifier qu'aucune suggestion de mot de passe n'apparaît.

### 🟡 [Mineur] `autoComplete="current-password"` sur le champ Basic Auth

- **Catégorie** : 3 — Formulaires / sécurité
- **Preuve** : code
- **Fichier:ligne** : `reqy-web/components/auth-section.tsx:205` (vs `:172` pour le username)
- **Extrait** :
  ```tsx
  <Input type="password" … autoComplete="current-password" />
  ```
  alors que le champ username juste au-dessus utilise `autoComplete="off"`.
- **Impact** : le gestionnaire de mots de passe du navigateur peut **autofill le vrai mot de passe de l'utilisateur** dans un champ de requête API, ou proposer d'enregistrer les credentials de l'API. Risque de fuite de credentials et confusion.
- **Correctif** : `autoComplete="off"` (ou `"new-password"`).
- **Vérification** : avec un gestionnaire de mots de passe actif, vérifier qu'aucune suggestion n'apparaît sur le champ Basic Auth.

### 🟡 [Mineur] Chaînes « Send » / « Sending... » non traduites

- **Catégorie** : 5 — Feedback / i18n
- **Preuve** : code
- **Fichier:ligne** : `reqy-web/components/request-panel-url-bar.tsx:355`
- **Extrait** :
  ```tsx
  title={!hasUrl ? t("request.urlRequired") : t("request.send")}
  …
  <span>{isLoading ? "Sending..." : "Send"}</span>
  ```
- **Impact** : le `title` est traduit mais le libellé visible est en dur en anglais → incohérence en interface FR, malgré la parité i18n 1638/1638.
- **Correctif** : utiliser `t("request.send")` et ajouter une clé `request.sending`.
- **Vérification** : basculer en FR, vérifier le libellé du bouton.

### 🟡 [Mineur] Bouton de fermeture d'onglet invisible sur mobile

- **Catégorie** : 2 — Cibles tactiles / découvrabilité
- **Preuve** : code
- **Fichier:ligne** : `reqy-web/components/request-tab-bar.tsx:186-190`
- **Extrait** :
  ```tsx
  activeTabId === tab.id ? "opacity-30" : "opacity-0",
  ```
- **Impact** : sur mobile (pas de hover), le bouton X des onglets inactifs est à `opacity-0` → invisible. L'utilisateur doit d'abord taper l'onglet pour le rendre actif, puis chercher le petit X (opacity-30). Friction réelle sur la gestion multi-onglets.
- **Correctif** : `md:opacity-0 md:group-hover:opacity-100` pour ne masquer que sur desktop.
- **Vérification** : viewport mobile, vérifier que le X est visible sur tous les onglets.

### ⚪ [Cosmétique] Cible tactile du bouton de fermeture d'onglet trop petite

- **Catégorie** : 2 — Cibles tactiles
- **Preuve** : code
- **Fichier:ligne** : `reqy-web/components/request-tab-bar.tsx:186-190`
- **Extrait** : icône `size-3` + `p-0.5` ≈ **16px** de zone cliquable (recommandation : 44px).
- **Correctif** : agrandir le padding (`p-2`) tout en gardant l'icône petite, avec `-m-2` pour ne pas casser la mise en page.
- **Vérification** : mesure de la zone cliquable au runtime.

---

## 3. Priorisation

| #   | Action                                              | Sévérité   | Effort                | Impact                     |
| --- | --------------------------------------------------- | ---------- | --------------------- | -------------------------- |
| 1   | Corriger `--primary-foreground` (contraste boutons) | Majeur     | Trivial (1 ligne CSS) | Élevé — tous les CTA       |
| 2   | `autoComplete="off"` sur Basic Auth + API key modal | Mineur     | Trivial               | Élevé — sécurité/confusion |
| 3   | Traduire « Send »/« Sending... »                    | Mineur     | Trivial               | Moyen — cohérence FR       |
| 4   | Rendre le X des onglets visible sur mobile          | Mineur     | Faible                | Moyen — gestion onglets    |
| 5   | Badges méthode : contraste (teintes 600/700)        | Mineur     | Faible                | Moyen                      |
| 6   | Toggle œil + `htmlFor` sur API key modal            | Mineur     | Faible                | Faible                     |
| 7   | Agrandir la cible tactile du X                      | Cosmétique | Trivial               | Faible                     |

---

## 4. Ce qui est déjà solide ✅

- **Sidebar responsive** : off-canvas drawer sur mobile avec `aria-hidden`, `aria-label`, fermeture au clic sur un lien (`api-sidebar.tsx:59-81`).
- **Onglets accessibles** : `role="tablist"`/`role="tab"`, `aria-selected`, `aria-controls`, navigation clavier Entrée/Espace (`request-tab-bar.tsx:118-150`).
- **Mode mobile** : stacking vertical requête/réponse via `useIsMobile(768)` (`request-tabs-manager.tsx:66`).
- **Tableau dashboard** : `overflow-x-auto` + `min-w-[500px]` → scroll horizontal **contenu**, pas de débordement de page (`dashboard/page.tsx:434-436`).
- **Feedback** : bouton Send avec spinner `Loader2 animate-spin` + `disabled` (`request-panel-url-bar.tsx:337-355`) ; état vide du panneau réponse avec CTA (`response-panel.tsx:499-509`).
- **Login** : `autoComplete="email"` / `"current-password"` corrects (`login/page.tsx:66-88`).
- **Focus visible** : `:focus-visible` avec ring (`globals.css`).
- **Sélecteur d'environnement** : `aria-label` sur le trigger (`environment-selector.tsx:83`).

---

## 5. Vérifications restantes (runtime)

- **Contraste réel** des `text-muted-foreground/60` sur fond blanc (estimé ≈ 2.3:1) — utilisé pour les onglets inactifs (`request-tab-bar.tsx:139`) et la description d'état vide (`response-panel.tsx:503`). À confirmer avec axe/Lighthouse.
- **Comportement du drawer** à la rupture exacte de 768px.
- **Test multi-viewports** (360, 768, 1024, 1440) sur les pages runner, dashboard, settings.
- **Gestionnaire de mots de passe** actif pour confirmer le comportement des champs `current-password`.

---

## 6. Suivi des correctifs

| #   | Correctif                                                 | Fichier                                          | Statut |
| --- | --------------------------------------------------------- | ------------------------------------------------ | ------ |
| 1   | Contraste bouton primaire (`--primary-foreground` sombre) | `app/globals.css`                                | ✅     |
| 2   | `autoComplete="off"` Basic Auth                           | `components/auth-section.tsx`                    | ✅     |
| 3   | Traduire Send/Sending                                     | `components/request-panel-url-bar.tsx` + locales | ✅     |
| 4   | X onglets visible sur mobile                              | `components/request-tab-bar.tsx`                 | ✅     |
| 5   | Contraste badges méthode (600/700)                        | `lib/http-method-colors.ts`                      | ✅     |
| 6   | Toggle œil + `htmlFor` API key                            | `components/settings/ai-provider-modal.tsx`      | ✅     |
| 7   | Cible tactile du X agrandie                               | `components/request-tab-bar.tsx`                 | ✅     |

> ✅ **Tous les correctifs appliqués et validés** — `pnpm typecheck` (exit 0) et `pnpm eslint` (aucune erreur) passent.
