# Changelog

Toutes les évolutions notables de LNX Studio sont consignées dans ce fichier.

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
