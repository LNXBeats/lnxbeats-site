# Notifications transactionnelles — préparation production

## Statut et périmètre

V0.7.8 prépare techniquement les notifications transactionnelles de production sans les activer et sans déployer. PostgreSQL reste la source de vérité pour les commandes, paiements, livraisons, remboursements, incidents et demandes de droits. Un e-mail ne confirme, n'annule et ne répare jamais un état métier.

La mise en production reste une décision humaine distincte. Elle exige le preflight, la validation staging, la configuration du worker et du webhook dans l'environnement d'exécution, puis une validation opérateur. V0.7.8 ne modifie ni Railway, ni Resend, ni DNS et n'envoie aucun e-mail réel pendant l'implémentation automatisée.

Les messages couverts sont strictement transactionnels. Newsletter, prospection, promotion, SMS réel et préférences marketing sont hors périmètre.

## Architecture

### Événements métier

Le parcours principal est :

```text
événement métier
  → transaction PostgreSQL
  → OrderNotification idempotente
  → worker séparé
  → claim avec lease
  → validation du destinataire et des suppressions
  → transport capture ou Resend
  → providerMessageId
  → webhook Resend signé
  → delivered / bounce / complaint / suppression
```

Le webhook Stripe/PayPal et la publication d'une livraison créent uniquement l'outbox dans leur transaction. Ils n'attendent jamais Resend. Une panne e-mail ne régresse donc ni `Payment`, ni `Order`, ni `Delivery`.

### Authentification

Les codes d'inscription, liens de vérification legacy et liens de réinitialisation passent par l'adaptateur e-mail Auth dédié. Ils ne sont pas placés dans `OrderNotification` : aucun OTP, token de vérification ou token de reset ne doit être persisté dans l'outbox métier.

En production, ce chemin exige lui aussi `EMAIL_PROVIDER=resend`, la configuration Resend commune, une origine Auth HTTPS valide et les gardes de production. Les erreurs publiques restent génériques. Un lien d'authentification est borné, à usage unique et construit depuis `AUTH_URL`; le token reste dans le fragment de l'URL lorsque le parcours le prévoit. Une empreinte de la clé d'idempotence sert de claim d'audit PostgreSQL : deux requêtes concurrentes ne franchissent pas simultanément le claim, et un claim interrompu devient récupérable après son délai borné sans persister le token.

## Destinataires

### Client

Une notification client utilise uniquement l'adresse vérifiée liée au compte ou le snapshot d'adresse de l'Order issu de ce compte. Une adresse contractuelle saisie dans un dossier de droits n'est pas une preuve de possession de boîte et ne remplace pas automatiquement l'adresse vérifiée pour les notifications.

Le navigateur ne fournit jamais `recipient`, `to`, `email`, `userId` ou un redirect arbitraire à l'outbox. La destination est résolue côté serveur depuis la ressource métier.

### Propriétaire

Toutes les alertes propriétaire utilisent exclusivement `EMAIL_OWNER_RECIPIENT`. Il n'existe aucun fallback vers une adresse personnelle hardcodée, un compte QA ou l'auteur d'une requête HTTP. Une valeur absente produit un échec explicite et non retryable de la notification concernée sans casser l'opération métier. Cette ligne finale reste un audit de l'événement manqué : corriger la variable protège les événements suivants, mais ne rend pas cette ligne éligible au retry Admin et ne provoque aucun renvoi automatique.

### Normalisation et refus

Les adresses sont normalisées en minuscules et validées côté serveur. En production, les domaines fictifs, `.invalid`, `.test` et les destinations de test fournisseur sont refusés. Une adresse activement supprimée à la suite d'un hard bounce, d'une complaint ou d'une décision opérateur n'est pas envoyée de nouveau sans résolution explicite.

