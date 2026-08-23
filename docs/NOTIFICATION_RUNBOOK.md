# Runbook opérateur — notifications transactionnelles

## Principes d'intervention

- PostgreSQL reste la source de vérité métier.
- Commencer par contenir l'envoi, puis diagnostiquer en lecture seule.
- Ne jamais supprimer l'outbox ou une suppression pour faire disparaître une alerte.
- Ne jamais rejouer un paiement, republier une livraison ou recréer une commande pour provoquer un e-mail.
- Ne jamais afficher une clé, un secret webhook, un bearer worker, un cookie, un token Auth ou un payload provider brut.
- Une action sur Railway, Resend ou DNS exige une validation humaine distincte.

Avant toute reprise, exécuter le preflight sans envoi :

```text
npm run notifications:preflight
```

Le diagnostic courant, également read-only, reste :

```text
npm run notifications:check
```

Le scheduler automatique possède un preflight séparé :

```text
npm run notifications:scheduler:preflight
```

Le runbook complet — absence de tick, overlap, backlog, leases, mauvaise configuration et rollback — est dans [NOTIFICATION_SCHEDULER.md](NOTIFICATION_SCHEDULER.md). Un tick sain toutes les cinq minutes doit produire un événement `notification.scheduler.completed`; l'absence de succès pendant 15 minutes exige une intervention.

La QA staging humaine du 23 août 2026 a validé un seul traitement de la fixture scheduler (`claimed=1`, `attempts=1`, webhook `DELIVERED`), puis un Cron anti-doublon à `claimed=0`. Le Safe Reset a été vérifié sur plusieurs ticks `disabled`, avec `pending=0`, `retryable=0`, aucune lease expirée et aucun environnement étranger. Cette preuve ne remplace pas le preflight ni le smoke test explicitement autorisé d'un futur environnement production.

## 1. Provider indisponible

**Signaux** : timeouts, 429/5xx, notifications `FAILED_RETRYABLE`, augmentation du backlog.

**Contenir** : conserver les états métier; si le volume augmente, mettre `NOTIFICATION_WORKER_ENABLED=false` sans supprimer les lignes.

**Diagnostiquer** : vérifier le statut fournisseur par le canal humain approuvé, les erreurs assainies, les tentatives et `availableAt`. Ne pas tester avec une adresse client réelle.

**Reprendre** : attendre le rétablissement, exécuter le preflight, réactiver un seul worker, puis laisser le backoff existant reprendre les lignes. Utiliser le retry Admin uniquement sur une ligne éligible.

## 2. Clé API invalide

**Signaux** : erreur finale de configuration, aucun `providerMessageId`, preflight `BLOCKED`.

**Contenir** : désactiver le worker et les audiences; ne pas transformer l'erreur en retry infini.

**Diagnostiquer** : contrôler uniquement la présence et la portée de la clé dans le coffre. Ne jamais l'imprimer ni la comparer dans les logs.

**Reprendre** : faire tourner ou corriger la clé dans Resend et le coffre par une action humaine, redéployer, puis exécuter le preflight avant tout retry ciblé.

## 3. Destinataire propriétaire absent

**Signaux** : `FAILED_FINAL`, code `RECIPIENT_MISSING`, zéro appel transport.

**Contenir** : aucune action métier; la commande, le paiement, le remboursement ou l'incident restent valides.

**Diagnostiquer** : vérifier seulement que `EMAIL_OWNER_RECIPIENT` est présent et conforme, sans afficher sa valeur.

**Reprendre** : corriger la variable côté environnement puis exécuter le preflight pour protéger les prochains événements. La ligne `RECIPIENT_MISSING` reste volontairement `FAILED_FINAL` et n'est pas éligible au retry Admin ; l'événement manqué reste visible dans l'Admin et n'est pas renvoyé automatiquement. Ne jamais créer une nouvelle notification logique ni hardcoder une adresse pour contourner cet état.

## 4. Hard bounce

**Signaux** : statut `BOUNCED`, suppression active `HARD_BOUNCE`, futurs envois bloqués.

**Contenir** : ne pas retenter vers la même adresse et ne pas désactiver automatiquement le compte.

**Diagnostiquer** : vérifier la signature et l'idempotence de l'événement, la corrélation `providerMessageId`, le destinataire masqué et la source de suppression.

**Reprendre** : faire corriger l'adresse par un parcours authentifié ou une procédure opérateur vérifiée. Une levée de suppression doit être explicite, auditée et cohérente avec l'état fournisseur.

## 5. Complaint

**Signaux** : statut `COMPLAINED`, suppression active `COMPLAINT`.

**Contenir** : stopper les nouveaux envois vers l'adresse. Ne pas contourner la suppression au motif qu'un message est transactionnel.

**Diagnostiquer** : contrôler l'événement signé et la corrélation locale; ne pas afficher le contenu privé du message.

**Reprendre** : uniquement après une décision opérateur documentée et, si nécessaire, une correction de l'adresse. Une complaint ne doit jamais être levée automatiquement par un retry.

