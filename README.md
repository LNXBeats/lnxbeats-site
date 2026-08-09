# LNX Studio

Site officiel de **LNX Beats**. La V0.2 transforme la fondation technique en expérience artistique : identité éditoriale affirmée, catalogue local extensible, sélection de projets et fiches pré-rendues pour chaque album, single ou projet en développement.

Le site public cible `https://lnxbeats.fr` et reste préparé pour un hébergement Railway. Aucun paiement, aucune commande réelle, aucune authentification et aucune persistance métier ne sont actifs dans cette version.

## Stack

- Next.js 16 avec App Router
- React 19
- TypeScript strict
- Tailwind CSS 4 et CSS global pour le design system
- ESLint avec les règles Next.js Core Web Vitals
- Node.js 20.9 ou supérieur

## Prérequis

- Node.js `>= 20.9.0`
- npm 11 recommandé

## Installation

```bash
npm ci
cp .env.example .env.local
```

Une première installation sans lockfile existant peut utiliser `npm install`.

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
| `PORT` | Port d’écoute ; fourni automatiquement par Railway | Non |

Les futurs secrets de paiement, SMTP ou d’authentification ne doivent pas être ajoutés tant que les fonctionnalités correspondantes ne sont pas développées côté serveur.

## Architecture

Les pages et composants serveur sont privilégiés. Seuls le menu mobile et le formulaire interactif de préparation de commande utilisent des Client Components. La discographie est stockée dans un module local strictement typé ; `generateStaticParams` pré-rend toutes les fiches sans base de données.

## Ajouter un projet au catalogue

1. Ajouter une entrée dans `data/discography.ts` avec un `slug` unique, des descriptions factuelles, un statut et les champs structurants.
2. Conserver `year: null`, `cover: null`, `genres: []` ou `tracks: []` tant que ces données ne sont pas confirmées.
3. Pour une pochette officielle, déposer l’image dans `public/assets/covers/` puis renseigner `cover` et `coverAlt`.
4. Ajouter uniquement des liens vérifiés dans `platforms`, en distinguant `scope: "release"` d’un simple profil artiste.
5. Lancer `npm run check` : la route `/album/[slug]`, ses metadata et son entrée de sitemap sont générées automatiquement.

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

Le merge, le push et le déploiement de production restent des actions explicites, séparées de ce sprint.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Déploiement](docs/DEPLOYMENT.md)
- [Changelog](CHANGELOG.md)
