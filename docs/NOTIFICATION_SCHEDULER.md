# Scheduler des notifications transactionnelles

## Décision V0.7.9

Le scheduler retenu est un **Railway Cron Job séparé** qui exécute directement :

```text
npm run notifications:scheduler:run
```

La commande effectue un tick, réclame au maximum 25 notifications de l'environnement exact, puis ferme la connexion PostgreSQL et quitte. Elle ne lance ni serveur HTTP ni boucle permanente. La cadence Production envisagée est `*/15 * * * *` en UTC, mais elle reste absente tant que le service n'a pas passé son premier tick désarmé.

Cette architecture garde PostgreSQL comme source de vérité, consomme des ressources uniquement pendant le tick et réutilise sans duplication le dispatcher V0.7.8. La documentation Railway précise qu'un Cron démarre la commande du service, doit terminer sans ressource ouverte et saute une occurrence si l'exécution précédente est toujours active :

- <https://docs.railway.com/cron-jobs>
- <https://docs.railway.com/guides/cron-workers-queues>

## Alternatives écartées

- **Cron vers l'endpoint HTTP** : l'endpoint `POST /api/internal/notifications/dispatch` reste un outil interne protégé par Bearer, mais Railway Cron exécute une commande. Construire un second client HTTP et lui injecter une URL plus un Bearer ajouterait une surface réseau inutile.
- **Worker permanent** : fiable mais actif en continu alors que la cadence demandée est de cinq minutes ; son coût et son exploitation sont supérieurs sans bénéfice fonctionnel actuel.
- **Scheduler dans Next.js** : interdit. Un `setInterval`, un singleton ou une mémoire de replica ne survivent pas correctement aux redémarrages et se dupliquent avec le scaling horizontal.

## Tick, batch et codes de sortie

Un tick traite exactement un lot borné à 25. Il n'existe aucune boucle de drainage dans le processus. Un backlog supérieur converge au fil des occurrences suivantes sans monopoliser le conteneur.

- `0` : tick exécuté, ou worker volontairement désactivé. Des notifications individuelles peuvent avoir échoué selon leur politique sans faire échouer le Cron.
- non nul : configuration incohérente ou panne d'infrastructure ayant empêché le tick.

`NOTIFICATION_SCHEDULER_MODE` est `disabled` par défaut. Le mode automatique exige exactement `railway-cron`. Si `NOTIFICATION_WORKER_ENABLED=false`, aucun claim ni appel fournisseur n'est effectué et le tick quitte avec succès. Si le worker est armé alors que le scheduler, l'e-mail ou sa configuration sont invalides, la commande échoue avant tout claim.

Le process n'intercepte pas `SIGTERM`. Une interruption Railway termine donc le process ; toute ligne déjà `PROCESSING` conserve sa lease PostgreSQL et devient récupérable après son expiration. Chaque appel Resend reste borné par le timeout existant.

## Concurrence, retries et crash

La sélection respecte l'environnement, `availableAt`, le statut retryable, cinq tentatives maximum et la lease de cinq minutes. Le claim réutilise :

- le verrou advisory PostgreSQL par notification ;
- l'update optimiste de statut/version ;
- le second contrôle de `deploymentEnvironment` dans la transaction ;
- la même `idempotencyKey` persistante côté Resend.

Deux ticks ou plusieurs replicas peuvent donc sélectionner la même ligne sans l'envoyer deux fois. Un crash après claim laisse la lease expirer. Un crash après acceptation fournisseur reprend avec la même clé provider ; le webhook précoce et la réconciliation V0.7.8 restent inchangés. Le scheduler ne modifie jamais `availableAt` et n'accélère aucun backoff.

## Preflight read-only

```text
npm run notifications:scheduler:preflight
```

La commande vérifie sans envoi :

