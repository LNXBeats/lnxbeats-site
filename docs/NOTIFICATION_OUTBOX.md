# Outbox de notifications

Chaque ligne contient le type métier, le canal, le destinataire, une clé de template/version, un snapshot JSON minimisé/versionné, la ressource, le statut, le nombre de tentatives, la disponibilité, la lease, les timestamps, le provider, son message ID et une erreur assainie. `idempotencyKey` est unique et lie type, canal, destinataire et ressource/version.

## Cycle

`PENDING` → `PROCESSING` → `SENT` → `DELIVERED`.

Une erreur temporaire devient `FAILED_RETRYABLE`, avec backoff 5 min, 30 min, 2 h, 6 h puis 24 h. Après cinq claims ou une erreur finale : `FAILED_FINAL`. Les retours provider peuvent produire `BOUNCED`, `COMPLAINED` ou `SUPPRESSED`. `CANCELED` est réservé à une invalidation explicite future.

Le claim est sérialisé par verrou transactionnel PostgreSQL et compare le statut/version avant de poser une lease de cinq minutes. Une lease expirée peut être reprise. Deux workers ne peuvent pas réclamer simultanément la même ligne. Le provider reçoit la clé d’idempotence persistante ; un crash local ne transforme jamais la ressource métier.

La capture est considérée livrée immédiatement. Resend est d’abord `SENT`, puis le webhook fait progresser l’état sans régression. Un delivery delayed n’ordonne pas un second envoi. Bounce/complaint/suppression activent une suppression persistante ; les prochaines lignes vers l’adresse sont bloquées.

La commande `notifications:dispatch` traite des lots bornés. La route interne est prévue pour un cron futur, mais aucun cron Railway n’est créé en V0.7.3.

## Rollback

Revenir au transport `capture` ou `disabled` ne modifie aucune ligne métier. Ne jamais supprimer l’historique d’outbox pour « réparer » un e-mail. Corriger la configuration, puis utiliser le retry Admin sur la même ligne si elle est éligible.
