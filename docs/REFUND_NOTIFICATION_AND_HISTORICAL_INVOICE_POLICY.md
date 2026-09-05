# Notifications client et factures historiques — préparation V1.1.0

## Activation du canal client

Le Web Production peut créer une notification client lorsque `CLIENT_EMAIL_NOTIFICATIONS_ENABLED=true`. Le worker global sélectionne toutes les notifications Production éligibles (`PENDING`, `FAILED_RETRYABLE` ou lease `PROCESSING` expirée), sans filtre d’âge ni de type. Activer le même flag sur le worker peut donc envoyer un backlog historique s’il existe au moment de l’activation.

Politique humaine approuvée : **option B + E**.

Procédure verrouillée :

1. exécuter `npm run notifications:client-activation:dry-run` dans un contexte Production strictement read-only ;
2. exiger `activationReady=true`, `dangerousBacklog=0`, `historicalClaimable=0`, `retryableNow=0` et `expiredLeases=0` immédiatement avant la mutation ;
3. vérifier suppressions, configuration Resend, webhook et templates ;
4. activer seulement `CLIENT_EMAIL_NOTIFICATIONS_ENABLED=true` sur le worker dans un checkpoint Production séparé, sans modifier le Web ni aucune autre variable ;
5. observer son premier tick naturel, sans `Run Now` et sans créer de message artificiel ;
6. vérifier les statuts, les logs et l’absence d’envoi historique ou obsolète ;
7. revenir immédiatement à `false` et examiner l’outbox si une anomalie ou un envoi inattendu apparaît.

Une notification historique claimable n’est jamais classée automatiquement sûre ou obsolète. Elle nécessite une revue humaine, car l’âge et le type ne prouvent pas l’état métier actuel. Les statuts terminaux ne sont pas rejouables. Un message créé après le cutoff d’activation appartient uniquement au flux futur.

Un remboursement confirmé reste financièrement confirmé même si son e-mail échoue. Le transport ne doit jamais retenter le remboursement, altérer `Payment`, perdre l’identifiant provider ou masquer le succès à l’Admin.

## Factures historiques

Le dry-run `npm run billing:historical-invoices:dry-run` est limité à `LNX-2026-000003`, `LNX-2026-000007` et `LNX-2026-000011`.

Il n’implémente aucun mode APPLY. Sa connexion et sa transaction imposent la lecture seule. Il vérifie la facture absente, le paiement `LIVE/SUCCEEDED`, la preuve provider, le montant, l’EUR, l’identité client minimale, les snapshots contractuels et les lignes. Il lit `invoice_sequence` sans appeler `nextval` ou `setval`, ne réserve aucun numéro et ne crée aucun audit.

Politique humaine approuvée : **option C**.

Les trois factures utiliseront la date réelle d’émission/régularisation en Europe/Paris. Elles ne seront pas antidatées. La date historique du paiement/prestation (`paidAt`) sera conservée explicitement dans le snapshot, l’audit ou les métadonnées de référence. La numérotation globale courante ne sera utilisée qu’au moment d’une future émission autorisée.

Le dry-run doit valider les trois commandes de la whitelist avant toute allocation. Il n’appelle jamais `nextval` ou `setval`.

Le futur APPLY, s’il est autorisé, devra être un outil séparé : confirmation Production exacte, whitelist identique, verrou transactionnel par Payment, idempotence par `paymentId`, émission immuable, audit, arrêt au premier écart et aucune activation automatique des remboursements Live.

## Ordre des checkpoints

1. exécuter le checkpoint d’activation client approuvé et observer le worker séparément ;
2. obtenir une autorisation distincte avant de concevoir ou exécuter un APPLY de factures historiques ;
3. implémenter, revoir et appliquer le backfill séparément selon l’option C approuvée ;
4. revalider le preflight Refund ;
5. seulement ensuite envisager le réarmement Live Refunds.