- environnement explicite `staging` ou `production` ;
- mode `railway-cron` ;
- worker, e-mail, transport, SMS désactivé et secret worker présent ;
- cohérence complète du parseur notifications ;
- connexion et tables/indexes outbox ;
- compteurs pending, retryable, leases expirées, revue et autres environnements.

La sortie `MANUAL scheduler.external.configured verification-required` est intentionnelle : le code ne peut pas prouver que le Cron existe dans Railway. Le preflight production général exige aussi le mode `railway-cron`, mais la présence, la cadence et l'historique du service restent un gate humain.

## Configuration Railway humaine

Ne jamais configurer cette section par script ou API sans une autorisation humaine distincte.

1. Avant tout nouveau déploiement, configurer explicitement `lnxbeats-site` dans le dashboard : Start Command `npm start`, Pre-deploy Command `npx prisma migrate deploy`, Healthcheck Path `/api/health`, Healthcheck Timeout `300`, restart policy `ON_FAILURE` et maximum `10`. Laisser son auto-deploy désactivé.
2. Créer ou reprendre le service Railway `lnxbeats-notifications` avec le même dépôt GitHub et la branche Production approuvée.
3. Définir explicitement dans ses réglages : Start Command `npm run notifications:scheduler:run`, aucun Pre-deploy Command, aucun Healthcheck Path, aucun domaine public et restart policy `NEVER`.
4. Ne définir initialement aucun Cron Schedule. Référencer `DATABASE_URL` vers PostgreSQL du même environnement et conserver tous les transports, audiences, worker et scheduler en mode désactivé.
5. Déployer une seule fois ce processus désarmé et exiger `outcome=disabled`, `claimed=0`, `delivered=0`, `failed=0`, `skipped=0`, puis une terminaison avec code `0`.
6. Vérifier dans le détail du déploiement que la commande provient bien des réglages du service et qu'aucun `npm start`, healthcheck ou pre-deploy n'est effectif.
7. Après une autorisation humaine distincte seulement, définir la cadence UTC `*/15 * * * *`, puis armer le scheduler et les notifications selon le preflight Production complet.

Le fichier racine [railway.toml](../railway.toml) ne contient plus que le builder commun. Aucun `startCommand`, healthcheck, pre-deploy ou restart policy global ne peut donc imposer le profil web au Cron. Le fichier [railway.scheduler.toml](../railway.scheduler.toml) reste une référence legacy vérifiable pour les services qui l'utilisaient déjà ; il n'est pas la procédure retenue pour le nouveau service. Railway déprécie la configuration-as-code et interdit aux nouveaux services de l'adopter ; la migration vers `.railway/railway.ts` est volontairement reportée à un sprint d'infrastructure séparé. Pour cette correction ciblée, les réglages par service du dashboard sont l'option officiellement documentée et la moins risquée. Références :

- <https://docs.railway.com/config-as-code>
- <https://docs.railway.com/deployments/monorepo>

Variables non secrètes minimales du service Cron :

```text
NOTIFICATION_DEPLOYMENT_ENV=staging|production
NOTIFICATION_SCHEDULER_MODE=railway-cron
NOTIFICATION_WORKER_ENABLED=false
NOTIFICATION_EMAIL_TRANSPORT=disabled
EMAIL_NOTIFICATIONS_ENABLED=false
OWNER_EMAIL_NOTIFICATIONS_ENABLED=false
CLIENT_EMAIL_NOTIFICATIONS_ENABLED=false
SMS_TRANSPORT=disabled
SMS_NOTIFICATIONS_ENABLED=false
```

Variables/secrets à référencer au moment de la QA ou de l'activation approuvée : `DATABASE_URL`, `NOTIFICATION_WORKER_SECRET`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `EMAIL_OWNER_RECIPIENT`, `APP_CANONICAL_URL` et la confirmation d'environnement applicable. Aucune valeur n'est stockée dans Git.

Le secret worker reste exigé par le parseur partagé, même si le Cron direct ne l'envoie pas sur le réseau. L'endpoint HTTP conserve sa comparaison timing-safe pour les usages manuels autorisés.

