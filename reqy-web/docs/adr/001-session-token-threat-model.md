# ADR 001 — Modèle de menace des tokens de session

- **Statut :** accepté
- **Date :** 2026-08-14
- **Périmètre :** session web SSR/React et application desktop Tauri

## Contexte

Reqly manipule des tokens d’authentification qui donnent accès aux opérations de synchronisation et aux intégrations. Le navigateur web peut exécuter du contenu tiers ou compromis dans la même origine applicative, tandis que l’application Tauri dispose de primitives natives de stockage sécurisé. Une persistance automatique du bearer dans `localStorage` ou IndexedDB augmenterait l’impact d’une XSS et d’une extraction opportuniste du profil navigateur.

Le store de session conserve donc actuellement `user` et `token` en mémoire Zustand uniquement. Après un rechargement web, l’utilisateur doit s’authentifier à nouveau. Le stockage des clés d’intégration suit le même principe de prudence : `secure-storage` utilise le trousseau/IPC Tauri lorsqu’il est disponible et ne promet pas de persistance durable équivalente dans le navigateur.

## Décision

Le token de session **ne doit pas être écrit** dans `localStorage`, IndexedDB, un cookie lisible par JavaScript ou un fichier web. `lib/session-store.ts` reste la source de vérité de session côté client et efface `user` et `token` sur restauration web et déconnexion.

La version Tauri peut utiliser les commandes natives déjà existantes pour les secrets protégés. Les changements de ce ticket ne modifient pas le code Rust ni le protocole IPC. Toute extension future de persistance web devra fournir une analyse de menace dédiée, une rotation/révocation, une protection CSRF et une validation de sécurité avant d’être activée.

## Menaces couvertes

| Menace                          | Décision                                                             | Résultat attendu                                                            |
| ------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| XSS lisant un bearer persistant | Ne pas persister le token dans les APIs web accessibles au script    | Une XSS ne récupère pas un token de session déjà stocké par Reqly           |
| Extraction du profil navigateur | Aucun token dans IndexedDB/localStorage/sessionStorage               | Le profil web ne contient pas la session active après reload                |
| Vol d’un token déjà en mémoire  | Réduire sa durée de vie au cycle de page et effacer à la déconnexion | La fenêtre d’exposition est limitée, sans prétendre empêcher une XSS active |
| Perte de session au reload      | Documenter le compromis produit                                      | Le comportement est explicite et testé, pas accidentel                      |
| Stockage de secrets sur desktop | Déléguer au stockage natif existant                                  | Le chemin Tauri conserve ses garanties spécifiques sans les simuler sur web |

## Limites connues

Cette décision ne protège pas contre une XSS active qui exécute du code pendant que l’utilisateur est connecté, ni contre un système d’exploitation compromis. Elle ne remplace pas les contrôles serveur, la rotation des tokens, les cookies HttpOnly du backend ou les gates d’autorisation des outils IA.

Les pages web peuvent rester navigables sans session pour préserver le mode local/preview, mais chaque opération sensible doit continuer à appliquer sa propre autorisation côté serveur ou dans le chemin Tauri. Une future décision de rendre l’interface entièrement privée devra traiter séparément la garde de routes et la compatibilité desktop.

## Conséquences

L’expérience web demande une reconnexion après rechargement et les clés d’intégration web peuvent être perdues si le backend sécurisé Tauri n’est pas disponible. En contrepartie, Reqly ne transforme pas automatiquement le stockage persistant du navigateur en coffre de bearer tokens. Cette asymétrie est intentionnelle et doit rester visible dans l’interface et la documentation.
