# Architecture — LNX Studio

## Principes

LNX Studio utilise l’App Router de Next.js. L’architecture reste volontairement directe : composants réutilisables pour les motifs stables, données locales typées pour le catalogue et JavaScript client limité aux interactions qui l’exigent.

## Arborescence

```text
app/
  api/health/       Healthcheck Railway
  [routes]/         Pages publiques et metadata associées
  globals.css       Tokens et styles du design system
  layout.tsx        Layout racine, SEO, navigation et footer
components/         Composants visuels et interactifs partagés
data/               Configuration publique et discographie typée
docs/               Architecture, roadmap et déploiement
public/             Images publiques et carte Open Graph
scripts/            Contrôles automatisés légers
```

## Frontend

Les pages sont des Server Components par défaut. Cette approche minimise le JavaScript envoyé au navigateur et facilite le référencement.

Deux composants seulement ont besoin de l’exécution client :

- `SiteHeader` pour l’ouverture, la fermeture, le focus et le clavier du menu mobile ;
- `MusicOrderForm` pour la progression locale, la validation et le récapitulatif du brief.

Le formulaire ne déclenche aucun appel réseau. Les fichiers sélectionnés ne quittent pas le navigateur.

## Design system

Les tokens centraux sont déclarés dans `app/globals.css` : noir profond, surfaces anthracite, blanc chaud, or retenu et rouge sombre. Les composants structurants couvrent les boutons, conteneurs, titres de section, liens de plateformes et cartes de parution.

Les animations reposent uniquement sur CSS et sont neutralisées avec `prefers-reduced-motion`.

## Données

`data/discography.ts` expose un type `Release` et une liste locale. Les identifiants `slug`, la catégorie, les liens et l’artwork optionnel préparent :

- la future route `/album/[slug]` ;
- une migration vers PostgreSQL ;
- l’administration du catalogue.

Les pages `/admin`, `/client` et `/api/*` métier ne sont pas implémentées en V0.1. Elles seront ajoutées avec une couche d’authentification et des autorisations explicites.

## SEO et performance

- metadata Next.js par route ;
- URL canonique configurable par `SITE_URL` ;
- Open Graph et Twitter Card dédiés ;
- sitemap et robots générés ;
- données structurées `MusicGroup` limitées aux informations publiques connues ;
- images servies avec `next/image` ;
- catalogue pré-rendu statiquement ;
- healthcheck dynamique sans cache.

## Sécurité

La V0.1 ne contient aucun secret ni flux financier. Les anciens endpoints Express de commande, PayPal, virement, SMTP et administration ont été retirés. Les en-têtes de base désactivent la détection MIME, limitent le referrer et ferment caméra, microphone et géolocalisation.

Toute future fonctionnalité sensible devra inclure validation serveur, contrôle d’accès, journalisation minimale, rate limiting et gestion des secrets dans Railway.