La staging conserve sa politique actuelle : une notification client Resend ne peut viser que les adresses de test officielles du fournisseur ou une adresse explicitement inscrite dans `NOTIFICATION_STAGING_RECIPIENT_ALLOWLIST`. Une alerte propriétaire doit correspondre exactement à `EMAIL_OWNER_RECIPIENT` et à son flag dédié. L'allowlist staging n'est jamais interprétée comme une allowlist de production.

## Expéditeur et réponse

`EMAIL_FROM` et `EMAIL_REPLY_TO` sont des variables serveur. En production :

- l'expéditeur porte un nom lisible LNX Beats ou LNX Studio ;
- l'adresse From appartient à un domaine transactionnel vérifié et contrôlé sous `lnxbeats.fr` ;
- le Reply-To appartient également à un domaine contrôlé sous `lnxbeats.fr` ;
- aucune adresse QA, `.invalid`, `resend.dev` ou adresse personnelle hardcodée n'est admise ;
- aucune valeur n'est embarquée dans le bundle client.

Le code ne modifie pas le DNS. Les enregistrements SPF, DKIM et autres preuves de domaine doivent toujours être copiés exactement depuis Resend par un humain autorisé.

## Contrat de configuration production

Les valeurs sensibles restent exclusivement dans le coffre de l'environnement. Les noms nécessaires sont :

- `NOTIFICATION_DEPLOYMENT_ENV`
- `NOTIFICATION_EMAIL_TRANSPORT`
- `NOTIFICATION_PRODUCTION_CONFIRM`
- `NOTIFICATION_WORKER_ENABLED`
- `NOTIFICATION_WORKER_SECRET`
- `EMAIL_PROVIDER`
- `EMAIL_NOTIFICATIONS_ENABLED`
- `OWNER_EMAIL_NOTIFICATIONS_ENABLED`
- `CLIENT_EMAIL_NOTIFICATIONS_ENABLED`
- `EMAIL_FROM`
- `EMAIL_REPLY_TO`
- `EMAIL_OWNER_RECIPIENT`
- `APP_CANONICAL_URL`
- `AUTH_URL`
- `RESEND_API_KEY`
- `RESEND_WEBHOOK_SECRET`
- `SMS_TRANSPORT`
- `SMS_NOTIFICATIONS_ENABLED`

La confirmation non secrète attendue est :

```text
NOTIFICATION_PRODUCTION_CONFIRM=I_UNDERSTAND_THIS_ENABLES_PRODUCTION_EMAILS
```

Cette phrase n'est pas un secret et ne remplace aucune autre garde. Pour ouvrir le transport production, les combinaisons suivantes doivent être cohérentes : environnement `production`, transports Resend Auth et outbox, notifications générales actives, worker explicitement actif, secrets présents, origine canonique HTTPS, From/Reply-To approuvés, destinataire propriétaire valide et SMS désactivé.

`NOTIFICATION_WORKER_ENABLED` vaut `false` par défaut. La présence d'un secret worker ou d'une route dans le build ne doit pas démarrer le dispatch à elle seule.

## Templates

Les templates actifs couvrent :

- code d'inscription, vérification legacy et réinitialisation du mot de passe ;
- paiement confirmé et nouvelle commande propriétaire ;
- commande acceptée et création démarrée ;
- livraison disponible ;
- demandes, précisions et documents DRAFT des droits/contrats ;
- remboursements partiel et total ;
- incident de paiement propriétaire.

Chaque message possède un sujet humain, un HTML sans JavaScript et un texte brut équivalent. Les champs dynamiques sont échappés. Les liens métier ciblent les routes authentifiées `/compte` ou `/admin`; aucun WAV, MP3, PDF privé, chemin R2, URL signée persistante, identifiant interne de paiement ou payload fournisseur n'est joint.

Les versions de template et de payload persistées font partie du contrat d'envoi. Le renderer V1 est centralisé et couvert par des snapshots de contenu ; une nouvelle rédaction devra créer une nouvelle version et conserver le renderer historique tant que des lignes V1 restent rejouables. Une incohérence entre kind, template, version, environnement ou payload échoue fermée.