## 6. Tempête de retries

**Signaux** : hausse rapide des claims, 429 répétés, plusieurs workers actifs, backlog qui ne décroît pas.

**Contenir** : mettre `NOTIFICATION_WORKER_ENABLED=false`. Conserver le transport et l'outbox intacts pour analyse.

**Diagnostiquer** : vérifier la cadence du cron, les déploiements concurrents, le batch, le nombre maximal d'essais, le backoff et les leases expirées. Rechercher une erreur de configuration commune avant de rejouer une ligne.

**Reprendre** : corriger la cause, lancer un seul worker avec un lot borné, surveiller puis augmenter progressivement. Ne jamais remettre toutes les lignes à `PENDING` par SQL manuel.

Une décision opérateur de blocage utilise l'action Admin sur une notification existante, jamais un e-mail saisi librement. Elle exige la confirmation affichée, crée une suppression `MANUAL`, bloque les lignes encore en attente vers cette destination et conserve un événement d'audit avec l'ADMIN acteur.

## 7. Webhook en échec

**Signaux** : réponses 400/500, notifications bloquées `SENT`, événements provider absents ou `REQUIRES_REVIEW`.

**Contenir** : ne pas renvoyer les e-mails; le fournisseur a peut-être déjà accepté ou livré le message.

**Diagnostiquer** : distinguer signature invalide, body trop grand, secret incorrect, erreur PostgreSQL, event non allowlisté, destinataire incohérent ou message inconnu. Ne jamais accepter un événement sur son seul `providerMessageId`.

**Reprendre** : corriger le secret ou le handler par la procédure humaine, laisser Resend redélivrer le même événement signé, puis vérifier la déduplication par `svix-id`. Aucun nouveau message logique.

## 8. Notification bloquée en PROCESSING

**Signaux** : `PROCESSING` au-delà de la lease, `processingStartedAt` ancien, aucun état terminal.

**Contenir** : vérifier qu'aucun worker n'est encore actif avant toute reprise.

**Diagnostiquer** : inspecter la lease, le dernier event `DISPATCH_CLAIMED`, les logs structurés et l'état du provider. Un crash après acceptation provider doit être traité avec prudence à cause de la fenêtre d'idempotence fournisseur.

**Reprendre** : laisser le claim normal récupérer la lease expirée avec la même clé d'idempotence. Si l'état provider est ambigu, exiger une réconciliation opérateur avant retry manuel.

## 9. E-mails client désactivés

**Signaux** : `CLIENT_EMAIL_NOTIFICATIONS_ENABLED=false` ou échec final `CLIENT_EMAIL_DISABLED`.

**Effet attendu** : Payment, Order, Delivery, Refund et Rights continuent normalement. Aucun appel provider client.

**Reprendre** : seulement après validation humaine, remettre le flag client, exécuter le preflight et rejouer individuellement les notifications toujours pertinentes et éligibles. Ne pas recréer les événements métier.

## 10. E-mails propriétaire désactivés

**Signaux** : `OWNER_EMAIL_NOTIFICATIONS_ENABLED=false` ou échec final `OWNER_EMAIL_DISABLED`.

**Effet attendu** : commandes, paiements, remboursements, incidents et droits restent enregistrés. Aucun fallback d'adresse.

**Reprendre** : vérifier la destination serveur, activer le flag après preflight, puis utiliser le retry Admin sur chaque ligne pertinente. Ne jamais envoyer en masse sans inventaire.

## 11. Rollback production

**Déclencheurs** : erreur de configuration, incident fournisseur, mauvaise destination, volume anormal, doute sur le webhook ou la confidentialité.

**Ordre** :

1. `NOTIFICATION_WORKER_ENABLED=false` ;
2. `CLIENT_EMAIL_NOTIFICATIONS_ENABLED=false` ;
3. `OWNER_EMAIL_NOTIFICATIONS_ENABLED=false` ;
4. `EMAIL_NOTIFICATIONS_ENABLED=false` ;
5. `NOTIFICATION_EMAIL_TRANSPORT=disabled` ;
6. désactiver le transport Auth ;
7. retirer `NOTIFICATION_PRODUCTION_CONFIRM` lorsque l'environnement est stabilisé ;
8. redéployer selon la procédure humaine ;
9. vérifier le healthcheck et l'absence de nouveaux claims ;
10. conserver l'outbox, les événements et suppressions.

Le rollback n'annule aucune commande, ne modifie aucun paiement et ne retire aucune livraison. La remise en service commence par le preflight et un smoke test propriétaire explicitement autorisé.

## Escalade et preuve

Le rapport d'incident peut contenir : identifiant local de notification, kind, statut, nombre de tentatives, timestamps, code d'erreur assaini, `providerMessageId` partiellement masqué et outcome du webhook.

Il ne contient jamais : adresse complète, clé API, secret webhook, bearer worker, cookie, token Auth, body signé, payload client, URL R2, brief ou document contractuel.
