# DCN‑1.1 — préflight et autorisation groupée à obtenir

**Aucune recette distante réalisée.** Aucun appel Stripe TEST, PayPal SANDBOX, R2 distant ou Resend n’est autorisé par la seule présence d’une clé. Aucun environnement Production ou LIVE n’est une cible de recette.

## Préflight préparé, sans requête réseau

`npm run dcn:test:external-preflight` lit seulement le profil local privé et affiche des booléens et chemins de webhook. Il ne construit aucun SDK ni ne contacte de prestataire. Profil externe éventuel :

```sh
npm run dcn:test:external-preflight -- --profile .private/dcn-external-test-config.json
```

Le fichier doit être régulier, non symlink, non lisible par groupe/autres. Aucun `.env` global ni credential LIVE n’est repris. Ne jamais copier ses valeurs dans le rapport, les captures ou Git.

Résultat actuel : TEST/local OK, transport `capture`, origin loopback OK ; Stripe TEST non configuré, PayPal SANDBOX non configuré, R2 Preview non configuré, HTTPS webhook absent, autorisation externe `false`, nouveaux paiements `false`. Ce n’est ni une recette prestataire ni une preuve d’autorisation.

## Une seule demande groupée, cibles à NOMMER avant exécution

Autorisation nécessaire pour les seules ressources suivantes ; noms/identifiants non secrets à confirmer, **aucune clé demandée dans la conversation** :

| Cible isolée | Ressources et périmètre proposés | Variables EXISTANTES, valeurs par saisie privée |
| --- | --- | --- |
| Stripe sandbox DCN | Compte marchand TEST nommé ; checkouts numériques QA, annulation/refus/3DS/asynchrone, webhooks authentiques, lectures de réconciliation et remboursements TEST uniquement | `DCN_STRIPE_SECRET_KEY`, `DCN_STRIPE_ACCOUNT_ID`, `DCN_STRIPE_WEBHOOK_SECRET` |
| PayPal SANDBOX DCN | Application, marchand et acheteur sandbox nommés ; Orders/CAPTURE QA, pending/denied, webhooks authentiques, lectures/reprise et remboursements sandbox | `DCN_PAYPAL_ENVIRONMENT=sandbox`, `DCN_PAYPAL_CLIENT_ID`, `DCN_PAYPAL_CLIENT_SECRET`, `DCN_PAYPAL_WEBHOOK_ID`, `DCN_PAYPAL_MERCHANT_ID` |
| R2 Preview DCN | Deux buckets dédiés public/private Preview nommés, objets synthétiques DCN seulement ; multipart interrompu, reprise, Range et ZIP ; suppression uniquement des objets listés du run après dry-run | `MEDIA_STORAGE_DRIVER=s3`, `MEDIA_STORAGE_PROVIDER=r2`, `MEDIA_DEPLOYMENT_ENV=preview`, `MEDIA_PUBLIC_BUCKET`, `MEDIA_PRIVATE_BUCKET`, `MEDIA_S3_ENDPOINT`, `MEDIA_S3_REGION=auto`, `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY` |
| HTTPS / Safari | Hôte QA nommé et couvert par un certificat de confiance, données synthétiques, accès authentifié, pas de Production ; réseau local contrôlé pour l’iPhone ou autre transport explicitement approuvé | `AUTH_URL`, base locale/TEST dédiée, `DCN_MODE=TEST` |

Le consentement à ces recettes doit identifier le périmètre et les limites. Il **n’autorise pas** déploiement, main/push, modification d’un webhook historique, permission LIVE élargie, paiement/remboursement réel ou email à un client. Aucun tunnel public, port LAN ou service payant n’a été créé.

Après autorisation seulement, activer dans le profil QA `DCN_EXTERNAL_TEST_AUTHORIZED=true` ; `DCN_NEW_PAYMENTS_ENABLED` reste un interrupteur distinct. Fermer les nouveaux achats ne ferme pas une réconciliation/webhook déjà expressément autorisé. Le verrou TEST-only/Production reste en place.

## Destinations et événements issus du code

Destination Stripe : **origine HTTPS QA autorisée + `/api/digital/webhooks/stripe`**. Secret de signature séparé de la clé API. Événements :

`checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `refund.created`, `refund.updated`, `refund.failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`.

Destination PayPal : **même origine HTTPS QA + `/api/digital/webhooks/paypal`**. ID de webhook de l’application sandbox. Événements actuellement dispatchés :

`PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`, `PAYMENT.REFUND.PENDING`, `PAYMENT.REFUND.COMPLETED`, `PAYMENT.REFUND.FAILED`, `CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.UPDATED`, `CUSTOMER.DISPUTE.RESOLVED`.

La recette devra confirmer lesquels sont effectivement abonnables et émis par l’intégration Orders/Payments sandbox concernée, leurs payloads et la corrélation capture/refund/dispute. **Ces noms dans une allowlist ne prouvent pas leur émission réelle.** Aucun webhook existant de Commander/Boutique/Soutien n’est détourné.

## Ordre de recette externe future

1. Preflight expurgé, identité/environnement du marchand, séparation des credentials, signature et accès minimaux. Aucun élargissement LIVE pour compenser une indisponibilité sandbox.
2. Créer par le vrai parcours DCN une sélection QA ; constater les consentements distincts non précochés et les versions figées. Un changement du master après création de session ne remplace pas le snapshot.
3. Payer sur le checkout hébergé TEST/SANDBOX avec ses moyens de test. Retour navigateur et événement fournisseur réel avant/après retour ; signature vérifiée, montant/devise/référence/marchand concordants. Aucun accès sur simple approbation PayPal ou retour URL.
4. Rejouer uniquement les événements QA autorisés, doubles clics, ordre inversé et reprises après délai/crash. Distinguer le simulateur PayPal d’une notification authentique de l’application sandbox. Aucune capture aveugle après timeout.
5. PDF/facture unique, confirmation préalable, accès privé, piste/ZIP et reconnexion ; prix courants et ancienne composition modifiés seulement sur la fixture dédiée.
6. Remboursement TEST complet/par ligne/réduction et initié depuis Dashboard, état pending/failed, timeout et GET de reprise ; un seul avoir après succès confirmé. Litiges de test lorsque le prestataire les permet, sinon NOT_RUN explicite.
7. Email **capture** conservé : aucune délivrance à une vraie personne. Une recette de transport distante séparée serait une nouvelle autorisation, non incluse ici.
8. Nettoyage limité aux objets temporaires QA du run, dry-run/listing exact, jamais ancienne acquisition, master référencé, document ou événement.

Les factures/avoirs DCN restent QA tant que les décisions fiscales et contractuelles ne sont pas validées. Aucun document de prestation fictive ou reçu fiscal de don.

## Safari physique — regroupement court

Statut actuel : macOS **NOT_RUN**, iPhone physique **NOT_RUN**. Le navigateur Codex utilisé pour les captures n’est ni Safari physique ni un iPhone.

Sur Mac, la démo loopback fonctionne à `http://127.0.0.1:3140`. Pour l’iPhone, cette adresse désigne **l’iPhone lui-même**, pas le Mac. Il faut d’abord autoriser un hôte LAN privé précis, son certificat HTTPS de confiance, les seuls ports nécessaires et une base QA sans données client. Ne pas demander de contourner un avertissement TLS. Aucun bind `0.0.0.0`, tunnel Internet ou import Production n’est effectué pour cette préparation.

Une fois cette cible autorisée disponible : ouvrir l’album QA, écouter les deux extraits et changer de piste ; importer un WAV synthétique en Admin sans publier de contenu réel ; ajouter piste/album ; effectuer le paiement TEST autorisé ; recevoir le document QA ; retrouver la bibliothèque ; enregistrer piste et ZIP dans Téléchargements/Fichiers ; ouvrir l’archive ; se déconnecter/reconnecter et retélécharger. Vérifier les requêtes Range et la reprise sur gros fichier. Les PASS physiques attendent une exécution et un retour humains explicites.

## Références primaires de préparation

Relues le 13/10/2026, sans appel financier : [Stripe fulfillment](https://docs.stripe.com/checkout/fulfillment), [Stripe webhooks](https://docs.stripe.com/webhooks), [Stripe refunds](https://docs.stripe.com/refunds), [Stripe disputes](https://docs.stripe.com/disputes/how-disputes-work), [PayPal signatures/webhooks](https://developer.paypal.com/api/rest/webhooks/rest/), [PayPal refunds](https://developer.paypal.com/api/payments/v2/captures-refund), [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

La gateway de téléchargement DCN reste propriétaire à chaque GET/HEAD/Range : une URL présignée R2 de possession ne serait pas une révocation recalculée à chaque requête.
