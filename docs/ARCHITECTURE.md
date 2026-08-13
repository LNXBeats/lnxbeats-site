# Architecture — LNX Studio

## Principes

LNX Studio utilise l’App Router de Next.js. L’architecture reste volontairement directe : composants réutilisables pour les motifs stables, catalogue PostgreSQL lu côté serveur et JavaScript client limité aux interactions qui l’exigent.

## Arborescence

```text
app/
  admin/            Cockpit et catalogue éditable réservés à ADMIN
  album/[slug]/     Fiches de projet dynamiques et metadata PostgreSQL
  media/catalog/    Lecture publique bornée aux covers et extraits de projets visibles
  api/auth/         Handlers Better Auth
  api/orders/       Brouillons et photos privés, contrôlés côté serveur
  api/health/       Healthcheck Railway
  compte/           Profil, sécurité, liste et détail des commandes
  connexion/        Formulaire de connexion
  inscription/      Création publique d’un MEMBER
  verifier-email/   Résultat de vérification sans token persistant dans l’URL
  [auth routes]/    Renvoi, mot de passe oublié et reset
  [routes]/         Pages publiques et metadata associées
  globals.css       Tokens et styles du design system
  icon.tsx          Favicon PNG généré par Next.js
  layout.tsx        Layout racine, SEO, navigation et footer
components/         Composants visuels et interactifs partagés
data/               Configuration publique, biographies et fixture historique figée
docs/               Architecture, vision produit, audits, roadmap et déploiement
generated/prisma/   Prisma Client généré localement et ignoré par Git
lib/auth/           Validation, tokens, email, rôles, session et redirection
lib/orders/         Domaine, prix, autorisations, stockage et services commande
lib/catalog/        Requêtes, validation, mutations, migration et covers catalogue
lib/email/          Templates transactionnels et transport capture QA
lib/auth.ts         Configuration Better Auth exclusivement serveur
lib/prisma.ts       Singleton PostgreSQL exclusivement serveur
prisma/             Schéma et migrations de la fondation de données
public/             Images publiques et carte Open Graph
scripts/            Contrôles automatisés légers
```

## Frontend

Les pages sont des Server Components par défaut. Cette approche minimise le JavaScript envoyé au navigateur et facilite le référencement.

Les zones suivantes ont besoin de l’exécution client :

- `SiteHeader` pour l’ouverture, la fermeture, le piégeage du focus et le clavier du menu mobile ;
- `MusicOrderForm` pour la progression locale, la validation et le récapitulatif du brief ;
- les formulaires d’authentification pour envoyer des mutations de même origine et annoncer des messages neutres ;
- `LogoutButton` pour révoquer la session puis rafraîchir la navigation.

Le formulaire Commander garde sa progression côté client mais enregistre explicitement les brouillons via des routes de même origine. Les prix, droits d’accès, limites et transitions sont recalculés côté serveur. Les photos passent par une validation binaire et un stockage privé ; elles ne sont jamais servies directement depuis `public/`.

## Design system

Les tokens centraux sont déclarés dans `app/globals.css` : noir profond, surfaces anthracite, blanc chaud, or retenu et rouge sombre. Les composants structurants couvrent les boutons, conteneurs, titres de section, liens de plateformes et cartes de parution.

Les animations reposent uniquement sur CSS et sont neutralisées avec `prefers-reduced-motion`.

## Données

`data/site.ts` centralise les profils artiste officiels pour éviter les divergences entre les pages. `data/artist.ts` contient les biographies éditoriales de référence. PostgreSQL est la source runtime unique du catalogue ; `data/discography.ts` reste uniquement la fixture figée ayant permis la migration contrôlée des 25 projets.

