# Architecture — LNX Studio

## Principes

LNX Studio utilise l’App Router de Next.js. L’architecture reste volontairement directe : composants réutilisables pour les motifs stables, données locales typées pour le catalogue et JavaScript client limité aux interactions qui l’exigent.

## Arborescence

```text
app/
  album/[slug]/     Fiches de projet pré-rendues et metadata dynamiques
  api/health/       Healthcheck Railway
  [routes]/         Pages publiques et metadata associées
  globals.css       Tokens et styles du design system
  icon.tsx          Favicon PNG généré par Next.js
  layout.tsx        Layout racine, SEO, navigation et footer
components/         Composants visuels et interactifs partagés
data/               Configuration publique et discographie typée
docs/               Architecture, roadmap et déploiement
generated/prisma/   Prisma Client généré localement et ignoré par Git
lib/prisma.ts       Singleton PostgreSQL pour les futurs composants serveur
prisma/             Schéma et migrations de la fondation de données
public/             Images publiques et carte Open Graph
scripts/            Contrôles automatisés légers
```

## Frontend

Les pages sont des Server Components par défaut. Cette approche minimise le JavaScript envoyé au navigateur et facilite le référencement.

Deux composants seulement ont besoin de l’exécution client :

- `SiteHeader` pour l’ouverture, la fermeture, le piégeage du focus et le clavier du menu mobile ;
- `MusicOrderForm` pour la progression locale, la validation et le récapitulatif du brief.

Le formulaire ne déclenche aucun appel réseau. Les fichiers sélectionnés ne quittent pas le navigateur.

## Design system

Les tokens centraux sont déclarés dans `app/globals.css` : noir profond, surfaces anthracite, blanc chaud, or retenu et rouge sombre. Les composants structurants couvrent les boutons, conteneurs, titres de section, liens de plateformes et cartes de parution.

Les animations reposent uniquement sur CSS et sont neutralisées avec `prefers-reduced-motion`.

## Données

`data/site.ts` centralise les liens officiels pour éviter les divergences entre les pages. `data/discography.ts` expose un type `Project` et une liste locale en lecture seule. Chaque entrée regroupe :

- identité (`slug`, titre, sous-titre, type et statut) ;
- date de sortie et année explicitement nullables ;
- contenu éditorial court et long ;
- pochette officielle nullable et tonalité du placeholder éditorial ;
- mise à la une, genres, crédits et pistes structurées ;
- nombre de pistes nullable, distinct de la liste détaillée ;
- liens de plateformes avec une portée explicite (`release`, `artist` ou `store`) ;
- description SEO propre à la fiche ;
- niveau de confiance global et par domaine (`confirmed`, `partial`, `placeholder` ou `unknown`).

Les agrégats `publishedProjects`, `projectsInDevelopment` et `featuredProjects` alimentent l’accueil et la discographie. `getProjectBySlug` résout une fiche sans dupliquer les données.

Les identifiants et relations préparent :

- la route statique `/album/[slug]` ;
- une migration vers PostgreSQL ;
- l’administration du catalogue.

### Fiches de projet

`app/album/[slug]/page.tsx` reste un Server Component. `generateStaticParams` produit une route pour chaque entrée ; `generateMetadata` fournit titre, description, canonique, Open Graph et Twitter Card par projet. Les fiches inconnues retournent `notFound()`.

L’absence d’une donnée est un état normal : aucune année, pochette, durée, liste de titres, crédit ou URL de sortie n’est extrapolée. `ProjectArtwork`, `Tracklist` et `ProjectPlatforms` rendent alors un message explicite. Les profils artiste et les liens directs de sortie sont présentés dans des groupes séparés.

L’inventaire détaillé et les besoins de confirmation humaine sont consignés dans [`docs/CATALOG_AUDIT.md`](CATALOG_AUDIT.md). Ce document reste un audit : `data/discography.ts` demeure l’unique source runtime du catalogue.

### Ajouter ou enrichir une fiche

1. Créer l’entrée dans `projects` avec un `slug` stable et unique.
2. Utiliser le helper `published` ou `inDevelopment` approprié.
3. Ajouter une pochette vérifiée sous `public/assets/covers/` et renseigner son texte alternatif ; sinon garder `cover: null`.
4. Ajouter une piste avec numéro, titre, durée optionnelle et statut uniquement si les informations sont confirmées ; renseigner séparément le nombre total lorsqu’il est connu sans tracklist complète.
5. Construire les liens de plateforme depuis `officialLinks` et définir leur portée réelle.
6. Ajouter les crédits uniquement avec un nom et un rôle explicitement documentés.
7. Mettre à jour les niveaux de confiance concernés.
8. Exécuter lint, typecheck, build et smoke tests. La route et le sitemap sont dérivés automatiquement.

### Fondation PostgreSQL

La V0.4 ajoute Prisma ORM 7, un schéma PostgreSQL et une migration initiale. Les entités séparent catalogue, comptes, clients, commandes, historique, assets, favoris et confiance des données. Les décisions détaillées, relations et règles de suppression sont décrites dans [`docs/DATA_MODEL.md`](DATA_MODEL.md).

`lib/prisma.ts` utilise l’adaptateur `pg` et un singleton global en développement. Il n’est importé par aucune route publique : le build, les fiches statiques et le formulaire Commander ne consultent ni ne modifient PostgreSQL. `data/discography.ts` reste la source runtime tant qu’un sprint de migration dédié n’a pas vérifié les 25 projets.

Prisma Client est généré dans un répertoire ignoré par Git. La configuration ne contient aucun secret et accepte `DATABASE_URL` uniquement depuis l’environnement. Aucune base réelle, aucun seed et aucun utilisateur ne sont créés en V0.4.

Les pages `/admin`, `/client` et `/api/*` métier ne sont pas implémentées en V0.4. Elles seront ajoutées avec une couche d’authentification et des autorisations explicites.

## SEO et performance

- metadata Next.js par route ;
- URL canonique configurable par `SITE_URL` ;
- Open Graph et Twitter Card dédiés ;
- sitemap et robots générés ;
- données structurées `MusicGroup` limitées aux informations publiques connues et sérialisées sans balise HTML injectable ;
- images servies avec `next/image` ;
- catalogue et 25 fiches de projet pré-rendus statiquement ;
- healthcheck dynamique sans cache.

## Sécurité

La V0.1.1 ne contient aucun secret ni flux financier. Les anciens endpoints Express de commande, PayPal, virement, SMTP et administration ont été retirés. Les réponses ajoutent une Content Security Policy, interdisent l’intégration en iframe, désactivent la détection MIME, limitent le referrer et ferment caméra, microphone et géolocalisation.

HSTS n’est volontairement pas imposé par l’application tant que la terminaison TLS et l’ensemble des sous-domaines de production ne sont pas validés. Il devra être activé au niveau Railway ou applicatif uniquement après cette vérification.

Toute future fonctionnalité sensible devra inclure validation serveur, contrôle d’accès, journalisation minimale, rate limiting et gestion des secrets dans Railway. Les briefs, credentials et URL PostgreSQL ne devront jamais être écrits dans les logs.
