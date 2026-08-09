# LNX Studio

Fondation professionnelle du site officiel de **LNX Beats**. Cette V0.1 installe une architecture moderne, un système visuel sombre et premium, les routes publiques essentielles et la structure du futur parcours de commande.

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

Le smoke test vérifie les six routes publiques principales ainsi que `/api/health`. Une autre origine peut être ciblée avec `SMOKE_BASE_URL`.

## Routes publiques

- `/` — accueil
- `/discographie` — catalogue local typé
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

Les pages et composants serveur sont privilégiés. Seuls le menu mobile et le formulaire interactif de préparation de commande utilisent des Client Components. La discographie est stockée dans un module local strictement typé afin de pouvoir être migrée plus tard vers PostgreSQL sans coupler l’interface à une base de données.

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) pour le détail.

## Railway

`railway.toml` lance `npm start` et utilise `/api/health`. Next.js lit automatiquement la variable `PORT` fournie par Railway.

La procédure complète, sans modification DNS, est décrite dans [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Branches Git

- `main` — production, protégée ; aucun travail direct
- `develop` — intégration des sprints validés
- `feature/v0.1-foundation` — branche de travail de cette V0.1

Le merge, le push et le déploiement de production restent des actions explicites, séparées de ce sprint.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Déploiement](docs/DEPLOYMENT.md)
- [Changelog](CHANGELOG.md)
