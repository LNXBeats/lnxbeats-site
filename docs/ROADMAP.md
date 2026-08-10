# Roadmap — LNX Studio

## V0.1 — Foundation

- Next.js, React, TypeScript strict, Tailwind CSS et ESLint
- design system sombre et premium
- routes publiques, navigation responsive et footer
- SEO, accessibilité, performance et healthcheck Railway
- catalogue local typé et formulaire de commande purement frontend
- documentation et contrôles qualité

## V0.1.1 — Audit qualité

- audit de l’architecture, du rendu responsive et du contenu
- durcissement des en-têtes HTTP et de la sérialisation JSON-LD
- amélioration du clavier, du focus, des contrastes et des cibles tactiles
- validation frontend explicite du formulaire sans ajout de flux métier
- rationalisation des données publiques, des assets et de la documentation

## V0.2 — Identité artistique & catalogue

- identité éditoriale LNX Beats et slogan officiel
- accueil enrichi, sélection de projets et catalogue structuré
- route statique `/album/[slug]` et metadata propres à chaque fiche
- placeholders honnêtes en attente des pochettes et données officielles
- enrichissement des pages à propos, commande, boutique et contact

## V0.3 — Enrichissement du catalogue

- intégration progressive des pochettes officielles
- années, genres, crédits et tracklists vérifiés
- liens d’écoute propres à chaque sortie
- préparation de la source de données métier

## V0.4 — Data Foundation

- schéma PostgreSQL et Prisma ORM
- catalogue, utilisateurs, clients, commandes et assets modélisés
- migration initiale et Prisma Client pour Next.js
- confidentialité et stratégie de migration documentées
- aucune bascule du frontend vers la base

## V0.4.1 — PostgreSQL Runtime Validation

- migration initiale exécutée, réinitialisée et rejouée sur une base locale jetable
- schéma physique, contraintes et comportements relationnels validés avec Prisma Client
- rollback, concurrence, reconnexion et absence de drift confirmés
- données QA et instance temporaire supprimées après validation
- aucune connexion à la production et aucune bascule du frontend

## V0.5.1 — Auth Foundation

- Better Auth, Prisma et sessions PostgreSQL
- connexion fermée et passwords Argon2id
- rôles `ADMIN`, `MEMBER`, `CUSTOMER` et statuts contrôlés côté serveur
- placeholders protégés `/compte` et `/admin`
- anti-énumération, protection d’origine et rate limiting en base
- aucune inscription, email, récupération ou administration complète

## V0.5.2 — Parcours membres

- inscription et connexion sécurisées
- vérification d’adresse et récupération de compte
- favoris connectés à un utilisateur réel

## V0.6 — Administration & commandes

- authentification forte
- rôles et permissions
- gestion du catalogue et des niveaux de confiance
- validation serveur des briefs et suivi de statut
- téléversement et livraison sécurisés
- e-mails transactionnels et textes juridiques validés

## V0.7 — Paiement

- fournisseur de paiement retenu après cadrage
- webhooks, idempotence et rapprochement
- facturation et conformité juridique
- aucune donnée bancaire sensible stockée

## V1.0 — Production

- audit sécurité et accessibilité
- tests e2e complets
- sauvegardes, observabilité et procédures d’incident
- validation juridique et éditoriale
- déploiement Railway et activation contrôlée du domaine