## QA staging sûre

1. Garder le staging actuel désarmé pendant la création du service.
2. Vérifier un tick `outcome=disabled`, `claimed=0` sans provider.
3. Créer une seule fois le scénario `scheduler-delivered` du harness Resend. Il utilise exclusivement `delivered+lnx-v079-scheduler-01@resend.dev`, l'Order synthétique annulée `LNX-QA-SCHEDULER-DELIVERED-01` et la clé `qa:scheduler:v079:delivered:01`.
4. Armer seulement l'audience concernée, l'e-mail, le worker et la confirmation staging.
5. Exécuter `npm run notifications:scheduler:preflight` dans le conteneur et exiger tous les `PASS`, plus la vérification humaine du Cron.
6. Attendre une occurrence, vérifier `notification.scheduler.started` puis `notification.scheduler.completed`, une tentative et aucun doublon.
7. Attendre une seconde occurrence et confirmer l'absence de nouvel envoi de la même notification logique.
8. Remettre les flags à `false`, le transport à `disabled`, puis désactiver la cadence du Scheduled Job.

La création du scénario ne déclenche ni transport, ni dispatcher, ni fournisseur. Sa notification `OWNER_NEW_ORDER` est volontairement éligible au dispatcher global, contrairement au smoke historique `qa:owner-smoke:v0732:01`. Le premier appel crée une ligne `PENDING`; tout rappel retourne la même ligne sans modifier son statut, ses tentatives ou sa disponibilité. La preuve doit obligatoirement provenir d'un Cron Railway automatique, jamais de la route de dispatch manuel.

### Preuve humaine staging du 23 août 2026

Le Scheduled Job staging séparé a été validé humainement avec `/railway.scheduler.toml`, la commande `npm run notifications:scheduler:run` et le Cron UTC `*/5 * * * *`. Avant armement, plusieurs ticks automatiques ont terminé `outcome=disabled`, `claimed=0` et sans appel fournisseur.

Le preflight armé uniquement pour son processus a validé le mode, l'environnement, le worker, le transport, le secret, le SMS désactivé, la configuration, les tables et les indexes. L'inventaire avant création indiquait `pending=0`, `retryable=0`, `expiredLeases=0` et `foreignEnvironment=0`; les 24 événements `requiresReview` provenaient des QA historiques et ne constituaient pas un backlog claimable.

La fixture one-shot `qa:scheduler:v079:delivered:01` a ensuite été créée une fois avec le statut `PENDING`. Le premier Cron armé a traité exactement une ligne (`claimed=1`, `delivered=1`, `failed=0`, `skipped=0`, `durationMs=404`). Le Cron suivant a confirmé l'idempotence avec `claimed=0`. Le webhook Resend a finalement porté la notification à `DELIVERED`, avec `attempts=1`, un identifiant fournisseur présent et les événements `email.sent` puis `email.delivered`. Aucune suppression, aucun échec et aucun doublon n'ont été observés.

Le Safe Reset humain final a remis le worker, le transport et toutes les audiences à l'état désactivé : `NOTIFICATION_EMAIL_TRANSPORT=disabled`, `NOTIFICATION_WORKER_ENABLED=false`, les trois flags e-mail à `false`, `EMAIL_PROVIDER=capture`, ainsi que le transport et le flag SMS désactivés. Les confirmations staging temporaires et `EMAIL_OWNER_RECIPIENT` ont été retirées du service web ; `PAYMENTS_ENABLED` a été restauré à `true`. Plusieurs ticks postérieurs ont de nouveau terminé `outcome=disabled` et `claimed=0`. L'état final observé contenait `pending=0`, `retryable=0`, `expiredLeases=0`, `foreignEnvironment=0`, aucune destination propriétaire configurée et aucune suppression issue de cette fixture. Cette preuve ferme le gate technique staging du scheduler, pas les gates de production.

