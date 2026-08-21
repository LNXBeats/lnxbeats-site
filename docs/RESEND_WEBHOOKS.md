# Webhooks Resend

Endpoint : `POST /api/notifications/resend/webhook`, runtime Node, dynamique, `no-store`.

Le handler lit au plus 256 Kio du corps brut, exige `svix-id`, `svix-timestamp` et `svix-signature`, puis appelle la vérification officielle `resend.webhooks.verify`. Une signature ou un payload invalide répond 400 ; un body trop grand 413 ; une panne PostgreSQL après vérification répond 500 afin que Resend retente.

Événements allowlistés : `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`, `email.suppressed`, `suppression.added`, `suppression.removed`. Les autres événements signés sont audités comme ignorés.

`svix-id` est unique dans `notification_events`. Resend garantit une livraison au moins une fois et ne garantit pas l’ordre ; la déduplication et les transitions monotones sont donc persistantes. `data.email_id` doit correspondre à `providerMessageId` et le destinataire doit correspondre à l’outbox. Une incohérence produit `REQUIRES_REVIEW`, sans nouvel envoi.

Hard bounce, complaint et suppression créent ou réactivent une suppression d’adresse. Une suppression retirée via l’événement officiel devient inactive ; le compte utilisateur n’est jamais désactivé automatiquement.

Références officielles : https://resend.com/docs/webhooks/verify-webhooks-requests, https://resend.com/docs/webhooks/event-types et https://resend.com/docs/webhooks/introduction.
