# Boutique V1.1.0 — contrat de préparation Production Phase 5E

## Portée et statut

Cette fondation est validée uniquement en QA locale et n'autorise aucune promotion ni activation. Elle ne constitue ni une activation, ni une vérification Production. La Boutique reste fermée par défaut et les paiements, remboursements Live, notifications réelles et providers transport restent désarmés. Le lancement V1.1.0 cible exclusivement les particuliers livrés en France métropolitaine ; le domaine Billing général reste extensible et aucune capacité B2B n'est supprimée.

Les statuts doivent rester explicites : `LOCAL FOUNDATION READY` signifie que le code et les runtimes locaux sont validés ; `PRODUCTION ACTIVATED` exige une action humaine ultérieure ; `PRODUCTION VERIFIED` exige ensuite des preuves réelles séparées. Aucun statut ne se déduit automatiquement du précédent.

## Tarification et colis

La candidate `colissimo-domicile-france-2026-v1` reste `DRAFT` jusqu'à une activation Admin explicite. Source commerciale à vérifier humainement avant activation : grille Colissimo Domicile France 2026. Les paliers exacts, exprimés en grammes et centimes EUR, sont : 250/549, 500/759, 750/929, 1000/959, 2000/1119, 5000/1739, 10000/2529, 15000/3199 et 30000/3959. Aucune marge ni ancien frais par article n'est ajouté.

Le poids tarifé est la somme des poids produits physiques expédiés. Le profil `carton-cd-60g-v1` ajoute 60 g au poids physique, accepte au plus 16 articles et reste offert au client ; il n'entre donc pas dans le palier commercial. Chaque ShopOrder fige la version tarifaire, le palier, les poids produit/emballage/physique/tarifé et le profil d'emballage. Un produit physique sans poids, une grille absente, un pays hors `FR` ou une quantité supérieure à la capacité échoue fermé.

## Stock et maintenance

Une réservation active expire après 30 minutes. Le runner one-shot `npm run shop:phase5e:maintenance` est borné, idempotent et protégé par verrou consultatif PostgreSQL. Il expire les réservations impayées, purge les preuves SAV dues, détecte la première analyse SAV dépassant cinq jours ouvrés et matérialise les états Payment/Refund/Shipping `PENDING` ou `REQUIRES_REVIEW` sans mutation financière. Une future tâche planifiée pourra appeler ce runner ; aucune cadence Railway n'est définie ni activée par Phase 5E.

La confirmation de paiement et l'expiration prennent le même verrou de commande. Une seule issue est possible : paiement confirmé avec stock décrémenté une fois et réservation `CONFIRMED`, ou commande expirée sans décrément. La disponibilité publique distingue disponible, temporairement indisponible car réservé, et épuisé car vendu.

## SAV, annulation et adresse

Une demande SAV peut être créée avec un message et zéro photo. Jusqu'à cinq preuves JPEG, PNG ou WebP de 5 Mio chacune peuvent ensuite être ajoutées. Extension, MIME, signature, taille, nom et chemin sont validés. Les fichiers sont privés, mode `0600`, accessibles uniquement au propriétaire DB-first ou à un Admin, jamais attachés aux e-mails. Ils sont purgés 90 jours après clôture, avec audit idempotent.

Chaque ligne défectueuse conserve quantité demandée/autorisée, décision de retour, remboursement et restock. Après approbation Admin, un remboursement immédiat utilise les patterns provider existants. Pour une commande mono-article défectueuse, le remboursement peut inclure l'unique frais d'expédition ; pour une commande multi-articles il couvre uniquement les lignes autorisées. Aucun retry aveugle n'est permis après résultat ambigu.

Une ShopOrder payée non expédiée peut recevoir une demande MEMBER d'annulation ou de correction d'adresse. Le MEMBER ne mute jamais lui-même la commande, le paiement, le stock ou la facture. L'Admin revalide sous verrou. Une annulation approuvée déclenche un remboursement serveur, un restock exactement une fois, un avoir exactement une fois et conserve `paidAt` comme preuve historique. Une correction d'adresse ne recalcule ni total ni shipping et ne réécrit jamais la facture historique. Toute demande après expédition est refusée.

