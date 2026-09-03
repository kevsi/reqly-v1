# Guide — Déploiement sync-server : SSH → SSM et fermeture du port 22

> **Date :** 2026-09-03 · **Instance :** `i-08a9f24c0003d6c24` (eu-north-1, IP `51.21.110.147`, DNS `reqly.duckdns.org`)
> **Contexte :** le déploiement est automatisé via GitHub Actions (`deploy-sync-server.yml`). Aujourd'hui, le runner GitHub se connecte en **SSH (port 22 ouvert à 0.0.0.0/0)**. Ce guide fait basculer le déploiement vers **AWS Systems Manager (SSM)** — qui n'a besoin d'**aucun port entrant** — puis ferme le port 22.

## État actuel (vérifié le 2026-09-03)

| Élément | État |
| --- | --- |
| Workflow GitHub Actions `deploy-sync-server.yml` | ✅ actif — auto sur push `main` (paths `sync-server/**`) + manuel |
| Agent SSM sur l'instance (snap `amazon-ssm-agent 3.3.4793.0`) | ✅ installé et actif |
| Enregistrement SSM | ❌ **échoue** — `no EC2 instance role found` (l'instance n'a pas de rôle IAM) |
| Port 22 | ⚠️ ouvert à `0.0.0.0/0` (security group), UFW `LIMIT`, 1 seule clé (`reqly-new.pem`), password auth off |
| Workflow SSM prêt | ✅ `deploy-sync-server-ssm.yml` écrit (non commité, attend la config) |

## Pourquoi SSM ?

- **Zéro port entrant** : l'agent SSM maintient une connexion *sortante* (443) vers AWS. On peut supprimer la règle SSH du security group, et même bloquer le 22 dans UFW.
- **Pas de clé privée à gérer** : l'authentification passe par IAM, pas par `authorized_keys`.
- **Session navigateur possible** : onglet « Session Manager » de la console EC2 = terminal dans le navigateur, sans SSH ni IP exposée.

---

## Étape 1 — Créer le rôle IAM de l'instance (2 min)

L'agent SSM a besoin d'un rôle avec la politique gérée `AmazonSSMManagedInstanceCore`.

1. Console AWS (région **eu-north-1**) → **IAM → Rôles → Créer un rôle**.
2. Type d'entité de confiance : **Service AWS** ; cas d'usage : **EC2**.
3. Chercher et cocher la politique **`AmazonSSMManagedInstanceCore`**.
4. Nom du rôle : **`reqly-ssm-role`** → Créer le rôle.

## Étape 2 — Attacher le rôle à l'instance (1 min)

1. **EC2 → Instances** → sélectionner `i-08a9f24c0003d6c24`.
2. **Actions → Sécurité → Modifier le rôle IAM** → choisir `reqly-ssm-role` → **Mettre à jour le rôle IAM**.
3. Patienter 1-2 minutes : l'agent réessaie l'enregistrement automatiquement (pas besoin de reboot).

**Validation :** dans la console, **EC2 → Instances → sélectionner l'instance → bouton « Se connecter » → onglet « Session Manager »**. Le bouton **« Connecter »** doit devenir actif — cliquer ouvre un terminal navigateur. S'il reste grisé après 5 minutes, vérifier l'horloge de l'instance (`timedatectl` via Session Manager/SSH) : un décalage horloge casse l'enregistrement SSM.

## Étape 3 — Créer le rôle OIDC GitHub pour le workflow (5 min)

Le workflow utilisera `aws-actions/configure-aws-credentials` en OIDC (pas de clé d'accès stockée — recommandé).

### 3a. Déclarer GitHub comme fournisseur d'identité

1. **IAM → Identity providers (Fournisseurs d'identité) → Ajouter un fournisseur**.
2. Type : **OpenID Connect**.
3. URL du fournisseur : `https://token.actions.githubusercontent.com` (laisser l'empreinte proposée).
4. Audience : `sts.amazonaws.com`.
5. Ajouter le fournisseur.

### 3b. Créer la politique de déploiement (moindre privilège)

**IAM → Politiques → Créer → JSON**, coller :

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SSMDeploy",
      "Effect": "Allow",
      "Action": ["ssm:SendCommand", "ssm:ListCommands", "ssm:ListCommandInvocations"],
      "Resource": [
        "arn:aws:ec2:eu-north-1:183295415504:instance/i-08a9f24c0003d6c24",
        "arn:aws:ssm:eu-north-1:183295415504:document/AWS-RunShellScript"
      ]
    }
  ]
}
```

Nom : **`reqly-gh-deploy-ssm`**.

### 3c. Créer le rôle

1. **IAM → Rôles → Créer** → entité de confiance : **Fournisseur d'identité** → `token.actions.githubusercontent.com`, Audience `sts.amazonaws.com`.
2. Attacher la politique `reqly-gh-deploy-ssm`.
3. Nom : **`reqly-gh-deploy`** → créer.
4. Ouvrir le rôle → **Relations de confiance → Modifier** → remplacer par :

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::183295415504:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:kevsi/reqly-v1:*"
        }
      }
    }
  ]
}
```

