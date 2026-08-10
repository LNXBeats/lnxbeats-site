# LNX Studio

Site officiel de **LNX Beats**. La V0.4 conserve l’expérience publique statique et ajoute, sans l’activer dans le frontend, une fondation PostgreSQL/Prisma pour les futurs comptes, clients, commandes et outils d’administration.

Le site public cible `https://lnxbeats.fr` et reste préparé pour un hébergement Railway. Aucun paiement, aucune commande réelle, aucune authentification et aucune lecture ou écriture PostgreSQL ne sont actifs dans cette version.

## Stack

- Next.js 16 avec App Router
- React 19
- TypeScript strict
- Tailwind CSS 4 et CSS global pour le design system
- ESLint avec les règles Next.js Core Web Vitals
- PostgreSQL et Prisma ORM 7 pour la fondation de données inactive
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

Le serveur local est accessible par défaut sur `http://localhost:3000`.

## Vérifications

```bash
npm run lint
npm run typecheck
npm run build
npm run prisma:check
```

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

## Variables d’environnement

| Variable | Usage | Secret |
| --- | --- | --- |
| `SITE_URL` | URL canonique utilisée par les metadata, le sitemap et robots.txt | Non |
| `DATABASE_URL` | Connexion PostgreSQL locale ou de développement | Oui |
| `SHADOW_DATABASE_URL` | Base shadow jetable pour les contrôles Prisma Migrate | Oui |
| `PORT` | Port d’écoute ; fourni automatiquement par Railway | Non |

Les URL PostgreSQL réelles restent dans les fichiers `.env*` ignorés par Git ou dans un gestionnaire de secrets. Les futurs secrets de paiement, SMTP ou d’authentification ne doivent pas être ajoutés tant que les fonctionnalités correspondantes ne sont pas développées côté serveur.

## Architecture

Les pages et composants serveur sont privilégiés. Seuls le menu mobile et le formulaire interactif de préparation de commande utilisent des Client Components. La discographie reste stockée dans un module local strictement typé ; `generateStaticParams` pré-rend toutes les fiches sans base de données. Le schéma Prisma et la migration initiale sont préparatoires et ne sont importés par aucune route publique.

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

Le merge, le push et le déploiement de production restent des actions explicites, séparées de ce sprint.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Modèle de données](docs/DATA_MODEL.md)
- [Audit du catalogue et des assets](docs/CATALOG_AUDIT.md)
- [Roadmap](docs/ROADMAP.md)
- [Déploiement](docs/DEPLOYMENT.md)
- [Changelog](CHANGELOG.md)
