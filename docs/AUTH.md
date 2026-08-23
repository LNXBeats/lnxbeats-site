# Authentification — inscription vérifiée par code

## Décision

L’authentification repose sur Better Auth 1.6.26, Prisma, PostgreSQL et Argon2id. Better Auth conserve la connexion, les sessions, le profil et la récupération du mot de passe. La création publique de compte appartient désormais au parcours LNX Beats vérifié par code ; l’endpoint natif `sign-up/email` est désactivé et bloqué.

Le parcours ne crée aucun utilisateur en attente :

1. le visiteur saisit uniquement son adresse email ;
2. un code cryptographiquement aléatoire à six chiffres est préparé ;
3. le visiteur prouve la possession de la boîte ;
4. une preuve serveur courte autorise le choix du mot de passe ;
5. une transaction crée le compte vérifié `MEMBER / ACTIVE` et son credential Argon2id ;
6. la connexion reste une action distincte.

Aucune commande, aucun paiement et aucune session ne sont créés par l’inscription.

## Nouveau parcours d’inscription

`/inscription` présente une seule décision par écran : email, code, puis mot de passe. Le nom d’affichage initial est neutre (`Membre LNX`) et pourra être modifié depuis le compte.

`POST /api/auth/registration/code` n’accepte que `email`. `POST /api/auth/registration/verify` n’accepte que `attemptId` et un code à six chiffres. `POST /api/auth/registration/complete` n’accepte que deux mots de passe identiques de 12 à 128 caractères. Tout champ supplémentaire — notamment `role`, `status`, `emailVerified`, `image` ou un email de remplacement — est refusé.

Une fermeture ou un rafraîchissement après validation du code peut reprendre à l’écran du mot de passe tant que la preuve serveur est valide. Aucun token durable n’est écrit dans `localStorage` ou `sessionStorage`.

## Sécurité OTP

Chaque envoi crée une ligne `auth_registration_attempts` contenant l’identifiant, l’email normalisé, une empreinte HMAC-SHA-256 du code liée à l’identifiant et à l’email, l’expiration, les compteurs, les dates de vérification et de consommation, puis l’empreinte éventuelle de la preuve de continuation. Le code brut n’est jamais persisté ni journalisé.

Le code est généré avec le générateur cryptographique Node, sur six chiffres. Un nouvel envoi invalide immédiatement les tentatives antérieures pour cette adresse. Le dernier code remplace donc tous les précédents.

Après un code correct, un token opaque de 256 bits est généré. Seule son empreinte SHA-256 est stockée. Le navigateur reçoit la valeur dans un cookie `HttpOnly`, `SameSite=Lax`, limité au chemin `/api/auth/registration`, `Secure` hors preview locale explicite et jamais lisible par JavaScript.

## Expiration et tentatives

- code : 10 minutes ;
- maximum : 5 erreurs, la cinquième invalide la tentative ;
- preuve de continuation : 10 minutes ;
- code et preuve : usage unique ;
- renvoi : rotation complète du code et de l’identifiant.

Une preuve déjà consommée ne peut ni recréer le compte ni remplacer le mot de passe. Une répétition concurrente de la même finalisation est idempotente : un seul utilisateur et un seul credential existent à la fin.

## Création atomique du membre

La finalisation relit la tentative sous verrou transactionnel PostgreSQL. Elle vérifie la preuve, son expiration et sa consommation, puis crée dans la même transaction :

- `User.email` normalisé ;
- `emailVerified = true` et `emailVerifiedAt` renseigné ;
- `role = MEMBER`, imposé côté serveur ;
- `status = ACTIVE`, imposé côté serveur ;
- un `Account` credential avec hash Argon2id.

Argon2id utilise la version 19, 64 MiB, trois itérations, parallélisme 1, sortie 32 octets et un sel aléatoire. Le mot de passe brut et le hash ne sont jamais journalisés. La transaction et le verrou consultatif empêchent la duplication lors d’un double clic ou de deux requêtes concurrentes.

## Rate limiting PostgreSQL

Les compteurs partagés utilisent la table existante `auth_rate_limits`. Les clés sont préfixées et HMAC-hachées afin de ne pas stocker directement l’email ou l’adresse IP dans la clé.

| Action | Limite principale |
| --- | --- |
| envoi / renvoi du code | 4 par email et par heure |
| envoi / renvoi du code | 20 par IP et par heure |
| validation du code | 5 erreurs au niveau de la tentative, plus plafonds techniques tentative/IP |
| finalisation | plafonds courts par tentative et IP |
| connexion | 5 par minute |
| mot de passe oublié | 3 par heure |
| reset password | 5 par 15 minutes |

Les routes extraient l’adresse transmise par le proxy puis appliquent toujours en parallèle logique une limite liée à l’email ou à la tentative. La chaîne de proxy réelle devra être validée avant production ; une IP seule n’est jamais le garde-fou unique.

