# Runbook paiements production

Ce runbook prépare les actions humaines futures. Il n’autorise pas leur exécution pendant V0.8.0.

## Préconditions communes

1. backup PostgreSQL vérifié et migrations `prisma migrate deploy` à jour ;
2. `/api/health` 200 avec paiements désactivés ;
3. `npm run payments:preflight` = `SAFE_DISABLED` ;
4. origine canonique HTTPS et variables Auth/Site cohérentes ;
5. endpoints Live distincts créés dans chaque dashboard avec les allowlists de [PRODUCTION_PAYMENTS.md](PRODUCTION_PAYMENTS.md) ;
6. secrets placés uniquement dans le coffre Railway, jamais dans un ticket, terminal partagé ou chat ;
7. notifications et monitoring opérateur validés indépendamment ;
8. personne responsable, fenêtre, critères d’arrêt et retour arrière nommés.

## Activation progressive

### Stripe seul

Laisser PayPal désactivé. Valider les credentials et le secret du webhook Live, puis définir le mode Live et l’environnement production. Ajouter la confirmation production seulement dans la fenêtre d’activation, activer le flag Stripe, puis le global. Exécuter le preflight : seul `READY_FOR_STRIPE_LIVE_QA` est acceptable. Vérifier le healthcheck avant d’autoriser le smoke propriétaire/internal approuvé.

### PayPal seul

Remettre le global à `false` avant de changer de provider. Laisser Stripe désactivé. Valider client, secret et webhook ID Live, puis activer PayPal et le global. Le preflight attendu est `READY_FOR_PAYPAL_LIVE_QA`.

### Double provider

N’activer les deux qu’après les deux preuves isolées. Le preflight attendu est `READY_FOR_DUAL_LIVE_QA`. Tester en environnement non Live la course Stripe/PayPal : un seul Payment devient gagnant et l’autre est annulé/revu sans second succès logique.

## Smoke Live futur

Le smoke n’est pas automatisé. Utiliser un compte propriétaire/internal explicitement autorisé, une Order dédiée et le montant métier minimal valide. Stripe Checkout doit rester hébergé. PayPal exige un acheteur réel distinct du marchand. Ne jamais créer un litige réel. Ne rembourser que si la décision comptable/juridique l’autorise, avec la confirmation Admin Live.

Vérifier après le retour navigateur : `Payment.mode=LIVE`, provider correct, montant EUR exact, `ProviderEvent.livemode=true`, `Payment=SUCCEEDED`, `Order=PAYMENT_CONFIRMED`, un seul événement de confirmation et aucune seconde réussite. Le retour navigateur seul n’est jamais une preuve.

## Incidents et réponses

1. **Stripe Live indisponible** : désactiver `STRIPE_PAYMENTS_ENABLED`; laisser PayPal seulement si son preflight est vert. Ne modifier aucun Payment existant.
2. **PayPal Live indisponible** : désactiver `PAYPAL_PAYMENTS_ENABLED`; laisser Stripe seulement si son preflight est vert.
3. **Deux providers indisponibles** : `PAYMENTS_ENABLED=false`; Commander/Compte restent disponibles hors Checkout.
4. **Webhook Stripe en panne** : ne pas confirmer manuellement. Vérifier endpoint, signature, mode et ProviderEvent ; redélivrer l’événement existant depuis Stripe après correction.
5. **Webhook PayPal en panne** : ne pas recapturer. Vérifier postback, certificat, webhook ID et mode ; rejouer l’événement existant si le provider le permet.
6. **Provider payé, LNX non confirmé** : couper les nouveaux Checkout si nécessaire, rapprocher IDs/montant/devise/mode, corriger la cause puis rejouer le webhook. Ne pas demander un second paiement.
7. **`Payment=REQUIRES_REVIEW`** : geler toute action financière supplémentaire et examiner le mismatch allowlisté ; ne jamais forcer `SUCCEEDED`.
8. **Remboursement bloqué** : ne pas créer une seconde tentative. Réconcilier la tentative idempotente existante et son identifiant provider.
9. **Provider remboursé, DB incertaine** : conserver l’Order, marquer la revue via le flux existant et rapprocher le webhook/refund exact ; aucune compensation automatique supplémentaire.
10. **Dispute** : laisser l’Order inchangée, ouvrir la revue opérateur et traiter dans le dashboard/provider selon la procédure juridique.
11. **Reversal** : conserver l’invariant gagnant ; aucun nouveau Checkout sur l’Order.
12. **Collision double provider** : identifier le premier succès transactionnel ; le second va en revue/annulation, jamais en nouveau paiement.
13. **Mauvais Test/Live** : kill switch global immédiat, ne changer aucune ligne DB, corriger les variables et les endpoints avant replay.
14. **Kill switch global** : `PAYMENTS_ENABLED=false`; conserver les flags providers et secrets si utile au diagnostic, mais aucun Checkout ne doit rester accessible.
15. **Rollback production** : global false, déploiement du commit précédemment validé si nécessaire, healthcheck, preflight `SAFE_DISABLED`, inventaire des tentatives ouvertes et surveillance des webhooks déjà émis.

## Webhook replay et ordering

Toujours rejouer l’identifiant d’événement existant. La contrainte provider/event rend le replay idempotent. Les transitions sont monotones : un succès ne régresse pas sur un événement tardif. Un webhook du mauvais mode est rejeté avant mutation ; ne jamais changer `Payment.mode` pour le faire correspondre.

## Monitoring minimal

Surveiller les statuts `REQUIRES_REVIEW`, ProviderEvents non traités/revus, remboursements actifs trop anciens, incidents ouverts, doubles gagnants (doit rester zéro), erreurs de signature, erreurs 5xx des webhooks et échecs de notification. Les logs restent structurés et sans payload provider, secret, signature ou données carte.

## Arrêt et retour fail-closed

L’action immédiate et réversible est `PAYMENTS_ENABLED=false`. Ensuite seulement diagnostiquer. Ne jamais supprimer un Payment, ProviderEvent, RefundAttempt, PaymentIncident ou audit pour « nettoyer » un incident financier.
