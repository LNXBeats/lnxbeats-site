# E-mail Resend — staging contrôlé

## Configuration

Resend est permis uniquement avec `NOTIFICATION_DEPLOYMENT_ENV=staging`, `NOTIFICATION_EMAIL_TRANSPORT=resend` et la confirmation non secrète documentée dans `.env.example`. Les secrets `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` et `NOTIFICATION_WORKER_SECRET` restent dans `.env.local` ou un coffre de staging. Ils ne doivent jamais être transmis dans le chat, les logs ou Git.

Le sous-domaine transactionnel confirmé par l’humain est `email.lnxbeats.fr` (Resend, région Europe / Ireland, DNS OVH, statut Verified). V0.7.3 ne crée ni clé, ni webhook, ni enregistrement DNS. Toute évolution DNS doit reprendre **exactement** les valeurs affichées par Resend, sans inventer de SPF, DKIM, MX ou valeur de vérification et sans modifier les enregistrements du site/Railway. La clé existante `LNX Studio Transactional` possède la permission Sending access et ne doit pas être remplacée par ce sprint.

L’expéditeur et le reply-to viennent de `EMAIL_FROM` et `EMAIL_REPLY_TO`. Les destinataires staging doivent être une adresse officielle de test Resend ou figurer explicitement dans `NOTIFICATION_STAGING_RECIPIENT_ALLOWLIST`. L’adresse propriétaire vient de `EMAIL_OWNER_RECIPIENT`, jamais d’un compte QA.

## QA fournisseur

Resend documente les adresses `delivered@resend.dev`, `bounced@resend.dev`, `complained@resend.dev` et `suppressed@resend.dev` pour tester les états sans cibler une fixture locale. Après configuration humaine :

1. démarrer le serveur staging et le worker ;
2. enregistrer le webhook staging exact ;
3. lancer `npm run notifications:check` ;
4. envoyer une notification QA par état ;
5. attendre le webhook signé et vérifier l’Admin ;
6. envoyer au maximum un message explicite `[TEST] Notification propriétaire LNX Studio` vers l’adresse autorisée ;
7. recueillir la validation humaine mobile/Safari Mail.

Une clé, un domaine, un endpoint ou une destination manquants donnent `BLOQUÉ — ACTION HUMAINE REQUISE`. Aucune configuration DNS, Resend ou Railway n’est mutée par le code.

## Harness V0.7.3.1 — procédure humaine Railway

Le harness n'est disponible que si toutes les conditions suivantes sont vraies dans le même déploiement :

- `NODE_ENV=production` fourni par Next/Railway ;
- `RAILWAY_ENVIRONMENT_NAME=staging` fourni par Railway ;
- `NOTIFICATION_DEPLOYMENT_ENV=staging` ;
- `NOTIFICATION_EMAIL_TRANSPORT=resend` ;
- `NOTIFICATION_STAGING_QA_CONFIRM=resend-v073-qa-approved` ;
- `EMAIL_NOTIFICATIONS_ENABLED=true` ;
- `OWNER_EMAIL_NOTIFICATIONS_ENABLED=true` ;
- `CLIENT_EMAIL_NOTIFICATIONS_ENABLED=false` ;
- `PAYMENTS_ENABLED=false` ;
- `SMS_TRANSPORT=disabled` et `SMS_NOTIFICATIONS_ENABLED=false` ;
- `EMAIL_OWNER_RECIPIENT` exactement égal à la destination officielle du scénario ;
- Bearer `NOTIFICATION_WORKER_SECRET` valide.

La variable `NOTIFICATION_STAGING_RECIPIENT_ALLOWLIST` n'est pas utilisée par ce harness. Le payload accepté contient seulement `scenario`. Toute autre clé est refusée.

### Commandes sûres

Les commandes suivantes lisent le secret worker depuis l'environnement du conteneur sans l'afficher. Toujours vérifier qu'il n'existe aucune autre notification `PENDING` avant le dispatcher, car celui-ci traite un lot global borné.