## Anti-énumération

Une adresse nouvelle et une adresse déjà inscrite reçoivent le même statut, la même structure et le même message lors de la demande de code. Dans les deux cas, un code est préparé : il n’existe donc pas de différence publique liée à une recherche utilisateur.

Après un code correct seulement — donc après preuve de possession de la boîte — une adresse déjà inscrite est orientée vers la connexion ou la récupération. Son mot de passe n’est jamais remplacé par le parcours d’inscription. Les réponses de connexion et de récupération restent génériques.

## Email transactionnel

Le sujet du nouveau message est `Votre code LNX Beats`. Le corps contient le code, sa validité de dix minutes et la consigne d’ignorer la demande si elle n’a pas été initiée par le destinataire. Il n’ajoute ni marketing, tracking, pixel, ressource distante ou lien externe.

L’Auth appelle une abstraction unique. Le transport `capture` écrit un fichier JSON Lines local en permissions `0600` et n’effectue aucun appel réseau. Il accepte :

- les identités fictives `@example.invalid` dans les bases QA jetables ;
- l’identité exacte configurée par `ADMIN_EMAIL` dans la seule preview locale persistante explicitement gardée ;
- cette même identité dans la base QA auth dédiée, pour tester le bootstrap.

Le transport `resend` conserve les gardes strictes de la preview personnelle et peut être ouvert en production uniquement par le contrat V0.7.8. En production, `EMAIL_PROVIDER=resend` est obligatoire pour l'inscription, la vérification legacy et la récupération. Il partage les credentials et l'identité d'expéditeur Resend du système transactionnel, tout en restant un chemin direct afin qu'aucun OTP ou token ne soit persisté dans l'outbox métier.

La production exige une origine `AUTH_URL` HTTPS, la confirmation notification exacte, les flags généraux cohérents, un domaine From et Reply-To contrôlé sous `lnxbeats.fr`, ainsi que des secrets présents dans le coffre. Elle refuse toute adresse `.invalid`, `.test`, `resend.dev`, tout expéditeur QA et toute combinaison incomplète. `NOTIFICATION_WORKER_ENABLED` ne pilote pas l'envoi Auth immédiat, mais le rollback doit désactiver explicitement les deux transports.

La preview locale continue d'exiger la clé locale, l'expéditeur approuvé, l'adresse de réponse administrative et le destinataire propriétaire approuvé. Elle refuse avant tout appel réseau :

- `NODE_ENV=test` ;
- toute base dont la cible se termine par `-test` ;
- les adresses `@example.invalid` ;
- tout destinataire autre que le propriétaire dans cette preview ;
- une origine, une base, un expéditeur ou une adresse de réponse inattendus.

Le domaine `email.lnxbeats.fr` doit rester vérifié côté Resend. L’envoi OTP fournit une clé d’idempotence liée à l’identifiant de tentative ; le rate limiting PostgreSQL et le verrouillage existants restent actifs. Une erreur ou une réponse sans identifiant d’acceptation invalide la tentative et produit uniquement une erreur publique générique. Aucun code, clé, cookie, preuve ou mot de passe n’est journalisé.

Les liens de vérification legacy et de reset utilisent eux aussi une clé d'idempotence dérivée d'une empreinte non réversible du token. Le token brut n'entre jamais dans cette clé, un log, l'outbox ou un événement de diagnostic.

Le sujet OTP est `Votre code LNX Beats`. Les versions HTML et texte contiennent seulement le code, son expiration de dix minutes et la consigne d’ignorer une demande non initiée, sans tracking, publicité, image distante ni lien externe.

## Sessions, profil et récupération

Les sessions vivent dans PostgreSQL. Le navigateur reçoit un token opaque dans un cookie préfixé `lnx-studio`, `HttpOnly`, `SameSite=Lax`, `Path=/` et `Secure` en production. Leur durée maximale est de 12 heures, le renouvellement intervient après une heure et le cache de session dans le cookie reste désactivé ; une révocation est donc immédiatement observable.

`/compte` autorise uniquement le nom d’affichage. Email, rôle, statut et image ne peuvent pas être modifiés par le payload public. Le changement de mot de passe exige le mot de passe courant et révoque les autres sessions. La récupération utilise un token opaque haché, valable 30 minutes et à usage unique ; une réussite révoque toutes les sessions précédentes.

Les anciennes pages de vérification par lien restent disponibles uniquement pour d’éventuels comptes `PENDING` issus de la version antérieure. Elles ne participent plus à une nouvelle inscription.

## Autorisation et administration

