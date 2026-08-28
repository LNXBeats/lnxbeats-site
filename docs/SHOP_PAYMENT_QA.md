# QA paiements Boutique — Phase 3A locale et offline

> Cette matrice interdit tout appel Stripe, PayPal, Resend, Railway, R2 ou base
> persistante. Les credentials réels ne sont ni requis ni autorisés.

## Profil de validation

La Phase 3A utilise uniquement :

- gateways Stripe/PayPal fake ou mock ;
- transport notification capture/disabled ;
- horloges et identifiants provider synthétiques ;
- PGlite pour les contraintes de migration ;
- PostgreSQL jetable local lorsqu'un runtime transactionnel réel est requis.

Les gates sûrs par défaut restent :

```text
SHOP_ENABLED=false
SHOP_PAYMENTS_ENABLED=false
SHOP_LEGAL_READY=false
EMAIL_NOTIFICATIONS_ENABLED=false
SMS_NOTIFICATIONS_ENABLED=false
```

La version juridique QA ne peut être armée que sur loopback HTTP, hors
Production, avec sa confirmation non secrète exacte documentée dans
[SHOP_LEGAL_TECHNICAL_GATES.md](SHOP_LEGAL_TECHNICAL_GATES.md).

## Matrice Checkout mockée

Pour Stripe et PayPal, les tests doivent couvrir :

- membre actif et vérifié propriétaire de la `ShopOrder` ;
- refus ADMIN, compte non vérifié, origine ou payload invalide ;
- acceptation explicite absente/refusée ;
- snapshot légal immuable ;
- montant, lignes, expédition et devise relus côté serveur ;
- réservation valide puis réservation expirée ;
- réutilisation de la même tentative active et de la même clé d'idempotence ;
- une tentative distincte par provider sans double gagnant ;
- URL de retour canonique interne, sans redirect externe.

Les gateways doivent prouver la forme des appels sans établir de connexion
réseau.

## Matrice de reconciliation

Les preuves synthétiques doivent couvrir :

- `PENDING` : aucune vente ni décrémentation ;
- réussite valide : une commande `PAID`, un gagnant, stock confirmé une fois ;
- replay identique : aucune seconde mutation ;
- échec/expiration : aucun gagnant, aucune notification de paiement confirmé ;
- montant, devise, mode, parent ou identifiant incohérent : revue ;
- capture après échéance : preuve conservée, commande en revue, stock non
  confirmé ;
- réussite concurrente Stripe/PayPal : un gagnant, l'autre en revue ;
- rollback forcé : aucune mutation partielle ;
- notification idempotente et audience désactivée sans appel provider.

## Matrice stock et fulfillment

Sur PostgreSQL jetable, vérifier :

- décrémentation et `ProductStockAdjustment` exactement une fois ;
- réservation `ACTIVE → CONFIRMED` et `STOCK_CONFIRMED` exactement une fois ;
- concurrence sur la dernière unité ;
- aucune confirmation après expiration ;
- préparation refusée sans paiement ou avec revue active ;
- `PENDING → PREPARING → SHIPPED` avec événements idempotents ;
- suivi facultatif, URL uniquement HTTPS ;
- notifications préparation/expédition soumises aux flags.

## Commandes de validation

Utiliser les scripts réellement présents :

```sh
npm run test:shop
npm run test:payment
npm run test:checkout
npm run test:notification
npm run prisma:validate
npm run typecheck
npm run build
git diff --check
```

`tests/shop/migration.test.ts` applique les migrations à PGlite et vérifie
notamment XOR, tentative gagnante, snapshot juridique, revue, fulfillment et
ledger lifecycle. Tout runtime PostgreSQL complémentaire doit créer puis
détruire sa propre base locale jetable ; il ne doit jamais réutiliser staging
ou Production.

## QA sandbox future — non exécutée

Une QA Stripe Test ou PayPal Sandbox réelle est hors Phase 3A. Elle exigera une
autorisation humaine séparée, une base/environnement dédiés, des webhooks de
test, tous les gates explicitement armés, des destinataires de capture et un
cleanup vérifié. Elle ne doit pas commencer à partir de ce document seul.

Voir [paiements Boutique](SHOP_PAYMENTS.md) et
[fondation Boutique](SHOP_FOUNDATION.md).
