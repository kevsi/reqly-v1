
| Fonctionnalité                                                | Vous (Reqly) | Concurrents                                                | Importance            | Pourquoi ça compte                                                                   |
| ------------------------------------------------------------- | ------------ | ---------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------ |
| Scan du code source → routes/auth (11 frameworks, 4 langages) | ✅ Oui        | ❌ Aucun (import de spec seulement)                         | 🔴 Élevée             | Différenciateur structurel : personne d'autre ne part du code pour générer les tests |
| CLI + TUI + serveur MCP dans le même outil                    | ✅ Oui        | ❌ Aucun (Postman a Newman, un CLI seul)                    | 🔴 Élevée             | Positionne Reqly pour l'ère des agents IA, aucun concurrent n'a ce combo             |
| Agent IA BYOK à actions approuvées + mode plan                | ✅ Oui        | ❌ Aucun (IA cloud facturée en crédits chez Postman/Apidog) | 🟠 Moyenne-élevée     | Coût zéro pour vous, contrôle total pour l'utilisateur — rare sur le marché          |
| Sync équipe self-hébergeable (RBAC + activity log)            | ✅ Oui        | 🟡 Hoppscotch seul (self-host)                             | 🟠 Moyenne-élevée     | Argument fort pour équipes soucieuses de la donnée                                   |
| Capture trafic desktop → collection testable auto             | ✅ Oui        | 🟡 Postman (Interceptor, moins profond)                    | 🟠 Moyenne            | Automatise une tâche manuelle chez tous les autres                                   |
| Analyse de réponse IA 100% locale, sans LLM                   | ✅ Oui        | ❌ Aucun                                                    | 🟡 Moyenne            | Argument marketing : IA sans facture surprise ni dépendance cloud                    |
| Guard SSRF + sandbox scripts + cookies chiffrés               | ✅ Oui        | 🟡 Partiel chez Postman                                    | 🟡 Moyenne            | Sécurité intégrée par défaut, pas une option payante                                 |
| Inférence OpenAPI depuis les réponses observées               | ✅ Oui        | 🟡 Partiel/bêta chez Postman                               | 🟢 Faible-moyenne     | Gain de temps ponctuel, pas un critère d'achat principal                             |
| NL → requête en mode simple                                   | ✅ Oui        | 🟡 Partiel cloud chez Apidog                               | 🟢 Faible             | Confort, pas un différenciateur décisif                                              |
| **Mock server**                                               | ❌ Non        | ✅ Postman, Insomnia, Apidog, Hoppscotch                    | 🔴 Élevée             | Argument d'acquisition n°1 du marché — son absence peut faire fuir des prospects     |
| **Documentation API publiable/hébergée**                      | ❌ Non        | ✅ Postman, Apidog, Hoppscotch                              | 🔴 Élevée             | Levier de viralité/SEO majeur, tous vos concurrents directs l'ont                    |
| **Monitors (exécutions planifiées + alertes)**                | ❌ Non        | ✅ Postman, Apidog                                          | 🔴 Élevée             | C'est LE moteur d'abonnement chez les leaders — valeur continue à monétiser          |
| Partage public / run-in-browser d'une collection              | ❌ Non        | ✅ Postman, Hoppscotch                                      | 🟠 Moyenne            | Levier de croissance virale, pas juste une fonctionnalité produit                    |
| Client WebSocket standalone                                   | ❌ Non        | ✅ Postman, Insomnia                                        | 🟡 Moyenne            | Manque un protocole, mais peu différenciant à combler en priorité                    |
| Client gRPC                                                   | ❌ Non        | ✅ Postman, Insomnia                                        | 🟡 Moyenne            | Idem — coûteux à développer, gain de conversion limité                               |
| Design-first / contrat d'API                                  | ❌ Non        | ✅ Apidog (cœur), Postman                                   | 🟡 Moyenne            | Cible un segment équipes API spécifique, pas votre positionnement actuel             |
| SSO SAML/OIDC, SCIM, audit logs                               | ❌ Non        | ✅ Postman, Insomnia, Apidog (Ent.)                         | 🟢 Faible aujourd'hui | Indispensable seulement pour vendre à de grands comptes (Enterprise)                 |
| Extension VS Code / marketplace                               | ❌ Non        | ✅ Thunder Client, Postman                                  | 🟢 Faible-moyenne     | Canal de distribution additionnel, pas critique au lancement                         |
| Flows no-code visuels (branches/boucles)                      | ❌ Non        | ✅ Postman Flows                                            | 🟢 Faible             | Vos Chains couvrent déjà 80% du besoin en linéaire                                   |

## Fonctionnalités a implémenter  sérieusement

| **Mock server**                                | ❌ Non | ✅ Postman, Insomnia, Apidog, Hoppscotch | 🔴 Élevée | Argument d'acquisition n°1 du marché — son absence peut faire fuir des prospects |
| ---------------------------------------------- | ----- | --------------------------------------- | --------- | -------------------------------------------------------------------------------- |
| **Documentation API publiable/hébergée**       | ❌ Non | ✅ Postman, Apidog, Hoppscotch           | 🔴 Élevée | Levier de viralité/SEO majeur, tous vos concurrents directs l'ont                |
| **Monitors (exécutions planifiées + alertes)** | ❌ Non | ✅ Postman, Apidog                       | 🔴 Élevée | C'est LE moteur d'abonnement chez les leaders — valeur continue à monétiser      |
## Fonctionnalités a implémenter  apres

| Partage public / run-in-browser d'une collection | ❌ Non | ✅ Postman, Hoppscotch    | 🟠 Moyenne | Levier de croissance virale, pas juste une fonctionnalité produit        |
| ------------------------------------------------ | ----- | ------------------------ | ---------- | ------------------------------------------------------------------------ |
| Client WebSocket standalone                      | ❌ Non | ✅ Postman, Insomnia      | 🟡 Moyenne | Manque un protocole, mais peu différenciant à combler en priorité        |
| Client gRPC                                      | ❌ Non | ✅ Postman, Insomnia      | 🟡 Moyenne | Idem — coûteux à développer, gain de conversion limité                   |
| Design-first / contrat d'API                     | ❌ Non | ✅ Apidog (cœur), Postman | 🟡 Moyenne | Cible un segment équipes API spécifique, pas votre positionnement actuel |
