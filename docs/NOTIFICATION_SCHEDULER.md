# Scheduler des notifications transactionnelles

## Décision V0.7.9

Le scheduler retenu est un **Railway Cron Job séparé** qui exécute directement :

```text
npm run notifications:scheduler:run
```

La commande effectue un tick, réclame au maximum 25 notifications de l'environnement exact, puis ferme la connexion PostgreSQL et quitte. Elle ne lance ni serveur HTTP ni boucle permanente. Railway exécute ce service selon `*/5 * * * *` en UTC.

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

1. Créer un service Railway de type **Scheduled Job**, nommé par exemple `lnxbeats-notification-scheduler`.
2. Utiliser le même dépôt GitHub. En staging, sélectionner la branche de QA validée ; en production future, sélectionner uniquement la branche de release validée par l'opérateur.
3. Si le service permet encore la configuration-as-code déjà utilisée par ce projet, sélectionner le chemin absolu `/railway.scheduler.toml`. Sinon, définir dans le dashboard la commande `npm run notifications:scheduler:run`, la cadence UTC `*/5 * * * *` et la restart policy `NEVER`.
4. Vérifier dans le détail de déploiement que la commande et la cadence effectives correspondent exactement à ces valeurs.
5. Ne créer ni domaine public, ni healthcheck HTTP, ni pre-deploy de migration sur ce service.
6. Référencer le `DATABASE_URL` PostgreSQL du même environnement.
7. Ajouter uniquement les variables notification requises pour cet environnement, avec `NOTIFICATION_SCHEDULER_MODE=railway-cron`.
8. Conserver au premier démarrage `NOTIFICATION_WORKER_ENABLED=false` et les audiences désactivées.
9. Vérifier dans le détail du déploiement que la commande effective est bien celle du scheduler.

Le dépôt contient déjà `railway.toml` pour le service web avec `npm start` et `/api/health`. La configuration-as-code du dépôt prévaut sur le dashboard lorsqu'elle est associée à un service. Le service Cron ne doit donc jamais appliquer ce fichier web. Le fichier dédié [railway.scheduler.toml](../railway.scheduler.toml) ne contient ni serveur web ni healthcheck. Railway déprécie actuellement la configuration-as-code pour les nouveaux services ; si le sélecteur de fichier n'est pas disponible, utiliser les réglages dashboard du Scheduled Job et vérifier leur source/effectivité dans le détail du déploiement. Si `/railway.toml` apparaît, arrêter la configuration et ne pas armer le worker. Références :

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
3. Préparer une seule notification QA ciblée selon le harness déjà validé, en capture ou vers une destination Resend de test explicitement autorisée.
4. Armer seulement l'audience concernée, l'e-mail, le worker et la confirmation staging.
5. Exécuter `npm run notifications:scheduler:preflight` dans le conteneur et exiger tous les `PASS`, plus la vérification humaine du Cron.
6. Attendre une occurrence, vérifier `notification.scheduler.started` puis `notification.scheduler.completed`, une tentative et aucun doublon.
7. Attendre une seconde occurrence et confirmer l'absence de nouvel envoi de la même notification logique.
8. Remettre les flags à `false`, le transport à `disabled`, puis désactiver la cadence du Scheduled Job.

Aucun e-mail réel n'est envoyé pendant l'implémentation V0.7.9.

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
