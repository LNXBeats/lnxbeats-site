# Webhooks Resend

Endpoint : `POST /api/notifications/resend/webhook`, runtime Node, dynamique, `no-store`.

L'endpoint exige un `RESEND_WEBHOOK_SECRET` valide mais reste volontairement disponible lorsque le transport sortant est repassé à `disabled`. Ce comportement permet de recevoir les statuts tardifs des messages déjà acceptés pendant un rollback, sans autoriser un nouvel envoi. Le Dashboard et son secret restent configurés par un humain ; le code ne crée ni endpoint distant ni secret.

Le handler lit au plus 256 Kio du corps brut, exige `svix-id`, `svix-timestamp` et `svix-signature`, puis appelle la vérification officielle `resend.webhooks.verify`. Une signature ou un payload invalide répond 400 ; un body trop grand 413 ; une panne PostgreSQL après vérification répond 500 afin que Resend retente.

Événements allowlistés : `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`, `email.suppressed`, `suppression.added`, `suppression.removed`. Les autres événements signés sont audités comme ignorés.

`svix-id` est unique dans `notification_events`. Resend garantit une livraison au moins une fois et ne garantit pas l’ordre ; la déduplication et les transitions monotones sont donc persistantes. `data.email_id` doit correspondre à `providerMessageId` et le destinataire doit correspondre à l’outbox. Une incohérence produit `REQUIRES_REVIEW`, sans nouvel envoi.

Hard bounce, complaint et suppression créent ou réactivent une suppression d’adresse. Une suppression retirée via l’événement officiel devient inactive ; le compte utilisateur n’est jamais désactivé automatiquement.

Un événement provenant d'une ligne d'un autre environnement, d'un message inconnu ou d'un destinataire incohérent est placé en revue et ne provoque jamais un nouvel envoi.

Les OTP et tokens Auth ne sont pas persistés dans l'outbox. Leur traitement ne doit jamais conduire à enregistrer un token dans `notification_events` ou les logs.

Références officielles : https://resend.com/docs/webhooks/verify-webhooks-requests, https://resend.com/docs/webhooks/event-types et https://resend.com/docs/webhooks/introduction.

Les procédures de panne, replay, bounce et complaint sont décrites dans [NOTIFICATION_RUNBOOK.md](NOTIFICATION_RUNBOOK.md).