## Observabilité et détection d'un worker stale

Chaque tick journalise un JSON assaini :

- `notification.scheduler.started` avec environnement et limite ;
- `notification.scheduler.completed` avec outcome, claimed, delivered, failed, skipped et durée ;
- `notification.scheduler.failed` avec environnement, étape générique et durée.

Aucun destinataire, payload, body, secret ou clé provider n'est journalisé.

Une table heartbeat n'est pas ajoutée : elle dupliquerait l'historique d'exécution Railway sans améliorer la source de vérité métier. La détection opérationnelle repose sur :

- historique Scheduled Job et présence d'un `completed` réussi dans les 15 dernières minutes (trois cadences) ;
- `npm run notifications:check` pour pending, retryable, échecs finaux, leases expirées et `requiresReview` ;
- Admin Notifications pour la tendance du backlog et les erreurs assainies.

Alertes manuelles recommandées, sans nouveau service externe : absence de tick réussi > 15 min, hausse continue du pending sur trois ticks, retryable en hausse, lease expirée, `requiresReview`, ou série de `PROVIDER_TEMPORARY`. Une panne provider ne doit jamais modifier Payment, Order ou Delivery.

## Runbook scheduler

- **Scheduler absent/arrêté** : garder l'outbox, vérifier le service et la cadence, laisser le worker désarmé jusqu'au preflight, puis reprendre une occurrence. Aucun rejeu métier.
- **Scheduler double** : PostgreSQL protège l'envoi ; désactiver le service en trop et vérifier les événements `DISPATCH_CLAIMED` sans remettre les lignes à `PENDING`.
- **Backlog élevé** : conserver un batch de 25, vérifier provider/backoff/suppressions et laisser converger. Ne pas ajouter de boucle illimitée.
- **Provider down** : mettre le worker à `false`, conserver les retryables et reprendre après preflight ; `availableAt` reste souverain.
- **Leases expirées** : vérifier qu'aucun ancien process n'est vivant, puis laisser le tick normal les réclamer avec la même clé idempotente.
- **Mauvais environnement** : le parseur ou le second contrôle du claim bloque. Corriger la variable du service ; ne migrer aucune ligne entre environnements.
- **Worker désactivé** : outcome `disabled` attendu. N'activer qu'après preflight et autorisation humaine.
- **Secret incorrect/absent** : configuration non valide, exit non nul, aucun claim. Corriger uniquement dans le coffre.

## Rollback scheduler

1. Mettre `NOTIFICATION_WORKER_ENABLED=false`.
2. Désactiver les audiences puis `EMAIL_NOTIFICATIONS_ENABLED`.
3. Remettre `NOTIFICATION_EMAIL_TRANSPORT=disabled`.
4. Désactiver la cadence du Scheduled Job.
5. Conserver outbox, événements, suppressions et logs.
6. Vérifier qu'un tick éventuel termine `disabled` et qu'aucune tentative n'augmente.

Ne jamais supprimer les notifications ou modifier une commande pour compenser un incident scheduler.

## Ordre futur d'activation production

1. Déployer le code production validé.
2. Appliquer les migrations validées via le service web.
3. Démarrer avec notifications, audiences et worker désactivés.
4. Configurer humainement domaine, expéditeur et webhook Resend production.
5. Créer le Scheduled Job sans armer le worker et vérifier sa commande/cadence.
6. Configurer les secrets dans le coffre et exécuter les deux preflights.
7. Activer le worker, audience propriétaire uniquement.
8. Exécuter l'unique smoke test propriétaire autorisé.
9. Vérifier tick, provider, webhook, absence de doublon et rollback.
10. Activer les clients uniquement après décision humaine distincte.

Cette préparation ferme le gate technique du scheduler, pas les gates de configuration Railway production, Resend production, paiements Live, revue juridique, QA production ou go-live.
