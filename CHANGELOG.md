# Changelog

Toutes les évolutions notables de LNX Studio sont consignées dans ce fichier.

## [0.4.1] — 2026-08-10

### Validé

- migration initiale appliquée depuis une base PostgreSQL locale vide, réinitialisée puis rejouée sans erreur SQL ;
- schéma physique, Prisma Client, singleton, CRUD, valeurs par défaut, UUID et horodatages ;
- contraintes d’unicité, composites, `CHECK`, clés étrangères et comportements `RESTRICT`, `SET NULL` et `CASCADE` ;
- rollback transactionnel, concurrence sur une unicité, déconnexion et reconnexion ;
- absence de drift entre migrations, schéma Prisma et base après reset.

### Sécurité et périmètre

- suite d’intégration protégée par des gardes imposant le mode test, une cible nommée, une adresse de boucle locale et un port non standard ;
- données QA fictives nettoyées et instance PostgreSQL jetable supprimée après validation ;
- aucune base distante ou de production, aucun secret, aucune donnée artistique et aucune bascule frontend utilisés ;
- aucun changement du schéma métier ni de la migration V0.4.

## [0.4.0] — 2026-08-10

### Ajouté

- Prisma ORM 7 et adaptateur PostgreSQL officiel ;
- schéma métier pour comptes, clients, catalogue, pistes, plateformes, crédits, assets, commandes, historique et favoris ;
- migration PostgreSQL initiale avec contraintes relationnelles et contrôles de cohérence ;
- singleton Prisma compatible avec le rechargement Next.js ;
- documentation du modèle, des suppressions, de la confidentialité et de la future migration du catalogue.

### Sécurité et périmètre

- aucun secret, utilisateur, seed ou donnée artistique ajouté ;
- aucune connexion à une base réelle et aucune migration exécutée ;
- aucune authentification, administration, commande, livraison ou intégration de paiement activée ;
- `data/discography.ts` reste la source runtime du site public.

## [0.2.0] — 2026-08-09

### Ajouté

- modèle de catalogue extensible pour les parutions et projets en développement ;
- fiches statiques `/album/[slug]`, metadata dynamiques et entrées de sitemap ;
- composants de pochette, liens officiels et tracklist avec états de données manquantes explicites ;
- sélection éditoriale sur l’accueil et la discographie ;
- structure dédiée aux futurs projets narratifs et expérimentaux.

### Modifié

- direction artistique sombre et cinématographique autour du slogan officiel ;
- contenus des pages à propos, commande, boutique, contact et footer ;
- responsive, micro-interactions CSS et documentation du catalogue.

### Sécurité et intégrité éditoriale

- aucun flux backend, paiement, stockage ou envoi réseau ajouté ;
- aucune pochette, date, tracklist, durée, statistique ou disponibilité inventée ;
- distinction explicite entre les liens de sortie et les profils artiste.

## [0.1.1] — 2026-08-09

### Modifié

- navigation mobile renforcée avec piégeage du focus et retour au déclencheur ;
- contrastes, cibles tactiles, noms de champs et validation explicite du genre musical ;
- liens officiels centralisés et catalogue exposé en lecture seule ;
- images prioritaires migrées vers l’API `preload` de Next.js 16 ;
- favicon PNG généré par l’application et asset de référence inutilisé retiré ;
- documentation alignée sur l’audit qualité.

### Sécurité

- Content Security Policy restrictive compatible avec Next.js ;
- protection anti-cadrage avec `frame-ancestors` et `X-Frame-Options` ;
- sérialisation JSON-LD neutralisant les balises HTML injectables ;
- audit des secrets, dépendances et flux réseau de la fondation.

## [0.1.0] — 2026-08-09

### Ajouté

- fondation Next.js 16, React 19, TypeScript strict et Tailwind CSS 4 ;
- design system sombre, premium et responsive ;
- accueil, discographie, commande visuelle, boutique, à propos et contact ;
- navigation mobile accessible et footer complet ;
- catalogue local typé ;
- SEO, Open Graph, sitemap, robots et données structurées ;
- endpoint Railway `/api/health` ;
- documentation d’architecture, roadmap et déploiement ;
- smoke test automatisé des routes principales.

### Modifié

- configuration Railway adaptée à Next.js ;
- scripts npm alignés sur lint, typecheck, build et smoke tests ;
- variables d’environnement réduites aux besoins réels de la V0.1.

### Supprimé

- serveur Express du prototype ;
- endpoints de commande, paiement, SMTP et administration non adaptés à cette fondation ;
- anciennes pages HTML, feuilles CSS et scripts client statiques ;
- fichiers JSON de persistance vides du prototype.

### Sécurité

- aucun paiement, envoi SMTP, stockage de brief ou interface d’administration actif ;
- aucune valeur secrète ajoutée au dépôt.