> La condition `sub` verrouille l'accès au seul dépôt `kevsi/reqly-v1`. Noter l'**ARN du rôle** : `arn:aws:iam::183295415504:role/reqly-gh-deploy`.

## Étape 4 — Configurer les secrets GitHub (1 min)

Molette du dépôt → **Settings → Secrets and variables → Actions → New repository secret** :

| Nom du secret | Valeur |
| --- | --- |
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::183295415504:role/reqly-gh-deploy` |
| `EC2_INSTANCE_ID` | `i-08a9f24c0003d6c24` |

(`gh secret set AWS_DEPLOY_ROLE_ARN --repo kevsi/reqly-v1` et `gh secret set EC2_INSTANCE_ID --repo kevsi/reqly-v1` en CLI.)

## Étape 5 — Basculer le workflow (fait par le dev, 1 commande)

Une fois les étapes 1-4 validées :

1. Remplacer `deploy-sync-server.yml` par `deploy-sync-server-ssm.yml` (le fichier est prêt, non commité).
2. Commit + push → le workflow s'auto-déclenche (le path du workflow matche le trigger).
3. Vérifier le run : log `--- health check ---` doit montrer `{"status":"ok","db":true}` et `active`.

## Étape 6 — Fermer le port 22 (2 min, seulement après validation SSM)

### 6a. Security group

**EC2 → Groupes de sécurité → celui de l'instance → Règles entrantes** → **supprimer la règle `SSH / TCP / 22 / 0.0.0.0/0`** → Enregistrer.

### 6b. UFW (serveur) — optionnel mais recommandé

Via Session Manager (navigateur) ou avant de fermer le 22 :

```bash
sudo ufw delete limit OpenSSH   # retire la règle LIMIT
# ou, pour garder un SSH admin de secours restreint à ton IP :
# sudo ufw allow from <TA_IP_PERSO> to any port 22 proto tcp
```

> **Garde-fou** : garder une porte de secours est prudent. Options : (a) restreindre le 22 à ton IP personnelle dans le security group, ou (b) ne rien garder et passer entièrement par Session Manager (la console AWS reste disponible même si UFW/SG ferment tout).

### 6c. Nettoyage local

- Les fichiers `reqly.pem` (racine) et `sync-server/reqly.pem` locaux peuvent être **supprimés** : l'ancienne clé est révoquée côté serveur et AWS. Conserver `reqly-new.pem` (dans `Documents/clé/`) tant que le 22 existe ; après la fermeture SSM complète, sa seule utilité devient nulle — la conserver en coffre n'est pas interdit.

## Vérification finale (checklist)

- [ ] Étape 1-2 : onglet « Session Manager » → Connecter ouvre un terminal.
- [ ] Étape 3-4 : secrets `AWS_DEPLOY_ROLE_ARN` et `EC2_INSTANCE_ID` créés.
- [ ] Étape 5 : workflow SSM commité, run auto vert, `{"status":"ok","db":true}` dans les logs.
- [ ] Étape 6a : règle SSH supprimée du security group → `Test-NetConnection 51.21.110.147 -Port 22` → `TcpTestSucceeded : False`.
- [ ] `https://reqly.duckdns.org/health` → `{"status":"ok","db":true}` (le service n'a jamais dépendu du 22).
- [ ] Un dernier `git push` factice touchant `sync-server/` → déploiement SSM vert.

## Retour arrière (si SSM casse)

1. **EC2 → Groupes de sécurité → Règles entrantes** → ré-ajouter `SSH / TCP / 22 / 0.0.0.0/0`.
2. Restaurer le workflow SSH : `git revert` du commit de bascule (l'ancien `deploy-sync-server.yml` reste dans l'historique git).
3. La clé `reqly-new.pem` (si conservée) redevient utilisable immédiatement.

---

## Annexe — architecture cible

```
push main (sync-server/**)
  → GitHub Actions (runner)
      → OIDC → assume role reqly-gh-deploy (SSM:SendCommand limité à l'instance)
      → aws ssm send-command (HTTPS sortant, port 443)
          → agent SSM sur l'instance (connexion sortante permanente)
              → git pull + rebuild-restart.sh + health
Ports entrants ouverts : 80, 443 uniquement (Caddy). SSH : fermé.
```