## Notifications et observabilité

Les événements SAV, annulation et adresse possèdent des clés d'idempotence distinctes. Les payloads séparent strictement `LNX-SAV` et `LNX-REQ`, minimisent les données et pointent vers la ressource autorisée. Phase 5E utilise uniquement le transport `capture` local. Les alertes Admin sont des signaux : elles ne confirment aucun paiement, remboursement, stock ou envoi.

Le tableau Admin expose grille DRAFT/ACTIVE, profil d'emballage, demandes client, alertes et derniers runs. Il ne doit jamais afficher `READY` si la grille commerciale n'est pas active, si les flags sont fermés ou si une anomalie exige une revue.

## SEO et origine publique

L'origine canonique est `https://www.lnxbeats.fr`. Les canonical, Open Graph, sitemap et robots utilisent cette origine. Le host racine redirige chemin et query vers `www`. Un host Railway public ne redirige que les pages HTML publiques : `/api/*`, webhooks, auth, healthchecks et autres appels machine restent exclus. `127.0.0.1` et `localhost` ne sont jamais redirigés en QA.

La branche locale historique `feature/v1.1.1-seo-canonical-origin` au commit `7733e200ee71d4e7a38c623ac099d1d1b608124f` doit être conservée. Phase 5E réimplémente ses protections compatibles sur la base Boutique actuelle ; elle ne réutilise pas son ancien arbre.

## Identités QA canoniques

Phase 5E réutilise la version juridique technique QA inscrite dans `lib/shop/legal.ts` et `SHOP_PAYMENT_PRICING_VERSION` (`shop-order-v1`). Aucune candidate juridique n'est activée. Les anciennes valeurs rencontrées dans des preuves historiques restent historiques et ne doivent pas être copiées dans une nouvelle fixture.

## Préflight migration, backup et rollback

Le candidat contient 28 migrations additives. Avant une future migration réelle : fermer les nouvelles commandes et paiements Boutique, vérifier le SHA applicatif, l'inventaire des 28 migrations, les files de revue et les versions actives ; réaliser et vérifier un backup/PITR couvrant Users, Products, ShopOrders, réservations, Payments, Invoices, CreditNotes, SAV et preuves privées, Shipping, audits, grilles tarifaires et versions juridiques ; puis exécuter uniquement `prisma migrate deploy` et valider schéma, health, compteurs et invariants.

En incident : fermer d'abord `SHOP_ENABLED`, `SHOP_PAYMENTS_ENABLED` et les providers de paiement ; conserver la consultation des commandes existantes et l'Admin ; réconcilier les paiements déjà engagés ; revenir à une version applicative compatible. Les tables et colonnes additives restent en place. N'utiliser jamais `prisma migrate reset`, aucun `DROP` improvisé et aucune down migration destructive. Une restauration DB contrôlée n'est envisagée qu'à partir d'un backup vérifié et d'une décision humaine.

La preuve locale Phase 5E part d'une instance Prisma Dev jetable vide, applique les 28 migrations, conserve les snapshots historiques couverts par PGlite, ferme la Boutique par flags lors du rollback applicatif et rejoue les invariants sur PostgreSQL loopback. Elle ne copie aucune donnée réelle.

## Gates humains restants

Avant toute ouverture : revue humaine de la grille DRAFT et de sa source, décision d'activation, revue juridique/comptable des textes candidats, backup/PITR Production vérifié, configuration Railway séparée du runner, audit des files de revue, QA visuelle globale, provider transport réel dans une phase dédiée et checklist de déploiement. `FAKE_LOCAL` ne crée ni étiquette ni preuve de livraison et ne contacte jamais La Poste/Colissimo.