- identité (`slug`, titre, sous-titre, type et statut) ;
- date de sortie et année explicitement nullables ;
- contenu éditorial court et long ;
- pochette officielle nullable et tonalité du placeholder éditorial ;
- mise à la une, genres, crédits et pistes structurées ;
- nombre de pistes nullable, distinct de la liste détaillée ;
- liens de plateformes avec une portée explicite (`release`, `artist` ou `store`) ;
- description SEO propre à la fiche ;
- niveau de confiance global et par domaine (`confirmed`, `partial`, `placeholder` ou `unknown`).

`lib/catalog/queries.ts` centralise les lectures de l’accueil, de la discographie, des fiches et du sitemap. Aucun de ces chemins ne contient de fallback vers la fixture historique.

Les identifiants et relations permettent :

- la route dynamique `/album/[slug]` ;
- la persistance PostgreSQL ;
- l’administration du catalogue.

### Fiches de projet

`app/album/[slug]/page.tsx` reste un Server Component dynamique. `generateMetadata` charge le même projet PostgreSQL que la page et fournit titre, description, canonique, Open Graph et Twitter Card. Les fiches inconnues ou non publiques retournent `notFound()`.

L’absence d’une donnée est un état normal : aucune année, pochette, durée, liste de titres, crédit ou URL de sortie n’est extrapolée. `ProjectArtwork`, `Tracklist` et `ProjectPlatforms` rendent alors un message explicite. Les profils artiste et les liens directs de sortie sont présentés dans des groupes séparés.

L’inventaire historique est consigné dans [`docs/CATALOG_AUDIT.md`](CATALOG_AUDIT.md). La procédure de bascule, les gardes et le rollback sont décrits dans [`docs/CATALOG_RUNTIME_MIGRATION.md`](CATALOG_RUNTIME_MIGRATION.md).

### Enrichir une fiche

L’ADMIN utilise `/admin/catalogue/[slug]`. Les mutations choisissent explicitement les champs autorisés, contrôlent l’origine, valident les entrées côté serveur et sérialisent les opérations sensibles par projet. `/admin/catalogue/nouveau` crée par défaut un brouillon privé avec un slug normalisé unique, tout autre état devant être choisi explicitement ; le slug d’un projet existant, le rôle, le compte et les autres domaines métier ne sont jamais modifiables par ces formulaires. Le cycle de vie propose masquage, archivage réversible et suppression définitive fortement confirmée, avec conservation systématique des médias partagés.

### Fondation PostgreSQL

La V0.4 ajoute Prisma ORM 7, un schéma PostgreSQL et une migration initiale. Les entités séparent catalogue, comptes, clients, commandes, historique, assets, favoris et confiance des données. Les décisions détaillées, relations et règles de suppression sont décrites dans [`docs/DATA_MODEL.md`](DATA_MODEL.md).

`lib/prisma.ts` utilise l’adaptateur `pg`, un singleton global en développement et la barrière `server-only`. Les routes catalogue publiques l’atteignent uniquement par `lib/catalog/queries.ts`. Le formulaire Commander garde sa couche métier séparée. La migration V0.6.0.3 a comparé les 25 projets avant la bascule.

Prisma Client est généré dans un répertoire ignoré par Git. La configuration ne contient aucun secret et accepte `DATABASE_URL` uniquement depuis l’environnement. Aucune base réelle, aucun seed et aucun utilisateur ne sont créés en V0.4.

### Authentification et parcours membres

La V0.5.1 ajoute Better Auth, son adaptateur Prisma et Argon2id. La V0.5.2 active l’inscription `MEMBER`, la vérification email, le renvoi, la récupération et le profil minimal. Les sessions, credentials, marqueurs de vérification et compteurs de rate limiting vivent dans des tables dédiées. Toutes les pages auth et privées sont dynamiques et non indexables. Les helpers `requireUser`, `requireRole` et `requireAdmin` relisent la session en base et appliquent le statut/rôle côté serveur.

Le frontend ne reçoit jamais Prisma Client, un hash ou le token de session. Les tokens de vérification et reset sont consommés ou retirés de l’URL au plus tôt. Le catalogue public reste indépendant de l’authentification et le transport email QA ne charge aucun SDK client. Les choix détaillés et limites sont décrits dans [`docs/AUTH.md`](AUTH.md).

