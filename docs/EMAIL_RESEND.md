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

Références officielles :

- envoi et idempotence : https://resend.com/docs/api-reference/emails/send-email et https://resend.com/docs/dashboard/emails/idempotency-keys
- adresses de test : https://resend.com/docs/dashboard/emails/send-test-emails
- erreurs : https://www.resend.com/docs/api-reference/errors
