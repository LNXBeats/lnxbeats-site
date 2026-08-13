# LNX Studio

Site officiel de **LNX Beats**, le projet artistique de Ludovic Mathon. Le catalogue public et ses métadonnées vivent dans PostgreSQL ; les médias utilisent une abstraction locale/S3-compatible, sans ouvrir de paiement.

Le site public cible `https://lnxbeats.fr` et reste préparé pour un hébergement Railway. Les membres vérifiés peuvent enregistrer, reprendre et finaliser une demande réelle, puis la suivre dans leur espace. Le cockpit ADMIN lit les commandes, membres et données catalogue réelles et n’autorise que les transitions prévues. Aucun paiement, email de commande, facture ou livraison WAV n’est actif.

## Stack

- Next.js 16 avec App Router
- React 19
- TypeScript strict
- Tailwind CSS 4 et CSS global pour le design system
- ESLint avec les règles Next.js Core Web Vitals
- PostgreSQL et Prisma ORM 7
- stockage média local en développement et objet S3-compatible en production
- Better Auth avec sessions en base et mots de passe Argon2id
- Node.js 20.19, 22.12 ou 24+

## Prérequis

- Node.js `^20.19.0`, `^22.12.0` ou `>= 24.0.0`
- npm 11 recommandé

## Installation

```bash
npm ci
cp .env.example .env.local
```

Une première installation sans lockfile existant peut utiliser `npm install`.

`postinstall` génère Prisma Client sans ouvrir de connexion. Une URL PostgreSQL n’est requise que lorsqu’un module métier importe réellement `lib/prisma.ts` ou lorsqu’une commande de migration accède à une base.

## Développement

```bash
npm run dev
```

Le serveur local est accessible par défaut sur `http://localhost:3000`. Les routes privées exigent aussi `DATABASE_URL`, `AUTH_URL` et un `AUTH_SECRET` aléatoire d’au moins 32 octets.

## Vérifications

```bash
npm run lint
npm run typecheck
npm run build
npm run prisma:check
npm run test:auth
npm run test:order
npm run test:rights
npm run test:upload
npm run test:admin
npm run test:catalog
npm run test:media
```

La validation d’intégration PostgreSQL s’exécute uniquement contre une base locale jetable, vide et déjà migrée. Elle refuse toute URL qui ne cible pas explicitement une adresse de boucle locale, un port non standard et le nom de base attendu :

```bash
NODE_ENV=test \
ALLOW_DATABASE_RESET=true \
LNX_DATABASE_TARGET=lnx-studio-v041-test \
LNX_EXPECTED_DATABASE=<nom-base-locale> \
DATABASE_URL=<url-postgresql-locale-jetable> \
npm run test:database
```

Le script contrôle le schéma physique, les opérations Prisma, les contraintes et les comportements de suppression. Il nettoie ses données QA même après un échec. Il ne doit jamais être lancé contre une base partagée, distante ou de production.

La validation runtime de l’inscription possède des gardes supplémentaires liées à l’instance Prisma Dev locale jetable `lnx-studio-v062-auth-test`. Elle utilise un transport email capturé sans réseau et couvre code OTP, expiration, tentatives, anti-énumération, concurrence, compte membre, bootstrap admin et invalidation de session, puis nettoie exclusivement cette base et sa boîte QA. La preview personnelle `lnx-studio-local-preview` reste persistante et ne doit jamais être ciblée par ce nettoyage. La procédure et les variables sont décrites dans [docs/AUTH.md](docs/AUTH.md).

La validation runtime des commandes cible exclusivement l’instance Prisma Dev locale jetable `lnx-studio-v060-test` et un stockage privé sous `/private/tmp`. Elle couvre création, sauvegarde, prix serveur plafonné à 90 €, finalisation atomique, demande de droits après livraison à 1 500 €, propriété, anti-doublon, références concurrentes, événements, IDOR, photos normalisées et nettoyage. La procédure et les limites sont décrites dans [docs/ORDER_MODEL.md](docs/ORDER_MODEL.md).

