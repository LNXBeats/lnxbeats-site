# LNX Studio

Site officiel de **LNX Beats**. La V0.5.1 conserve l’expérience publique statique et ajoute une fondation d’authentification fermée : connexion, sessions PostgreSQL, rôles serveur et espaces privés minimaux.

Le site public cible `https://lnxbeats.fr` et reste préparé pour un hébergement Railway. Aucun paiement, aucune commande réelle, aucune inscription publique, aucun email et aucun dashboard ne sont actifs dans cette version.

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

La validation runtime de l’authentification possède des gardes supplémentaires liées à l’instance Prisma Dev locale `lnx-studio-v051-test`. Elle crée uniquement des identités `@example.invalid`, ne lance aucun reset et supprime comptes, credentials, sessions, vérifications et compteurs à la fin. La procédure et les variables sont décrites dans [docs/AUTH.md](docs/AUTH.md).

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
- `/commander` — parcours frontend de préparation d’un brief
- `/boutique` — liens DistroKid Direct et Etsy
- `/a-propos` — présentation éditoriale
- `/contact` — contact professionnel
- `/mentions-legales`, `/confidentialite`, `/cgv` — emplacements juridiques à finaliser
- `/api/health` — healthcheck JSON Railway

## Routes privées

- `/connexion` — connexion email/password, sans inscription publique
- `/compte` — placeholder protégé pour `MEMBER`, `CUSTOMER` et `ADMIN` actifs
- `/admin` — placeholder protégé réservé à `ADMIN`
- `/api/auth/*` — handlers Better Auth, côté serveur uniquement

## Variables d’environnement

| Variable | Usage | Secret |
| --- | --- | --- |
| `SITE_URL` | URL canonique utilisée par les metadata, le sitemap et robots.txt | Non |
| `AUTH_URL` | Origine exacte autorisée pour les routes d’authentification | Non |
| `AUTH_SECRET` | Signature et protection des données d’auth ; minimum 32 octets aléatoires | Oui |
| `DATABASE_URL` | Connexion PostgreSQL locale ou de développement | Oui |
| `SHADOW_DATABASE_URL` | Base shadow jetable pour les contrôles Prisma Migrate | Oui |
| `LNX_DATABASE_TARGET` | Identifiant explicite de la cible QA autorisée par le script de validation | Non |
| `LNX_EXPECTED_DATABASE` | Nom exact de la base locale contenu dans `DATABASE_URL` | Non |
| `ALLOW_DATABASE_RESET` | Garde explicite requise pour la validation destructive locale | Non |
| `PORT` | Port d’écoute ; fourni automatiquement par Railway | Non |

Les URL PostgreSQL et secrets réels restent dans les fichiers `.env*` ignorés par Git ou dans un gestionnaire de secrets. Aucun secret SMTP, de paiement ou de production n’est commité.

## Architecture

Les pages et composants serveur sont privilégiés. Le menu mobile, le formulaire de brief et les contrôles de connexion/logout utilisent des Client Components limités. Les décisions de rôle et de statut restent côté serveur. La discographie demeure locale et toutes ses fiches sont pré-rendues sans base de données ; aucune route publique n’interroge les comptes.

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

Le merge, le push et le déploiement de production restent des actions explicites, séparées de ce sprint.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Modèle de données](docs/DATA_MODEL.md)
- [Authentification et sécurité](docs/AUTH.md)
- [Audit du catalogue et des assets](docs/CATALOG_AUDIT.md)
- [Roadmap](docs/ROADMAP.md)
- [Déploiement](docs/DEPLOYMENT.md)
- [Changelog](CHANGELOG.md)
