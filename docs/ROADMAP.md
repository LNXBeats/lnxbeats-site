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

## V0.4 — Commande

- validation serveur du brief
- téléversement sécurisé des références
- persistance PostgreSQL
- e-mails transactionnels et suivi de statut
- textes juridiques validés

## V0.5 — Paiement

- PayPal côté serveur
- virement bancaire encadré
- webhooks, idempotence et rapprochement
- facturation et conformité juridique

## V0.6 — Administration

- authentification forte
- rôles et permissions
- gestion des commandes et de la discographie
- espace client et livraison sécurisée

## V1.0 — Production

- audit sécurité et accessibilité
- tests e2e complets
- sauvegardes, observabilité et procédures d’incident
- validation juridique et éditoriale
- déploiement Railway et activation contrôlée du domaine