Pour les smoke tests, lancer d’abord le build et le serveur de production :

```bash
npm run build
npm start
```

Puis, dans un second terminal :

```bash
npm run test:smoke
```

Le smoke test vérifie les routes publiques principales, une fiche publiée, une fiche en développement, le sitemap et `/api/health`. Une autre origine peut être ciblée avec `SMOKE_BASE_URL`.

## Routes publiques

- `/` — accueil
- `/discographie` — catalogue PostgreSQL et sélection éditoriale
- `/album/[slug]` — fiche dynamique d’un projet, avec metadata issues du catalogue
- `/commander` — brief personnel sauvegardable, photos privées, prix serveur de 50 à 90 € et finalisation sans paiement
- `/boutique` — liens DistroKid Direct et Etsy
- `/a-propos` — biographie officielle et démarche artistique
- `/contact` — contact professionnel
- `/mentions-legales`, `/confidentialite`, `/cgv` — brouillons préparatoires listant les informations à fournir ou valider
- `/api/health` — healthcheck JSON Railway

## Routes d’authentification et privées

- `/inscription` — création publique d’un compte `MEMBER` en attente de vérification
- `/connexion` — connexion email/password après vérification
- `/mot-de-passe-oublie` — demande générique de récupération
- `/renvoyer-verification` — renvoi générique du message de vérification
- `/reinitialiser-mot-de-passe` — choix d’un nouveau mot de passe avec token temporaire
- `/verifier-email` — résultat neutre de la vérification
- `/compte` — profil, sécurité, brouillons et suivi des demandes pour les rôles actifs
- `/compte/commandes/[orderNumber]` — détail privé, timeline, récapitulatif et extension de droits uniquement après livraison
- `/admin` — cockpit protégé réservé à `ADMIN`
- `/admin/commandes` — liste privée, filtres et transitions métier contextuelles
- `/admin/catalogue` — liste, filtres et édition sécurisée du catalogue PostgreSQL
- `/admin/catalogue/nouveau` — création sécurisée d’un projet, privé et brouillon par défaut
- `/admin/catalogue/[slug]` — identité, visibilité, jukebox, récit, crédits, pistes, liens directs, cover et audio
- `/admin/membres` — lecture limitée des comptes sans credentials ni sessions
- `/api/auth/*` — handlers Better Auth, côté serveur uniquement
- `/api/orders/*` — brouillons et photos privés, protégés par session, origine et propriété

## Variables d’environnement

