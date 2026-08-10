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

- inscription publique strictement `MEMBER` et connexion après vérification
- vérification d’adresse, renvoi et récupération de compte anti-énumération
- profil minimal et changement de mot de passe connecté
- invalidation des sessions après reset ou changement sensible
- transport email local capturé, sans fournisseur de production

## V0.5.2.1 — Cohérence produit et éditoriale

- biographie officielle de Ludovic Mathon et identité LNX Beats harmonisées
- audit page par page, CTA clarifiés et parcours Commander mieux cadré
- valeur actuelle et future du compte membre explicitée sans faux dashboard
- vision documentée des commandes, livraisons, favoris, alertes et préférences
- paiements PayPal/virement, boutique physique et administration préparés sans activation
- informations légales manquantes recensées sans donnée inventée

## V0.5.3 — Email transactionnel et bootstrap sécurisé

- fournisseur email de production choisi, configuré et observé sans exposer les tokens
- domaines d’envoi, rebonds et délivrabilité validés
- bootstrap administrateur explicite, interactif et auditable
- aucune création publique ou automatique d’`ADMIN`
- cadrage de la suppression/anonymisation de compte avant toute action destructive

## V0.6 — Order Foundation

- brouillons persistés, reprise, suppression et finalisation membre
- prix déterministes côté serveur et snapshots en centimes
- références concurrentes, événements client et suivi privé
- photos de référence contrôlées, réencodées et stockées hors webroot
- aucun paiement, aucune facture, aucun email de commande et aucune livraison WAV active

## V0.6.0.1 — Séparation création / droits commerciaux

- commande initiale strictement personnelle de 50 à 90 €, sans sélection commerciale
- demande de droits séparée et disponible uniquement après livraison
- prix serveur de 1 500 €, contrat spécifique requis et statut autonome
- propriété, refus avant livraison, anti-doublon et migration additive validés
- aucun paiement, contrat électronique, facture ou interface administrateur activé

## V0.6.1 — Payment architecture & fiscal/legal readiness audit

- choix d’architecture sans intégration prématurée d’un fournisseur
- validation du régime de TVA, de la facturation et des informations professionnelles manquantes
- CGV, droits, rétractation, commencement de service, annulation et remboursement
- modèle futur `Payment` / `Invoice`, idempotence et articulation avec LNX Gestion
- Wero étudié comme possibilité future, sans implémentation ni simulation

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
