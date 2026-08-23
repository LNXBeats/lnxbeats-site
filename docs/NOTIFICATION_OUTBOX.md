# Outbox de notifications

Chaque ligne contient le type métier, le canal, le destinataire, une clé de template/version, un snapshot JSON minimisé/versionné, la ressource, l'environnement, le statut, le nombre de tentatives, la disponibilité, la lease, les timestamps, le provider, son message ID et une erreur assainie. `idempotencyKey` est unique et lie type, canal, destinataire et ressource/version.

Le dispatcher valide le contrat entre kind, template, versions et payload. Le renderer V1 actuel est centralisé et testé ; toute future V2 devra conserver explicitement le renderer V1 tant que des lignes V1 restent rejouables. Une ligne dont l'environnement persisté ne correspond pas au runtime échoue fermée.

Le snapshot contient uniquement les champs nécessaires au rendu de ce kind. L'adresse complète du destinataire reste dans la colonne prévue à cet effet; les autres données personnelles, titres ou coordonnées contractuelles ne sont pas dupliqués lorsqu'ils ne sont pas rendus.

## Cycle

`PENDING` → `PROCESSING` → `SENT` → `DELIVERED`.

Une erreur temporaire devient `FAILED_RETRYABLE`, avec backoff 5 min, 30 min, 2 h, 6 h puis 24 h. Après cinq claims ou une erreur finale : `FAILED_FINAL`. Les retours provider peuvent produire `BOUNCED`, `COMPLAINED` ou `SUPPRESSED`. `CANCELED` est réservé à une invalidation explicite future.

Le claim est sérialisé par verrou transactionnel PostgreSQL et compare le statut/version avant de poser une lease de cinq minutes. Une lease expirée peut être reprise. Deux workers ne peuvent pas réclamer simultanément la même ligne. Le provider reçoit la clé d’idempotence persistante ; un crash local ne transforme jamais la ressource métier.

La capture est considérée livrée immédiatement. Resend est d’abord `SENT`, puis le webhook fait progresser l’état sans régression. Un delivery delayed n’ordonne pas un second envoi. Bounce/complaint/suppression activent une suppression persistante ; les prochaines lignes vers l’adresse sont bloquées.

La commande `notifications:dispatch` traite des lots bornés. La route interne est prévue pour un cron futur, mais aucun cron Railway n’est créé par le dépôt. `NOTIFICATION_WORKER_ENABLED=false` est la valeur sûre par défaut; le secret worker seul n'arme pas le dispatch.

Les messages Auth contenant un OTP ou un token borné suivent l'adaptateur Auth direct et ne sont jamais stockés dans `OrderNotification`.

## Rollback

Revenir au transport `capture` ou `disabled` ne modifie aucune ligne métier. Ne jamais supprimer l’historique d’outbox pour « réparer » un e-mail. Corriger la configuration, puis utiliser le retry Admin sur la même ligne si elle est éligible.

La procédure complète est dans [NOTIFICATION_RUNBOOK.md](NOTIFICATION_RUNBOOK.md).