| Variable | Usage | Secret |
| --- | --- | --- |
| `SITE_URL` | URL canonique utilisée par les metadata, le sitemap et robots.txt | Non |
| `AUTH_URL` | Origine exacte autorisée pour les routes d’authentification | Non |
| `AUTH_SECRET` | Signature et protection des données d’auth ; minimum 32 octets aléatoires | Oui |
| `DATABASE_URL` | Connexion PostgreSQL locale ou de développement | Oui |
| `EMAIL_PROVIDER` | Adaptateur transactionnel : `capture` en QA automatisée, `resend` dans la preview personnelle autorisée | Non |
| `RESEND_API_KEY` | Clé d’envoi Resend, exclusivement dans les secrets locaux ou d’environnement | Oui |
| `EMAIL_FROM` | Expéditeur appartenant au domaine transactionnel vérifié | Non |
| `EMAIL_REPLY_TO` | Adresse de réponse humaine des messages transactionnels | Non |
| `AUTH_EMAIL_CAPTURE_PATH` | Fichier local de capture QA, hors dépôt | Non |
| `ORDER_UPLOAD_MODE` | Adaptateur de fichiers ; `local-private` en développement et `local-qa` sur la cible jetable | Non |
| `ORDER_UPLOAD_DIR` | Racine privée, hors `public/` ; QA limitée à `/private/tmp` | Non |
| `MEDIA_STORAGE_ROOT` | Racine absolue privée des covers et previews audio normalisées, hors `public/` et hors Git | Non |
| `MEDIA_STORAGE_DRIVER` | `local` en preview/QA, `s3` pour le stockage objet durable | Non |
| `MEDIA_DEPLOYMENT_ENV` | Sépare explicitement `local-preview`, `staging` et `production` | Non |
| `MEDIA_LOCAL_PUBLIC_ROOT` / `MEDIA_LOCAL_PRIVATE_ROOT` | Racines locales distinctes public/privé, hors webroot | Non |
| `MEDIA_STORAGE_PROVIDER` | Identifiant du fournisseur objet persisté avec l’asset (`r2` recommandé) | Non |
| `MEDIA_S3_ENDPOINT` / `MEDIA_S3_REGION` | Endpoint et région S3-compatible | Non |
| `MEDIA_S3_ACCESS_KEY_ID` / `MEDIA_S3_SECRET_ACCESS_KEY` | Credentials serveur du stockage objet | Oui |
| `MEDIA_PUBLIC_BUCKET` / `MEDIA_PRIVATE_BUCKET` | Buckets distincts ; staging limité à `lnx-studio-staging-public` / `lnx-studio-staging-private` | Non |
| `MEDIA_R2_STAGING_CONFIRM` | Confirmation non secrète, opt-in, du canary R2 staging | Non |
| `MEDIA_R2_STAGING_RUNTIME_CONFIRM` / `MEDIA_R2_AUDIO_WAV_CONFIRM` | Confirmations non secrètes des QA HTTP R2 destructives sur base jetable | Non |
| `MEDIA_MIGRATION_CONFIRM` / `MEDIA_MIGRATION_MAINTENANCE_CONFIRM` / `MEDIA_MIGRATION_DATABASE_CONFIRM` | Triples confirmations non secrètes des écritures de migration sous maintenance, dont une cible explicitement la base preview locale persistante | Non |
| `AUDIO_TEMP_ROOT` | Racine temporaire optionnelle des sources audio complètes ; le namespace et le TTL restent imposés par l’application | Non |
| `FFMPEG_PATH` | Chemin absolu optionnel du FFmpeg système ; sinon le binaire reproductible du package est utilisé | Non |
| `SHADOW_DATABASE_URL` | Base shadow jetable pour les contrôles Prisma Migrate | Oui |
| `LNX_DATABASE_TARGET` | Identifiant explicite de la cible QA autorisée par le script de validation | Non |
| `LNX_PRISMA_DEV_SERVER_FILE` | Preuve optionnelle explicite du runtime Prisma Dev ; la migration média utilise sinon la preuve locale portant le nom de `LNX_DATABASE_TARGET` | Non |
| `LNX_EXPECTED_DATABASE` | Nom exact de la base locale contenu dans `DATABASE_URL` | Non |
| `ALLOW_DATABASE_RESET` | Garde explicite requise pour la validation destructive locale | Non |
| `PORT` | Port d’écoute ; fourni automatiquement par Railway | Non |

Les URL PostgreSQL et secrets réels restent dans les fichiers `.env*` ignorés par Git ou dans un gestionnaire de secrets. Aucun secret SMTP, de paiement ou de production n’est commité.

## Architecture

Les pages et composants serveur sont privilégiés. Le menu mobile, le formulaire de brief, l’action post-livraison et les formulaires d’authentification utilisent des Client Components limités. Les décisions de rôle, propriété, statut, vérification, prix de création, éligibilité et prix des droits restent côté serveur. Les photos privées sont réencodées hors du répertoire public ; seuls leurs descripteurs sont en base. La discographie, l’accueil, les fiches et le sitemap interrogent PostgreSQL par une couche serveur unique, sans fallback vers le fichier historique.

## Administrer le catalogue

