# LNX Studio

Site officiel de **LNX Beats**, le projet artistique de Ludovic Mathon. La V0.6.0.1 sépare la commande personnelle de l’éventuelle extension de droits post-livraison, sans ouvrir de paiement.

Le site public cible `https://lnxbeats.fr` et reste préparé pour un hébergement Railway. Les membres vérifiés peuvent enregistrer, reprendre et finaliser une demande réelle, puis la suivre dans leur espace. Aucun paiement, email de commande, facture, livraison WAV ou dashboard administrateur n’est actif.

## Stack

- Next.js 16 avec App Router
- React 19
- TypeScript strict
- Tailwind CSS 4 et CSS global pour le design system
- ESLint avec les règles Next.js Core Web Vitals
- PostgreSQL et Prisma ORM 7
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

La validation runtime de l’authentification possède des gardes supplémentaires liées à l’instance Prisma Dev locale `lnx-studio-v052-test`. Elle utilise uniquement des identités `@example.invalid` et un transport email capturé sans réseau. Elle couvre inscription, vérification, récupération, profil et invalidation des sessions, puis supprime comptes, credentials, sessions, vérifications, compteurs et boîte QA. La procédure et les variables sont décrites dans [docs/AUTH.md](docs/AUTH.md).

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
- `/discographie` — catalogue local typé et sélection éditoriale
- `/album/[slug]` — fiche statique d’un projet, avec metadata dynamiques
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
- `/admin` — placeholder protégé réservé à `ADMIN`
- `/api/auth/*` — handlers Better Auth, côté serveur uniquement
- `/api/orders/*` — brouillons et photos privés, protégés par session, origine et propriété

## Variables d’environnement

| Variable | Usage | Secret |
| --- | --- | --- |
| `SITE_URL` | URL canonique utilisée par les metadata, le sitemap et robots.txt | Non |
| `AUTH_URL` | Origine exacte autorisée pour les routes d’authentification | Non |
| `AUTH_SECRET` | Signature et protection des données d’auth ; minimum 32 octets aléatoires | Oui |
| `DATABASE_URL` | Connexion PostgreSQL locale ou de développement | Oui |
| `MAIL_FROM` | Expéditeur logique des emails transactionnels | Non |
| `AUTH_EMAIL_TRANSPORT` | Transport non-production ; seule la valeur `capture` existe en V0.5.2 | Non |
| `AUTH_EMAIL_CAPTURE_PATH` | Fichier local de capture QA, hors dépôt | Non |
| `ORDER_UPLOAD_MODE` | Adaptateur de fichiers ; `local-private` en développement et `local-qa` sur la cible jetable | Non |
| `ORDER_UPLOAD_DIR` | Racine privée, hors `public/` ; QA limitée à `/private/tmp` | Non |
| `SHADOW_DATABASE_URL` | Base shadow jetable pour les contrôles Prisma Migrate | Oui |
| `LNX_DATABASE_TARGET` | Identifiant explicite de la cible QA autorisée par le script de validation | Non |
| `LNX_EXPECTED_DATABASE` | Nom exact de la base locale contenu dans `DATABASE_URL` | Non |
| `ALLOW_DATABASE_RESET` | Garde explicite requise pour la validation destructive locale | Non |
| `PORT` | Port d’écoute ; fourni automatiquement par Railway | Non |

Les URL PostgreSQL et secrets réels restent dans les fichiers `.env*` ignorés par Git ou dans un gestionnaire de secrets. Aucun secret SMTP, de paiement ou de production n’est commité.

## Architecture

Les pages et composants serveur sont privilégiés. Le menu mobile, le formulaire de brief, l’action post-livraison et les formulaires d’authentification utilisent des Client Components limités. Les décisions de rôle, propriété, statut, vérification, prix de création, éligibilité et prix des droits restent côté serveur. Les photos privées sont réencodées hors du répertoire public ; seuls leurs descripteurs sont en base. La discographie demeure locale et ses fiches restent pré-rendues sans base de données.

## Ajouter un projet au catalogue

1. Ajouter une entrée dans `data/discography.ts` avec un `slug` unique, des descriptions éditoriales explicitement distinguées des données factuelles, un statut et les champs structurants.
2. Conserver `year: null`, `releaseDate: null`, `cover: null`, `genres: []`, `credits: []` ou `tracks: []` tant que ces données ne sont pas confirmées.
3. Pour une pochette officielle, déposer l’image dans `public/assets/covers/` puis renseigner `cover` et `coverAlt`.
4. Ajouter uniquement des liens vérifiés dans `platforms`, en distinguant `scope: "release"` d’un simple profil artiste.
5. Mettre à jour les niveaux de confiance concernés sans transformer une donnée inconnue en valeur plausible.
6. Lancer `npm run check` : la route `/album/[slug]`, ses metadata et son entrée de sitemap sont générées automatiquement.

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
- [Roadmap](docs/ROADMAP.md)
- [Déploiement](docs/DEPLOYMENT.md)
- [Changelog](CHANGELOG.md)