La valeur actuelle et future du compte, les rôles visiteur/membre/client/admin, le suivi de commande, les notifications et les paiements futurs sont cadrés dans [`docs/PRODUCT_VISION.md`](PRODUCT_VISION.md). L’état éditorial réel de chaque route est consigné dans [`docs/PAGE_AUDIT.md`](PAGE_AUDIT.md). Ces documents n’activent aucun flux métier.

### Commandes personnalisées

La V0.6 relie Commander à PostgreSQL pour les membres actifs et vérifiés. `lib/orders/domain.ts` reste pur pour validation et tarification ; `lib/orders/service.ts` concentre transactions, propriété, séquence de référence et sérialisation ; `lib/orders/storage.ts` isole l’adaptateur de fichiers non-production. Les routes API ne font que valider session/origine, parser la requête et traduire les erreurs métier.

La finalisation transactionnelle recalcule le prix et crée l’événement client avec le passage vers `AWAITING_PAYMENT`. Elle ne déclenche aucun fournisseur externe. La conception complète, les limites de fichiers et les frontières paiement/livraison sont consignées dans [`docs/ORDER_MODEL.md`](ORDER_MODEL.md).

## SEO et performance

- metadata Next.js par route ;
- URL canonique configurable par `SITE_URL` ;
- Open Graph et Twitter Card dédiés ;
- sitemap et robots générés ;
- données structurées `MusicGroup` limitées aux informations publiques connues et sérialisées sans balise HTML injectable ;
- images servies avec `next/image` ;
- catalogue et 25 fiches rendus côté serveur depuis PostgreSQL ;
- healthcheck dynamique sans cache.

### Extraits audio publics

La V0.6.0.4 ajoute un pipeline Admin séparé des covers : Route Handler multipart streamé et borné à une source MP3/WAV de 80 Mio, contrôle ADMIN et origine, stockage source temporaire, analyse/transcodage FFmpeg puis MP3 public de 60 secondes maximum. Les tags sont retirés, le mix n’est pas normalisé et le morceau complet est supprimé après traitement ; une livraison privée n’utilise jamais cette route.

La route publique sert uniquement un `AUDIO_PREVIEW` aux droits confirmés lié à un projet `PUBLISHED`. Les projets en développement, brouillons et archives restent écoutables par l’Admin, mais privés. Elle streame le fichier, gère `HEAD` et les requêtes `Range` (`200`, `206`, `416`), publie une identité de cache dépendant du nouvel asset et ne propose aucun téléchargement. Le lecteur React est léger, sans autoplay, accessible au clavier et coupe les autres extraits de la page.

La spécification opérationnelle complète se trouve dans [`docs/AUDIO_PREVIEWS.md`](AUDIO_PREVIEWS.md).

## Sécurité

La V0.6 ne contient aucun secret marchand ni flux financier. Les anciens endpoints Express, PayPal, virement et SMTP restent absents. Les réponses ajoutent une Content Security Policy, interdisent l’intégration en iframe, désactivent la détection MIME, limitent le referrer et ferment caméra, microphone et géolocalisation.

HSTS n’est volontairement pas imposé par l’application tant que la terminaison TLS et l’ensemble des sous-domaines de production ne sont pas validés. Il devra être activé au niveau Railway ou applicatif uniquement après cette vérification.

L’authentification applique validation serveur, rôle `MEMBER` imposé, statut vérifié, cookies `HttpOnly`, protection d’origine, rate limiting PostgreSQL, tokens expirables et messages anti-énumération. Le transport capture refuse la production et toute adresse autre que `@example.invalid`. `AUTH_SECRET` et les URL PostgreSQL devront être fournis par le gestionnaire de secrets de l’environnement avant tout déploiement. Briefs, credentials, tokens et cookies ne doivent jamais être écrits dans les logs.