Les e-mails ne contiennent aucun pixel, paramètre UTM ni ressource distante obligatoire. Les éventuels réglages de tracking du compte Resend doivent être contrôlés humainement avant l'activation, car le preflight local ne contacte pas le fournisseur.

## Worker, claims et retries

Le worker traite un lot borné et ne s'exécute que si `NOTIFICATION_WORKER_ENABLED=true`, après authentification par `NOTIFICATION_WORKER_SECRET`. Un verrou PostgreSQL et une lease empêchent deux workers de réclamer simultanément la même ligne. Une lease expirée est récupérable après crash.

### Déclenchement automatique

Le dépôt fournit la commande `npm run notifications:dispatch` et la route interne protégée `POST /api/internal/notifications/dispatch`, mais ne configure aucun cron, scheduler Railway ni service worker permanent. `NOTIFICATION_WORKER_ENABLED=true` autorise un déclenchement ; il ne le planifie pas.

Le gate opérationnel reste donc : `PRODUCTION GATE — WORKER SCHEDULER REQUIRED`. Avant toute activation production, un humain doit choisir et documenter un déclenchement borné de la route interne ou de la commande CLI, protéger le secret, éviter les cadences concurrentes et valider le monitoring ainsi que le rollback. Aucun scheduler n'est créé par V0.7.8.

La stratégie bornée est : 5 minutes, 30 minutes, 2 heures puis 6 heures, avec cinq claims maximum. Le cinquième échec devient final et ne planifie pas un délai supplémentaire. Sont retryables : timeout, erreur réseau, 429 et 5xx. Sont finaux : adresse invalide, configuration invalide, destinataire absent, suppression active, complaint et requête fournisseur invalide.

Un retry technique conserve la même notification logique et la même clé d'idempotence. Le retry Admin est limité aux statuts `FAILED_RETRYABLE`, exige une confirmation explicite et reste interdit après livraison, complaint ou suppression, ainsi qu'après épuisement du maximum.

## Webhook, bounces et complaints

L'endpoint Resend lit un corps brut borné, exige les en-têtes Svix, vérifie la signature avec la méthode officielle du SDK, applique une allowlist d'événements et déduplique `svix-id` en PostgreSQL. Une signature invalide ne produit aucune mutation.

Un hard bounce active une suppression locale. Une complaint est un signal fort et active également une suppression. Les prochaines notifications vers cette adresse sont bloquées; le compte utilisateur n'est pas désactivé automatiquement. Un événement inconnu, une destination incohérente ou un `providerMessageId` non corrélé exige une revue sans envoyer de nouveau message.

Les soft bounces ne doivent pas être inventés lorsque le payload Resend ne fournit pas une distinction fiable. Une panne de webhook répond en erreur après authentification afin que le fournisseur puisse retenter.

## Preuves QA staging du 23 août 2026

La QA humaine staging V0.7.8 a validé le transport propriétaire et le webhook réels avec les destinations officielles Resend :

- `delivered` : une notification `OWNER_NEW_ORDER`, une tentative, statut final livré après webhook et aucun doublon ;
- `bounced` : statut adresse rejetée et suppression locale activée ;
- `complained` : complaint reçue et suppression locale activée ;
- destination déjà supprimée : claim refusé avant transport et aucun nouvel appel Resend ;
- client QA `.invalid` avec audience client désactivée : échec local final, aucun appel Resend ;
- isolation : staging ne réclame que staging, production ne réclame que production et les lignes legacy `development` restent ignorées.

Le diagnostic staging final a indiqué `pending=0`, `retryable=0` et `foreignEnvironment=0`. Ces preuves ne valident ni un domaine, ni un expéditeur, ni un webhook, ni un scheduler de production.

## Observabilité Admin

