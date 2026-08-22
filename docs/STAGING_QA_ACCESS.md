# Portail d’accès QA staging

Le portail `/qa/access` permet à un humain autorisé d’ouvrir une vraie session LNX Studio avec un profil fictif `MEMBER` ou `ADMIN`. Il sert uniquement aux validations manuelles du staging Railway. Il ne crée ni commande, ni paiement, ni notification.

## Confinement

La page et l’API répondent comme une ressource absente tant que toutes les conditions suivantes ne sont pas réunies :

- runtime Next `production` sur l’environnement Railway nommé exactement `staging` ;
- origine canonique exacte `https://lnxbeats-site-staging.up.railway.app` pour `AUTH_URL`, `SITE_URL` et `APP_CANONICAL_URL` lorsqu’elles sont définies ;
- environnements notification, paiement et média tous déclarés `staging` ;
- `AUTH_QA_ACCESS_ENABLED=true` ;
- `AUTH_QA_ACCESS_CONFIRM=I_UNDERSTAND_THIS_ENABLES_STAGING_QA_LOGIN` ;
- `AUTH_QA_ACCESS_SECRET` d’au moins 32 caractères.

Les valeurs sûres par défaut sont :

```dotenv
AUTH_QA_ACCESS_ENABLED=false
AUTH_QA_ACCESS_CONFIRM=
AUTH_QA_ACCESS_SECRET=
```

Le secret est saisi dans un champ mot de passe puis transmis par HTTPS dans un en-tête de la requête `POST`. Il n’est jamais placé dans une URL, stocké dans le navigateur, renvoyé par l’API ou écrit dans les logs. Le serveur compare son empreinte en temps constant. Les requêtes exigent l’origine exacte du staging et sont limitées à dix tentatives par fenêtre de dix minutes.

## Profils fermés

Le navigateur peut uniquement demander `member` ou `admin`. Le serveur les associe à deux identités déterministes :

- `qa.member@lnx.invalid` — `QA Member — Staging`, rôle `MEMBER`, statut `ACTIVE`, e-mail vérifié ;
- `qa.admin@lnx.invalid` — `QA Admin — Staging`, rôle `ADMIN`, statut `ACTIVE`, e-mail vérifié.

Le domaine réservé `.invalid` est accepté par le validateur syntaxique du projet et ne peut pas recevoir un e-mail réel. Les identifiants utilisateurs sont fixes. Une transaction verrouillée crée les deux comptes une seule fois ; toute collision d’identifiant, d’adresse ou de propriété attendue interrompt l’opération sans réécrire le compte existant.

## Session et changement de profil

Le portail ne forge aucun cookie. Il utilise les endpoints Better Auth existants : la session courante est d’abord révoquée, puis une authentification interne du profil QA crée la session persistée et le cookie sécurisé normal (`HttpOnly`, `Secure`, `SameSite=Lax`). Le rôle est ensuite relu côté serveur par les gardes habituelles de `/compte` et `/admin`.

Depuis les espaces QA, le lien « Changer de profil QA » revient au portail. Le nouveau choix ferme la session courante avant d’en créer une autre. La déconnexion normale reste disponible.

## Activation humaine staging

1. Générer un secret distinct d’au moins 32 caractères dans le gestionnaire de secrets, sans le commiter.
2. Ajouter les trois variables d’accès QA dans Railway staging.
3. Vérifier que les origines et marqueurs de déploiement restent ceux du staging.
4. Déployer la branche autorisée.
5. Ouvrir `https://lnxbeats-site-staging.up.railway.app/qa/access` et saisir le secret.
6. Après la QA, mettre `AUTH_QA_ACCESS_ENABLED=false`, puis supprimer `AUTH_QA_ACCESS_CONFIRM` et `AUTH_QA_ACCESS_SECRET`.

La désactivation coupe immédiatement l’accès métier des sessions QA existantes : les gardes de pages, d’Admin et d’API refusent les deux identifiants déterministes lorsque le portail n’est plus armé. Elle ne supprime pas automatiquement les identités ou les sessions en base ; celles-ci expirent normalement. Leur nettoyage éventuel doit faire l’objet d’une procédure ciblée et ne doit jamais employer une suppression globale.

## Garanties et limites

- production et preview non armée : route absente ;
- aucun e-mail de vérification, bienvenue ou réinitialisation ;
- aucun SMS ;
- aucune mutation des flags Stripe ou PayPal ;
- aucune `Order`, `Payment` ou `ProviderEvent` créée par le portail ;
- aucun redirect fourni par le client ;
- les logs structurés contiennent seulement l’événement, le profil fermé, l’identifiant QA et la date.