Création de la fixture, en remplaçant uniquement la constante locale `scenario` par l'un des quatre noms autorisés :

```bash
node -e 'const scenario="delivered";fetch("http://127.0.0.1:"+process.env.PORT+"/api/internal/notifications/qa/resend",{method:"POST",headers:{authorization:"Bearer "+process.env.NOTIFICATION_WORKER_SECRET,"content-type":"application/json"},body:JSON.stringify({scenario})}).then(async r=>console.log(JSON.stringify({http:r.status,...await r.json()})))'
```

Lecture sans destinataire ni identifiant fournisseur :

```bash
node -e 'const scenario="delivered";fetch("http://127.0.0.1:"+process.env.PORT+"/api/internal/notifications/qa/resend?scenario="+scenario,{headers:{authorization:"Bearer "+process.env.NOTIFICATION_WORKER_SECRET}}).then(async r=>console.log(JSON.stringify({http:r.status,...await r.json()})))'
```

Dispatch séparé, une seule fois après constat `PENDING`, `attempts=0` et inventaire global propre :

```bash
node -e 'fetch("http://127.0.0.1:"+process.env.PORT+"/api/internal/notifications/dispatch",{method:"POST",headers:{authorization:"Bearer "+process.env.NOTIFICATION_WORKER_SECRET}}).then(async r=>console.log(JSON.stringify({http:r.status,...await r.json()})))'
```

### Ordre exact par scénario

Pour chacun des scénarios ci-dessous :

1. définir `EMAIL_OWNER_RECIPIENT` à la valeur exacte indiquée et conserver `OWNER_EMAIL_NOTIFICATIONS_ENABLED=true` ;
2. déployer la nouvelle configuration staging ;
3. appeler `POST /api/internal/notifications/qa/resend` une fois ;
4. rappeler le même POST et exiger `created=false` avec le même `notificationId` ;
5. appeler `GET` et exiger `PENDING`, `attempts=0`, aucun provider/message/timestamp ;
6. exécuter `npm run notifications:check` et exiger que cette fixture soit la seule ligne dispatchable ;
7. appeler le dispatcher exactement une fois ;
8. appeler `GET` jusqu'au statut terminal attendu, sans redéclencher le dispatcher ;
9. vérifier le webhook HTTP 200 et les types d'événements ;
10. ne passer au scénario suivant qu'après l'état terminal et l'absence de retry en attente.

| Scénario | `EMAIL_OWNER_RECIPIENT` exact | État final | Suppression attendue |
| --- | --- | --- | --- |
| `delivered` | `delivered+lnx-v073-qa-01@resend.dev` | `DELIVERED` | inactive / aucune |
| `bounced` | `bounced+lnx-v073-qa-01@resend.dev` | `BOUNCED` | `HARD_BOUNCE` active |
| `complained` | `complained+lnx-v073-qa-01@resend.dev` | `COMPLAINED` | `COMPLAINT` active |
| `suppressed` | `suppressed@resend.dev` | `SUPPRESSED` | `PROVIDER_SUPPRESSED` active |

Après le dernier contrôle, remettre `OWNER_EMAIL_NOTIFICATIONS_ENABLED=false`, retirer `EMAIL_OWNER_RECIPIENT` et `NOTIFICATION_STAGING_QA_CONFIRM`, puis redéployer. Conserver les quatre fixtures pour l'audit jusqu'à une procédure de cleanup distincte : aucune route destructive n'est fournie par le harness.

## STAGING OWNER EMAIL SMOKE TEST ONLY — V0.7.3.2

Ce mécanisme ne réouvre pas le harness fournisseur. Il exige simultanément : Railway `staging`, Resend staging confirmé, `EMAIL_NOTIFICATIONS_ENABLED=true`, `OWNER_EMAIL_NOTIFICATIONS_ENABLED=true`, `CLIENT_EMAIL_NOTIFICATIONS_ENABLED=false`, paiements et SMS désactivés, `NOTIFICATION_STAGING_QA_CONFIRM` absente, Bearer worker valide et :