L'Admin peut consulter le kind humain, le canal, le destinataire masqué, le provider, le statut, les tentatives, les dates, la prochaine tentative, la ressource et une erreur assainie. Les secrets, payloads bruts, cookies, tokens, adresses complètes et contenus privés ne sont jamais affichés.

Le diagnostic opérateur rapproche l'identifiant local, le `providerMessageId` borné et les événements locaux. Une destination peut être bloquée manuellement uniquement depuis une notification existante, par un ADMIN et après confirmation explicite ; le navigateur ne fournit jamais une adresse arbitraire. Cette action est auditée et ne modifie aucun compte utilisateur. Le diagnostic ne corrige jamais automatiquement un état métier et ne supprime pas l'historique.

## Preflight sans envoi

La commande read-only est :

```text
npm run notifications:preflight
```

Elle doit produire `PASS` ou `BLOCKED` sans afficher de valeur sensible et sans appeler Resend. Elle contrôle au minimum :

- environnement et confirmation explicite ;
- transports Auth/outbox et flags ;
- worker activé et secret présent ;
- clé et secret webhook présents ;
- HTTPS et cohérence des origines ;
- syntaxe et domaines From, Reply-To et propriétaire ;
- absence d'adresse QA ou fournisseur en production ;
- schéma PostgreSQL attendu ;
- outbox dispatchable sans mélange d'environnement ;
- état des échecs finaux, suppressions et événements nécessitant une revue.

Un preflight réussi ne prouve ni la validité réseau de la clé, ni la configuration du Dashboard, ni la réception dans un client e-mail. Ces points restent des validations humaines staging puis production contrôlée.

## Activation humaine

1. Exécuter les tests et runtimes PostgreSQL sur base jetable.
2. Valider le rendu capture de chaque template et les liens.
3. Valider en staging les scénarios Resend delivered, bounce, complaint et suppressed sur destinations approuvées.
4. Confirmer le domaine, le From, le Reply-To, le webhook et l'absence de tracking inutile dans Resend.
5. Préparer les variables production dans le coffre sans les afficher.
6. Laisser `NOTIFICATION_WORKER_ENABLED=false` pendant le premier boot de configuration, sans cron actif.
7. Lorsque la configuration candidate est prête, armer explicitement le worker tout en laissant le cron absent, puis exécuter `npm run notifications:preflight` dans le conteneur candidat.
8. Après validation opérateur du preflight, configurer ou activer le déclenchement du worker selon la procédure d'exploitation.
9. Effectuer un unique smoke test propriétaire explicitement autorisé avant toute ouverture client.
10. Surveiller l'outbox, les webhooks et les suppressions.

## Rollback

Le rollback e-mail est non destructif :

1. mettre `NOTIFICATION_WORKER_ENABLED=false` ;
2. désactiver `CLIENT_EMAIL_NOTIFICATIONS_ENABLED` et `OWNER_EMAIL_NOTIFICATIONS_ENABLED` ;
3. désactiver `EMAIL_NOTIFICATIONS_ENABLED` ;
4. remettre `NOTIFICATION_EMAIL_TRANSPORT=disabled` ;
5. désactiver le transport Auth afin qu'aucun envoi direct ne soit possible ;
6. retirer la confirmation production lors de la stabilisation ;
7. conserver toutes les lignes d'outbox, événements et suppressions pour diagnostic.

Avant la désactivation complète des étapes 4 et 6, la combinaison `resend` configurée avec notifications générales, audiences et worker à `false` reste valide pour le démarrage et le healthcheck : les credentials et le webhook peuvent rester configurés sans autoriser aucun envoi. En revanche, `npm run notifications:preflight` reste bloqué tant que les notifications générales, les deux audiences et le worker ne sont pas tous explicitement réarmés.

Ne jamais supprimer l'outbox, rejouer les webhooks métier, créer un second Payment ou modifier une Order pour réparer un e-mail.

Le détail opérationnel est dans [NOTIFICATION_RUNBOOK.md](NOTIFICATION_RUNBOOK.md).
