# Authentification — V0.5.1

## Décision

La fondation utilise **Better Auth 1.6.26** avec son adaptateur Prisma officiel. Cette solution est retenue pour ses sessions en base, son intégration App Router, ses protections d’origine/CSRF, son rate limiting persistant et ses parcours email/password extensibles. Elle évite de reconstruire une authentification complète autour de simples primitives cryptographiques.

Auth.js a également été évalué. Son fournisseur Credentials laisse volontairement à l’application la persistance des utilisateurs, le hachage, le rate limiting et les workflows de récupération. Cette liberté est utile dans certains contextes, mais apportait ici davantage de code de sécurité spécifique sans bénéfice fonctionnel en V0.5.1.

Références officielles :

- [Better Auth avec Next.js](https://better-auth.com/docs/integrations/next)
- [Adaptateur Prisma](https://better-auth.com/docs/adapters/prisma)
- [Sécurité](https://better-auth.com/docs/reference/security)
- [Sessions](https://better-auth.com/docs/concepts/session-management)
- [Rate limiting](https://better-auth.com/docs/concepts/rate-limit)
- [Auth.js Credentials](https://authjs.dev/getting-started/authentication/credentials)

Les versions sont fixées dans le lockfile. `server-only` interdit une importation accidentelle de Prisma ou de la configuration d’auth dans un Client Component.

## Périmètre actif

La V0.5.1 fournit :

- `POST /api/auth/sign-in/email` et les routes de session Better Auth nécessaires ;
- `/connexion`, sans inscription publique ;
- `/compte`, protégé et accessible aux rôles actifs ;
- `/admin`, placeholder strictement réservé à `ADMIN` ;
- un logout qui invalide réellement la session en base ;
- les helpers serveur `requireUser`, `requireRole` et `requireAdmin`.

Elle ne fournit pas d’inscription, d’envoi d’email, de récupération publique, de dashboard, de favoris dynamiques ni de gestion des membres.

## Modèle

Better Auth s’appuie sur quatre modèles dédiés :

- `Account` : identité du fournisseur et hash du mot de passe pour `credential` ;
- `Session` : token opaque, expiration, user agent et adresse IP éventuelle ;
- `Verification` : support futur des jetons à usage limité ;
- `RateLimit` : compteurs partagés entre instances applicatives.

`User` garde les données de profil et les enums métier `UserRole` et `UserStatus`. Le booléen `emailVerified`, requis par Better Auth, coexiste avec `emailVerifiedAt`, conservé pour une future trace métier datée. Le workflow futur devra mettre ces deux champs à jour ensemble.

Les relations `Session` et `Account` utilisent `ON DELETE CASCADE`. Un compte désactivé ou suspendu ne peut pas ouvrir une nouvelle session. Aucun rôle n’est accepté depuis les données publiques d’inscription ou de connexion.

## Mots de passe

Les mots de passe sont hachés avec Argon2id v19 :

- mémoire : 64 MiB ;
- itérations : 3 ;
- parallélisme : 1 ;
- sortie : 32 octets ;
- sel aléatoire propre à chaque hash.

La politique courante accepte 12 à 128 caractères. La vérification d’un hash malformé échoue sans exception publique. `needsPasswordRehash` permet une migration ultérieure des paramètres. Aucun mot de passe ou hash n’est journalisé.

## Sessions et cookies

La session est stockée dans PostgreSQL ; le navigateur reçoit uniquement un token opaque signé dans un cookie préfixé `lnx-studio`.

- durée maximale : 12 heures ;
- renouvellement après 1 heure d’activité ;
- fraîcheur sensible : 30 minutes ;
- cache de session dans le cookie désactivé, afin qu’une révocation soit immédiatement visible ;
- cookie `HttpOnly`, `SameSite=Lax`, `Path=/` ;
- `Secure` forcé en production ;
- `Max-Age=43200` lorsque la session est mémorisée ;
- logout : suppression de la session PostgreSQL et expiration du cookie.

Aucun token n’est placé dans `localStorage` ou rendu accessible à `document.cookie`.

## Autorisation serveur

Les pages privées appellent la couche d’accès serveur :

- `requireUser()` exige une session et un statut `ACTIVE` ;
- `requireRole()` contrôle le rôle issu de la ligne `User` en base ;
- `requireAdmin()` n’accepte que `ADMIN`.

Le masquage d’une interface client n’est jamais considéré comme une autorisation. Les pages privées sont rendues à la requête (`force-dynamic`) et ne mettent aucune donnée utilisateur dans un cache partagé.

## Anti-énumération et redirections

Better Auth effectue un hash factice lorsqu’un compte ou un credential n’existe pas. La route publique normalise en plus tous les échecs de connexion — email absent, mot de passe incorrect, compte suspendu ou erreur de création de session — vers le même statut et le même message. Le rate limiting conserve son statut `429`, avec le même corps générique.

La destination après connexion passe par `safeInternalPath`. Les URL absolues, protocol-relative, contenant un antislash, des caractères de contrôle ou une origine différente sont remplacées par `/compte`.

## CSRF, origine et brute force

Les contrôles d’origine, de Fetch Metadata et de destination de Better Auth restent actifs. `trustedOrigins` contient uniquement `AUTH_URL`; `disableCSRFCheck` et `disableOriginCheck` sont explicitement fixés à `false`, y compris pendant les tests. Le client envoie la connexion au handler HTTP de même origine pour que le rate limiter s’exécute réellement.

Le login est limité à cinq requêtes par minute et par couple route/IP. Les compteurs sont stockés dans PostgreSQL, donc partagés entre plusieurs instances. Ce premier palier n’est pas un verrouillage permanent de compte. Avant un déploiement derrière proxy, la chaîne d’IP de confiance devra être vérifiée avec l’infrastructure réelle ; une future version pourra combiner IP, identité normalisée, délai progressif et événements de sécurité sobres.

Les logs de sécurité ne doivent contenir ni email complet si non nécessaire, ni mot de passe, hash, token, cookie, secret ou URL de connexion.

## Secrets et build

Les variables runtime sont :

- `AUTH_URL` : origine exacte de l’application ;
- `AUTH_SECRET` : valeur aléatoire d’au moins 32 octets, distincte par environnement ;
- `DATABASE_URL` : URL PostgreSQL fournie uniquement côté serveur.

Le build public utilise un secret aléatoire transitoire uniquement pendant `phase-production-build`, car aucun endpoint n’est alors servi. Au runtime, l’absence de `AUTH_SECRET` fait échouer l’authentification de manière fermée. Aucun secret de secours stable n’est commité.

## Création de comptes

Il n’existe ni inscription publique ni création automatique du premier administrateur. `createInternalAuthUser` est une primitive serveur atomique qui normalise l’email, valide le rôle, hache le mot de passe puis crée `User` et `Account` dans une transaction.

Le script de fixtures n’est qu’un outil QA : il exige `NODE_ENV=test`, le nom exact `lnx-studio-v051-test`, une URL directe en boucle locale et une preuve Prisma Dev correspondant à cette instance. Il ne crée que des emails `@example.invalid` et propose une opération de nettoyage. Une vraie commande de bootstrap ADMIN, interactive et auditable, sera conçue séparément avant tout usage réel.

## Email verification et password reset

Les tables et l’adaptateur rendent ces parcours possibles, mais ils sont désactivés : aucun callback d’envoi, SMTP, écran public ou token réel n’est créé en V0.5.1.

La future implémentation devra :

- répondre de façon identique pour un email existant ou absent ;
- utiliser des tokens cryptographiquement aléatoires, courts en durée et à usage unique ;
- réévaluer le stockage hashé des tokens avant activation ;
- synchroniser `emailVerified` et `emailVerifiedAt` ;
- invalider les autres sessions après un reset ;
- journaliser l’événement sans données sensibles.

## SEO et limites

`/connexion`, `/compte` et `/admin` déclarent `noindex, nofollow`, sont absents du sitemap et interdits dans `robots.txt`. Les headers CSP, anti-frame, nosniff, referrer et permissions restent inchangés.

Limites connues : pas de MFA, pas de vérification email, pas de reset, pas de bootstrap de production, pas d’audit métier persistant et pas encore de politique de proxy validée en environnement déployé.

## Validation locale

Les contrôles purs s’exécutent avec :

```bash
npm run test:auth
```

`npm run test:auth:runtime` exige exclusivement l’instance PostgreSQL locale jetable `lnx-studio-v051-test`, ses variables de preuve et un mot de passe QA fourni par l’environnement. La suite vérifie création interne, Argon2id, inscription refusée, CSRF, anti-énumération, trois rôles, cookie, session, logout et rate limiting, puis garantit zéro donnée QA. Elle n’exécute aucun reset.