L’autorisation ne dépend jamais de l’adresse email. Les pages privées relisent la session et le rôle PostgreSQL : `requireUser()` exige `ACTIVE`, `requireVerifiedUser()` ajoute la vérification, `requireRole()` contrôle le rôle, et `/admin` appelle toujours `requireAdmin()` qui exige `role = ADMIN`.

L’identité administrative approuvée est configurée par `ADMIN_EMAIL=lnx.beats.pro@gmail.com`, mais cette variable ne donne aucun droit à elle seule. Le propriétaire doit d’abord suivre le parcours public sécurisé et vérifier l’adresse. Ensuite seulement, le script serveur/CLI contrôlé peut promouvoir ce compte :

```text
ADMIN_BOOTSTRAP_CONFIRM=promote-verified-admin npm run auth:admin:bootstrap
```

Le bootstrap :

- cible uniquement l’adresse configurée et approuvée ;
- exige un compte `ACTIVE` avec email vérifié ;
- refuse les bases distantes, le port PostgreSQL standard et toute cible non approuvée ;
- accepte uniquement la preview locale persistante ou une base QA suffixée `-test` sous `NODE_ENV=test` ;
- est idempotent ;
- ne crée pas le compte, ne demande pas le mot de passe et ne journalise aucun secret.

Un email ressemblant à celui de l’administrateur, un champ client `role: ADMIN` ou une modification visuelle du navigateur ne confère aucun accès.

## Preview locale persistante

La preview personnelle utilise conceptuellement la cible `lnx-studio-local-preview`. Sa configuration doit vivre dans `.env.local`, déjà ignoré par Git :

```text
AUTH_URL=http://127.0.0.1:3000
AUTH_SECRET=<secret local stable, au moins 32 caractères>
EMAIL_PROVIDER=resend
RESEND_API_KEY=<clé locale non commitée>
EMAIL_FROM=LNX Beats <no-reply@email.lnxbeats.fr>
EMAIL_REPLY_TO=lnx.beats.pro@gmail.com
AUTH_EMAIL_CAPTURE_PATH=/private/tmp/lnx-studio-local-preview-mailbox.jsonl
ADMIN_EMAIL=lnx.beats.pro@gmail.com
LNX_PREVIEW_MODE=persistent-local
LNX_DATABASE_TARGET=lnx-studio-local-preview
DATABASE_URL=<URL de la base locale persistante>
```

Le secret doit rester stable entre build et démarrage afin de préserver les sessions. Il ne doit jamais être commité ni affiché dans un rapport. La base ne doit pas être recréée, vidée ou réinitialisée à chaque lancement. Les builds `.next` sont reconstructibles ; les utilisateurs, credentials, rôles et sessions PostgreSQL ne le sont pas et doivent survivre aux rebuilds.

## QA jetable contre données personnelles

La suite `npm run test:registration:runtime` cible exclusivement l’instance locale jetable `lnx-studio-v062-auth-test`, son fichier de preuve Prisma Dev exact, une boîte sous `/private/tmp`, un secret et un mot de passe QA jetables. Elle exige `EMAIL_PROVIDER=capture` et refuse une URL distante, le port 5432, une cible différente ou un transport réel.

Elle couvre notamment : email valide, envoi, code correct, code incorrect, cinquième échec, expiration, réutilisation, renvoi, limite, politique de mot de passe, rôle membre forcé, injection admin, preuve rejouée, double soumission concurrente, email existant, anti-énumération, création/promotion admin, contrôle du rôle et révocation de session. Son nettoyage supprime uniquement les données de cette base dédiée et sa boîte locale.

La preview `lnx-studio-local-preview` est personnelle et persistante. Aucun script QA ne doit la cibler, aucun reset automatique ne doit la supprimer et le compte `lnx.beats.pro@gmail.com` ainsi que ses sessions ne doivent jamais être inclus dans un nettoyage de fixtures.

## Secrets, logs et production

`AUTH_SECRET`, `DATABASE_URL`, mots de passe, codes, preuves, cookies et URLs d’action complètes ne doivent jamais être committés ou journalisés. Le build sans base utilise uniquement le secret transitoire existant pendant `phase-production-build` ; tout runtime réel sans secret échoue fermé.

Railway et sa base de production restent hors périmètre de cette validation locale. Aucun reset, bootstrap ou transport capture ne doit être exécuté sur ces services. L’activation de Resend sur Railway exige le preflight et la procédure humaine décrits dans [PRODUCTION_NOTIFICATIONS.md](PRODUCTION_NOTIFICATIONS.md) ; elle n’est jamais implicite dans la configuration de preview.

## SEO et accessibilité

Les routes d’authentification déclarent `noindex, nofollow`, sont exclues du sitemap et servies sans cache partagé. Les formulaires utilisent des labels explicites, `autocomplete=email`, `one-time-code` et `new-password`, des annonces d’erreur, un focus visible, des cibles tactiles et le comportement global `prefers-reduced-motion`.