Le catalogue se gère depuis `/admin/catalogue`. « Nouveau projet » ouvre une création minimale ; le serveur normalise et réserve un slug unique, attribue la prochaine position disponible si aucune position n’est choisie et applique par défaut un brouillon masqué, sans mise en avant ni jukebox. L’Admin peut choisir explicitement un autre état cohérent lors de la création. La fiche créée réutilise ensuite les pipelines existants pour la cover, la preview audio, la tracklist, les crédits et les liens.

Le slug d’un projet existant reste stable et non modifiable. Chaque bloc est enregistré explicitement ; les changements concurrents d’une fiche sont refusés plutôt qu’écrasés. Enregistrer, rendre visible et placer dans un jukebox sont trois décisions distinctes. Le catalogue public, les fiches, le sitemap et les jukebox relisent automatiquement PostgreSQL ; les jukebox exigent en plus une cover et le statut correspondant.

« Masquer du site » conserve les données et le statut. « Archiver et masquer » retire également le placement jukebox ; l’Admin peut restaurer le projet en modifiant de nouveau son statut et sa visibilité. La suppression définitive est disponible uniquement pour un projet déjà masqué, en brouillon ou archivé, jamais pour la mise en avant de l’accueil. Elle exige la saisie exacte du slug, nettoie les relations et les médias exclusivement rattachés, et conserve tout asset partagé avec un autre projet ou une commande.

`data/discography.ts` est figé comme source historique de migration V0.6.0.2. Il ne doit plus être importé par le runtime public ni modifié pour éditer le catalogue. PostgreSQL couvre désormais le cycle de vie quotidien complet d’un projet.

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) pour le détail.

## Railway

`railway.toml` lance `npm start` et utilise `/api/health`. Next.js lit automatiquement la variable `PORT` fournie par Railway.

La procédure complète, sans modification DNS, est décrite dans [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Branches Git

- `main` — production, protégée ; aucun travail direct
- `develop` — intégration des sprints validés
- `feature/v0.1-foundation` — fondation V0.1 validée
- `feature/v0.1.1-quality-audit` — audit et durcissement local de la fondation
- `feature/v0.2-artistic-catalog` — identité artistique et catalogue
- `feature/v0.4-data-foundation` — fondation PostgreSQL/Prisma sans bascule runtime
- `feature/v0.4.1-postgres-runtime-validation` — validation PostgreSQL locale jetable
- `feature/v0.5.1-auth-foundation` — sessions, rôles et espaces privés minimaux
- `feature/v0.5.2-registration-recovery` — inscription, vérification email et récupération de compte
- `feature/v0.5.2.1-product-editorial-audit` — identité, audit produit, parcours membres et préparation juridique
- `feature/v0.6-order-foundation` — brouillons, commandes, prix, photos privées et suivi membre
- `feature/v0.6.0.1-post-delivery-rights` — séparation de la création personnelle et des droits post-livraison

Le merge, le push et le déploiement de production restent des actions explicites, séparées de ce sprint.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Modèle de données](docs/DATA_MODEL.md)
- [Authentification et sécurité](docs/AUTH.md)
- [Commandes et sécurité des fichiers](docs/ORDER_MODEL.md)
- [Vision produit](docs/PRODUCT_VISION.md)
- [Audit produit et éditorial](docs/PAGE_AUDIT.md)
- [Audit du catalogue et des assets](docs/CATALOG_AUDIT.md)
- [Migration runtime du catalogue](docs/CATALOG_RUNTIME_MIGRATION.md)
- [Stockage des médias](docs/MEDIA_STORAGE.md)
- [Évaluation des fournisseurs média](docs/MEDIA_PROVIDER_EVALUATION.md)
- [Previews audio](docs/AUDIO_PREVIEWS.md)
- [Roadmap](docs/ROADMAP.md)
- [Déploiement](docs/DEPLOYMENT.md)
- [Changelog](CHANGELOG.md)
