# Backlog sécurité — audit auth 2026-08 (non traité volontairement)

Issues identifiées lors de l'audit du flow d'authentification et explicitement
reportées. Ne pas considérer comme terminé tant que ces points ne sont pas
soit corrigés, soit formellement assumés.

## Moyens
- **M1** — Énumération d'emails par timing sur `/login` : pour un email inconnu,
  `verifyPassword` (scrypt ~100 ms) est skippé → réponse plus rapide.
  Fix : comparer contre un hash factice (`sync-server/src/routes/auth.ts`, handler login).
- **M2** — Le lockout (429 « Trop de tentatives ») révèle l'existence du compte.
  Trade-off UX assumé — réévaluer si énumération constatée en prod.
- **M3** — Énumération via signup/resend-code/verify (409/404 explicites). Assumé.
- **M5** — Compteurs anti-brute-force en mémoire (`codeAttempts`, `resetAttempts`,
  `resendCooldowns`) perdus au redémarrage du serveur. Acceptable en
  single-instance ; à revoir si passage multi-instances (Redis).

## Faibles
- **L1** — scrypt aux paramètres par défaut (N=16384) sans versioning des coûts
  par utilisateur. Documenter ; prévoir upgrade paramétrique si besoin.
- **L2** — Pas de purge des lignes `password_resets` anciennes (hygiène/RGPD).
- **L3** — Pas de 2FA / TOTP ni de liste de mots de passe communs.
- **L4** — Cookie `github_token` (tool integration) valable 30 jours sans rotation
  (`reqy-web/app/api/github-auth/callback/route.ts`).

## Actions ops associées
- **M6** — Rotation du client secret GitHub (5 secrets actifs dont certains
  exposés) : générer un nouveau secret dans GitHub → mettre à jour
  `GITHUB_OAUTH_CLIENT_SECRET` sur reqly-web ET sync-server (prod + local) →
  supprimer les anciens secrets. À faire manuellement côté GitHub.
