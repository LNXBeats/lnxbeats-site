# Authentification — V0.5.2

## Décision

L’authentification utilise **Better Auth 1.6.26**, son adaptateur Prisma officiel, PostgreSQL et Argon2id. La V0.5.2 ouvre l’inscription membre, la vérification d’adresse, le renvoi de vérification, la récupération du compte et un profil minimal. Elle ne branche aucun fournisseur email de production et ne crée aucun administrateur permanent.

Références officielles :

- [Better Auth avec Next.js](https://better-auth.com/docs/integrations/next)
- [Email et mot de passe](https://better-auth.com/docs/authentication/email-password)
- [Email](https://better-auth.com/docs/concepts/email)
- [Sessions](https://better-auth.com/docs/concepts/session-management)
- [Rate limiting](https://better-auth.com/docs/concepts/rate-limit)
- [Sécurité](https://better-auth.com/docs/reference/security)

Les modules de configuration, Prisma et transport email sont marqués `server-only`. Aucun hash, secret, token ou client Prisma n’est importé dans un Client Component.

## Parcours et état du membre

Une inscription publique crée toujours un utilisateur avec :

- rôle `MEMBER`, imposé par le serveur ;
- statut `PENDING` ;
- `emailVerified = false` et `emailVerifiedAt = null` ;
- aucune session automatique.

Le payload public n’accepte que l’email normalisé, le mot de passe et un nom d’affichage borné. `role`, `status`, `image` et tout champ supplémentaire sont refusés avant Better Auth. L’email n’est pas modifiable dans l’espace membre.

La connexion d’un compte non vérifié est bloquée. Après une vérification valide, Better Auth positionne `emailVerified`; le callback serveur renseigne `emailVerifiedAt` et fait passer uniquement un compte `PENDING` à `ACTIVE`. Un compte déjà suspendu ou désactivé n’est jamais réactivé par ce parcours. Seul un statut `ACTIVE` peut ouvrir une session.

## Vérification email

Better Auth signe un token de vérification non prévisible avec `AUTH_SECRET`. Sa durée de validité est de 60 minutes. Le message pointe vers `/verifier-email` avec le token dans le fragment, qui n’est jamais envoyé dans la ligne de requête HTTP. La page retire immédiatement le fragment de l’historique puis transmet le token par `POST` à `/api/auth/verification-email`, qui le consomme côté serveur. L’endpoint Better Auth natif est masqué au public afin que le passage par le contrôle d’usage unique ne puisse pas être contourné.

Après une consommation réussie, une empreinte SHA-256 du token est enregistrée sous un identifiant unique dans `auth_verifications`. Le token brut n’est ni stocké ni journalisé. Une seconde consommation, un token expiré ou une valeur invalide produit le même état utilisateur neutre. L’index unique ajouté par la migration V0.5.2 protège les consommations concurrentes.

Le renvoi de vérification utilise la même destination locale. Sa réponse est identique pour une adresse existante, absente ou déjà vérifiée.

## Récupération et mots de passe

`/mot-de-passe-oublie` répond toujours par un message générique. Better Auth ne crée un token que pour un compte approprié, sans exposer cette décision. Le token de reset est aléatoire, expire après 30 minutes et son identifiant est stocké sous forme hachée grâce à `verification.storeIdentifier = "hashed"`.

`/reinitialiser-mot-de-passe` reçoit également le token dans le fragment, le retire de l’historique dès le chargement, puis impose la politique de 12 à 128 caractères. Une consommation réussie supprime le token et révoque toutes les sessions du compte. L’ancien mot de passe et tous les anciens cookies deviennent inutilisables ; une nouvelle connexion est nécessaire.

Depuis `/compte`, un membre peut modifier son mot de passe après avoir fourni le mot de passe courant. Better Auth supprime alors toutes les sessions existantes, crée une nouvelle session courante et remplace le cookie. Les cookies antérieurs, y compris celui de l’onglet courant, sont invalidés.

## Profil minimal et autorisation

`/compte` affiche l’email en lecture seule, l’état de vérification, un formulaire de nom d’affichage et la section Sécurité. Seul `displayName` peut être modifié. Les tentatives de modifier email, rôle, statut ou image sont rejetées côté serveur.

Les pages privées appellent toujours les helpers serveur :

- `requireUser()` exige une session persistée et un statut `ACTIVE` ;
- `requireVerifiedUser()` ajoute l’exigence d’une adresse vérifiée pour les brouillons et commandes ;
- `requireRole()` contrôle le rôle relu depuis PostgreSQL ;
- `requireAdmin()` n’accepte que `ADMIN`.

Le masquage d’un élément côté client ne constitue jamais une autorisation. Aucun formulaire de création d’admin ni bootstrap de production n’existe.

Les routes `/api/orders/*` relisent également le propriétaire de chaque commande. Une référence valide ne donne aucun droit d’accès ; les détails de prévention IDOR et de protection des photos sont dans [`docs/ORDER_MODEL.md`](ORDER_MODEL.md).

## Mots de passe, sessions et cookies

Les mots de passe sont hachés avec Argon2id v19 : 64 MiB, trois itérations, parallélisme 1, sortie 32 octets et sel aléatoire par hash. Aucun mot de passe ou hash n’est journalisé.

Les sessions vivent dans PostgreSQL. Le navigateur reçoit un token opaque dans un cookie préfixé `lnx-studio`, `HttpOnly`, `SameSite=Lax`, `Path=/` et `Secure` en production. La durée maximale est de 12 heures, le renouvellement intervient après une heure d’activité et la fraîcheur sensible vaut 30 minutes. Le cache de session dans le cookie reste désactivé afin qu’une révocation soit immédiatement observable.

## Anti-énumération

Les réponses publiques sont normalisées :

- connexion : même erreur pour email absent, mauvais mot de passe, compte non vérifié ou statut refusé ;
- inscription : même succès neutre pour une création possible ou un email déjà utilisé ;
- renvoi et mot de passe oublié : même succès pour une adresse existante ou absente ;
- vérification et reset : même refus neutre pour une valeur invalide, expirée ou déjà utilisée.

Le login conserve un statut `429` lorsqu’une limite est atteinte, mais sans révéler l’existence d’un compte. Les parcours d’envoi et d’inscription appliquent en plus un plancher temporel court pour réduire les différences observables.

## Rate limiting PostgreSQL

Les compteurs partagés sont persistés dans `auth_rate_limits` :

| Route | Limite |
| --- | --- |
| connexion | 5 par minute |
| inscription | 5 par 10 minutes |
| renvoi de vérification | 3 par heure |
| mot de passe oublié | 3 par heure |
| reset password | 5 par 15 minutes |
| changement de mot de passe | 5 par 15 minutes |
| modification du profil | 10 par 10 minutes |

Ces limites sont temporaires et ne verrouillent jamais définitivement un compte. Avant production, l’interprétation de l’adresse IP derrière le proxy réel devra être validée.

## CSRF, origine, redirections et logs

Les protections d’origine et CSRF de Better Auth restent activées. Les mutations sensibles sont en plus refusées si leur en-tête `Origin` ne correspond pas exactement à `AUTH_URL`. Les callbacks acceptés sont des chemins internes fixes ; aucune destination fournie par le visiteur n’est utilisée comme redirect externe.

La destination demandée après connexion passe par `safeInternalPath`. Les URL absolues, protocol-relative, contenant un antislash, des caractères de contrôle ou une origine différente sont remplacées par `/compte`.

Les tokens peuvent exister brièvement dans une URL d’action locale, mais ne sont envoyés à aucun domaine tiers. Les routes concernées ont une politique de referrer restrictive, consomment le token côté serveur ou le retirent immédiatement de l’URL, et sont dynamiques avec `no-store`. Les logs ne doivent jamais contenir mot de passe, hash, token, cookie, secret ou URL d’action complète.

## Transport email QA

`lib/email/auth-email.ts` définit une abstraction minimale pour les emails de vérification et de reset. Le seul transport V0.5.2 est `capture` :

- interdit lorsque `NODE_ENV=production` ;
- accepte uniquement des destinataires `@example.invalid` ;
- écrit un fichier JSON Lines local avec des permissions `0600` ;
- ne charge aucun SDK SMTP et n’effectue aucun appel réseau ;
- n’ajoute ni tracking pixel, ni marketing, ni ressource distante.

Les variables génériques sont `MAIL_FROM`, `AUTH_EMAIL_TRANSPORT` et `AUTH_EMAIL_CAPTURE_PATH`. Aucun credential SMTP ou fournisseur réel n’est prévu avant la V0.5.3.

## Secrets, build et comptes internes

`AUTH_URL`, `AUTH_SECRET` et `DATABASE_URL` restent exclusivement fournis par l’environnement. Le build public utilise un secret aléatoire transitoire uniquement pendant `phase-production-build`, alors qu’aucun endpoint n’est servi. Au runtime, l’absence d’un vrai `AUTH_SECRET` fait échouer l’authentification de manière fermée ; aucun secret de secours stable n’est commité.

`createInternalAuthUser` reste une primitive serveur pour les fixtures contrôlées. Ces comptes de confiance sont créés `ACTIVE` et déjà vérifiés, car aucun email réel ne peut leur être envoyé en QA. Le script exige le mode test, la cible Prisma Dev exacte et une adresse `@example.invalid`. Il ne constitue pas un bootstrap de production.

## SEO, cache et accessibilité

Les routes `/inscription`, `/connexion`, `/mot-de-passe-oublie`, `/renvoyer-verification`, `/reinitialiser-mot-de-passe`, `/verifier-email`, `/compte` et `/admin` déclarent `noindex, nofollow`, sont hors sitemap et bloquées dans `robots.txt`. Les pages dépendantes d’une session ou d’un token sont dynamiques et ne partagent aucun cache utilisateur.

Les formulaires utilisent des labels explicites, `autocomplete` adapté (`email`, `current-password`, `new-password`), messages annoncés, focus visible et boutons tactiles. Les animations suivent la règle globale `prefers-reduced-motion`.

## Validation locale

Les tests purs s’exécutent avec `npm run test:auth`. La suite `npm run test:auth:runtime` refuse de démarrer hors de l’instance locale jetable `lnx-studio-v052-test`, sans preuve Prisma Dev exacte, secrets éphémères, transport capture et boîte locale approuvée. Elle couvre inscription, injection de rôle, vérification, renvoi, profil, sessions, récupération, reset, expiration, réutilisation, origine et limites, puis vérifie le nettoyage complet.

La suppression définitive d’un compte, le MFA, les emails réels, le bootstrap administrateur et le dashboard restent hors périmètre. La suppression/anonymisation devra être arbitrée avec les obligations métier et RGPD avant d’exposer une action destructive.
