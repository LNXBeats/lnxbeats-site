# Smoke e-mail propriétaire Production one-shot

Ce mécanisme envoie au maximum un e-mail transactionnel réel au destinataire propriétaire configuré. Il est distinct du smoke staging, ne scanne jamais l'outbox et n'active ni worker, ni scheduler, ni Cron, ni e-mail client. Il ne doit être utilisé qu'après une autorisation humaine explicite.

## Invariants

- Railway, `NODE_ENV` et les notifications doivent tous indiquer `production`.
- Resend, son webhook, l'expéditeur, le Reply-To, l'origine canonique et le secret worker doivent être configurés.
- Le destinataire provient uniquement de `EMAIL_OWNER_RECIPIENT`; les domaines réservés, `.invalid`, `.test` et `resend.dev` sont refusés.
- `CLIENT_EMAIL_NOTIFICATIONS_ENABLED`, `NOTIFICATION_WORKER_ENABLED`, les paiements, le scheduler et le SMS restent désactivés.
- La fixture `LNX-TEST-PROD-OWNER-0812` est synthétique, annulée, sans utilisateur, sans client, sans Payment et à 0 €.
- La clé `production:owner-smoke:v0812:01` est exclue du dispatcher global et du retry Admin.
- Un échec devient final. Aucun retry automatique ou manuel n'est autorisé.
- Le webhook Resend signé reste l'unique mécanisme de réconciliation `sent`, `delivered`, `bounced`, `complained`, `failed` ou `suppressed`.

## Phase A — armement minimal

Dans le service web Production, modifier uniquement :

```text
OWNER_EMAIL_NOTIFICATIONS_ENABLED=true
NOTIFICATION_PRODUCTION_OWNER_SMOKE_CONFIRM=I_UNDERSTAND_THIS_SENDS_ONE_REAL_PRODUCTION_OWNER_EMAIL
```

Exiger simultanément :

```text
NOTIFICATION_DEPLOYMENT_ENV=production
NOTIFICATION_EMAIL_TRANSPORT=resend
EMAIL_NOTIFICATIONS_ENABLED=true
CLIENT_EMAIL_NOTIFICATIONS_ENABLED=false
NOTIFICATION_WORKER_ENABLED=false
NOTIFICATION_SCHEDULER_MODE=disabled
PAYMENTS_ENABLED=false
SMS_TRANSPORT=disabled
SMS_NOTIFICATIONS_ENABLED=false
```

La confirmation Production générale doit déjà être présente. Ne jamais placer le secret worker, le destinataire ou une clé Resend dans une commande, une URL ou un log.

## Phase B — création sans envoi

Depuis la Console du conteneur web exact :

```bash
node -e 'fetch("http://127.0.0.1:"+process.env.PORT+"/api/internal/notifications/production/owner-email-smoke",{method:"POST",headers:{authorization:"Bearer "+process.env.NOTIFICATION_WORKER_SECRET,"content-type":"application/json"},body:"{}"}).then(async r=>console.log(JSON.stringify({http:r.status,...await r.json()})))'
```

Exiger HTTP 200, `created=true`, `status=PENDING`, `attempts=0` et `providerMessageIdPresent=false`. Un second CREATE éventuel doit retourner `created=false` et le même identifiant ; il ne réarme jamais la fixture.

## Phase C — lecture avant envoi

```bash
node -e 'fetch("http://127.0.0.1:"+process.env.PORT+"/api/internal/notifications/production/owner-email-smoke",{headers:{authorization:"Bearer "+process.env.NOTIFICATION_WORKER_SECRET}}).then(async r=>console.log(JSON.stringify({http:r.status,...await r.json()})))'
```

Poursuivre uniquement si la ligne reste `PENDING`, `attempts=0`, sans identifiant provider et sans suppression active.

## Phase D — dispatch ciblé unique

Exécuter une seule fois :

```bash
node -e 'fetch("http://127.0.0.1:"+process.env.PORT+"/api/internal/notifications/production/owner-email-smoke/dispatch",{method:"POST",headers:{authorization:"Bearer "+process.env.NOTIFICATION_WORKER_SECRET,"content-type":"application/json"},body:"{}"}).then(async r=>console.log(JSON.stringify({http:r.status,...await r.json()})))'
```

Cette route cible uniquement l'identifiant de la fixture. Ne jamais lancer `notifications:dispatch`, le worker, le scheduler, un Cron ou `Run now` pour ce test. Si le résultat n'est pas accepté, arrêter : aucun retry n'est autorisé.

## Phase E — preuve réelle et webhook

Vérifier la réception humaine de l'unique e-mail `[TEST PRODUCTION]`. Attendre ensuite le webhook signé Resend. Aucun deuxième dispatch ne doit être exécuté.

## Phase F — statut final

Répéter uniquement la commande GET. Vérifier `attempts=1`, le provider, la présence de l'identifiant provider et les événements. `DELIVERED` avec `email.delivered` constitue la preuve nominale. `BOUNCED`, `COMPLAINED`, `SUPPRESSED` ou `FAILED_FINAL` impose un arrêt et une revue humaine.

## Phase G — fermeture immédiate

Remettre :

```text
OWNER_EMAIL_NOTIFICATIONS_ENABLED=false
```

Puis supprimer ou vider :

```text
NOTIFICATION_PRODUCTION_OWNER_SMOKE_CONFIRM
```

Conserver impérativement les e-mails client, le worker, le scheduler, les paiements et le SMS désactivés. La fixture et ses événements restent en base comme preuve ; aucune route de suppression n'est fournie.

## Rollback et fail-closed

La confirmation absente, l'audience propriétaire désactivée, le worker désactivé ou le scheduler désactivé ferment indépendamment le mécanisme. En cas d'anomalie, refermer d'abord le flag propriétaire et retirer la confirmation spécifique. Aucun rollback Prisma, aucune restauration PostgreSQL et aucune modification Resend ne sont nécessaires.