```text
NOTIFICATION_OWNER_SMOKE_TEST_CONFIRM=I_UNDERSTAND_THIS_SENDS_ONE_REAL_OWNER_EMAIL
```

`EMAIL_OWNER_RECIPIENT` doit contenir l'unique adresse propriétaire autorisée. Cette valeur ne doit jamais être passée dans une commande, un body ou un log. Les adresses fictives et les destinations techniques `resend.dev` sont refusées.

La création et l'envoi sont deux intentions séparées. Toutes les commandes ci-dessous lisent le secret worker depuis l'environnement sans l'afficher.

### PRE-CHECK

```bash
npm run notifications:check
```

Exiger `pending=0`, `retryable=0` et `final=0` avant de poursuivre. Les suppressions historiques ne sont pas dispatchables.

### CREATE

```bash
node -e 'fetch("http://127.0.0.1:"+process.env.PORT+"/api/internal/notifications/qa/owner-email-smoke",{method:"POST",headers:{authorization:"Bearer "+process.env.NOTIFICATION_WORKER_SECRET,"content-type":"application/json"},body:"{}"}).then(async r=>console.log(JSON.stringify({http:r.status,...await r.json()})))'
```

Exiger HTTP 200, `created=true`, `status=PENDING`, `attempts=0` et `providerMessageIdPresent=false`. Un second CREATE doit retourner `created=false` avec le même `notificationId`.

### VERIFY

```bash
node -e 'fetch("http://127.0.0.1:"+process.env.PORT+"/api/internal/notifications/qa/owner-email-smoke",{headers:{authorization:"Bearer "+process.env.NOTIFICATION_WORKER_SECRET}}).then(async r=>console.log(JSON.stringify({http:r.status,...await r.json()})))'
```

### TARGETED DISPATCH

À exécuter une fois seulement après la vérification PENDING :

```bash
node -e 'fetch("http://127.0.0.1:"+process.env.PORT+"/api/internal/notifications/qa/owner-email-smoke/dispatch",{method:"POST",headers:{authorization:"Bearer "+process.env.NOTIFICATION_WORKER_SECRET,"content-type":"application/json"},body:"{}"}).then(async r=>console.log(JSON.stringify({http:r.status,...await r.json()})))'
```

Cette route ne scanne jamais l'outbox. Elle cible uniquement l'identifiant retrouvé par la clé one-shot. Ne jamais utiliser `npm run notifications:dispatch` pour ce test.

### VERIFY FINAL

Répéter uniquement la commande GET de vérification, sans redéclencher le dispatch. Attendre `SENT`, puis le webhook signé doit faire apparaître `DELIVERED` et `email.delivered`. Un second appel à la route ciblée retourne `dispatched=false` sans appel fournisseur.

### CLEANUP DE CONFIGURATION

Après la preuve humaine, redéployer avec :

```text
EMAIL_NOTIFICATIONS_ENABLED=false
OWNER_EMAIL_NOTIFICATIONS_ENABLED=false
CLIENT_EMAIL_NOTIFICATIONS_ENABLED=false
SMS_NOTIFICATIONS_ENABLED=false
PAYMENTS_ENABLED=false
```

Supprimer `EMAIL_OWNER_RECIPIENT` et `NOTIFICATION_OWNER_SMOKE_TEST_CONFIRM`. Conserver `NOTIFICATION_STAGING_QA_CONFIRM` absente. La fixture one-shot reste archivée comme preuve et aucune route destructive n'est fournie.

Références officielles :

- envoi et idempotence : https://resend.com/docs/api-reference/emails/send-email et https://resend.com/docs/dashboard/emails/idempotency-keys
- adresses de test : https://resend.com/docs/dashboard/emails/send-test-emails
- erreurs : https://www.resend.com/docs/api-reference/errors
