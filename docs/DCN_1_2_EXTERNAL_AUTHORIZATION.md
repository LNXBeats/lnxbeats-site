# DCN-1.2 — demande groupée d’autorisation externe, NON APPROUVÉE

Date : 13 octobre 2026. **Aucune exécution externe n’est autorisée par ce document ou le lot DCN-1.2.** La recette actuelle reste locale, avec doubles prestataires, emails capturés et aucune ouverture réseau. L’existence d’anciens comptes sandbox, credentials ou permissions d’autres domaines ne les autorise pas pour DCN.

## Réponse unique demandée avant exécution

Ludovic devra nommer les cibles non secrètes ci-dessous et approuver/rejeter chacune avec son plafond. Aucune clé, secret, URL authentifiée ou mot de passe dans le chat : saisie seulement via mécanisme privé sécurisé. Si une cible reste inconnue, sa recette reste **NOT_RUN**, pas FAIL ni PASS. Aucun changement de compte LIVE, service payant, plan Railway, main, déploiement ou email client n’est inclus.

| Cible | Identifiant à confirmer (non secret) | État au présent lot | Plafond proposé, à autoriser |
| --- | --- | --- | --- |
| Stripe sandbox isolé DCN | Nom du sandbox, compte TEST attendu et personne habilitée | À identifier ; aucune lecture compte réalisée | ≤20 sessions Checkout ; ≤10 paiements TEST ; ≤10 remboursements TEST ; ≤40 relectures GET ; ≤30 rejouements d’événements QA ; ≤2 h de recette active. |
| PayPal SANDBOX DCN | Nom/ID application sandbox, marchand, acheteur(s) fictifs distincts | À identifier ; aucun OAuth réalisé | ≤20 Orders ; ≤10 approbations/captures SANDBOX ; ≤10 refunds SANDBOX ; ≤40 relectures GET ; ≤30 événements QA/reprises ; ≤2 h active. Aucun Order LIVE. |
| R2 test dédié DCN | Compte Cloudflare attendu, 2 noms buckets public/private, préfixe `dcn-qa/<run-id>/`, droits bornés | À identifier ; aucun bucket consulté | ≤16 masters synthétiques, ≤16 extraits, ≤4 ZIP ; ≤2 Gio/source ensemble et ≤6 Gio cumulés objets/temporaires, ≤50 multipart au total, ≤200 lectures/listings ; ≤2 h active, rétention ≤7 jours sauf conservation explicite. |
| Safari macOS/iPhone physiques | Appareils, hôte HTTPS privé exact joignable, certificat de confiance, réseau autorisé | À identifier ; aucun port LAN/tunnel ouvert | ≤2 appareils, ≤2 h ; fichiers synthétiques ≤512 Mio/piste, album ≤2 Gio dans cette recette, ports/origines exacts préalablement approuvés ; aucune exposition Internet implicite. |

Ces plafonds sont des **propositions de périmètre**, pas du débit mesuré ni une autorisation d’atteindre le maximum. Commencer par le minimum suffisant, arrêter au plafond et conserver les preuves expurgées. Volumes R2 incluent versions conservées et archive ; jamais remplacer une ancienne acquisition pour économiser.

### Coûts et ressources

- Stripe TEST et PayPal SANDBOX : montants fictifs, aucun mouvement LIVE. Coût fournisseur de la recette financière : aucune facturation réelle attendue pour les paiements de test ; les conditions actuelles du compte restent à vérifier sans contrat nouveau. Temps/exécution/hébergement/Internet ne sont pas évalués dans un budget fourni.
- R2 : coûts de stockage/opérations/transfert **NON CHIFFRÉS**, conditions du compte/quotas gratuits inconnus. Plafond budgétaire autorisé actuellement : **0 EUR de nouvelle dépense engagée**. Obtenir la tarification/quotas réels et l’approbation d’un maximum avant toute opération susceptible de coûter. Ne pas créer un plan, bucket ou service payant implicitement.
- HTTPS et appareils : aucun hébergement, certificat payant ou tunnel créé. S’il faut un nouveau service, son nom/coût/réseau feront l’objet d’un complément ciblé ; une recette ne l’autorise pas par défaut.

## Réseau et événements : séparation explicite

### Stripe

Proposer, si compatible avec le sandbox nommé, **Stripe CLI authentifiée ciblée** transférant seulement les événements listés plus bas vers `http://127.0.0.1:3140/api/digital/webhooks/stripe`. Cette option évite de rendre l’Admin ou le site accessibles publiquement. Elle exige néanmoins l’accord sur l’authentification du CLI, son sandbox et les appels sortants. Le secret de signature du listener est distinct de la clé API et d’un endpoint Dashboard ; ne pas réutiliser un secret historique.

Le flux réel doit venir du checkout DCN de ce compte TEST. Un `stripe trigger`/fixture généré indépendamment est étiqueté simulateur et ne prouve pas le paiement DCN. La source, les métadonnées, le marchand, le mode TEST, le montant/devise, la session/PaymentIntent et l’attempt doivent concorder. La recette n’autorise pas un endpoint LIVE ni la relecture d’un événement client réel.

### PayPal

La livraison de vrais webhooks SANDBOX requiert une destination HTTPS **exacte et expressément autorisée**, recevant uniquement `/api/digital/webhooks/paypal`. Choix à décider : environnement QA HTTPS dédié déjà existant ou gateway privée approuvée avec exposition minimale de cette seule route. **Aucun de ces transports n’est créé/activé par DCN-1.2**, aucun tunnel public imposé.

L’application SANDBOX et l’ID du webhook sont ceux des transactions produites par DCN. L’événement authentique et ses headers servent à la vérification officielle avec cette application. Le simulateur PayPal a des limites de vérification : il reste une preuve de handler, jamais une signature fictive acceptée pour obtenir PASS. Ne pas affaiblir le contrôle si l’environnement refuse un scénario pending/denied/litige : noter NOT_RUN et son mécanisme manquant.

### R2

L’envoi multipart utilise l’abstraction actuelle avec droits d’écriture temporaires limités aux objets QA ; le CORS éventuel ne doit permettre que l’origine QA exacte et méthodes/headers nécessaires, après autorisation. L’upload/abort, transformations et ZIP concernent seulement les objets synthétiques marqués par run ID ; pas de bucket Production, copies client ou ancien master réel.

**Les téléchargements client restent derrière la gateway authentifiée propriétaire**, contrôlée à chaque GET/HEAD/Range, même lorsque son stockage amont est R2. Aucun lien master permanent ou présigné remis comme preuve de contrôle propriétaire. Une URL présignée est un jeton de possession partageable/réutilisable jusqu’à expiration ; elle ne remplace pas une revalidation ni une révocation serveur. Tester cache privé/no-store, HEAD non consommant, Range 206/single, autre utilisateur/refus, statut après suspension/révocation, timeout et reprise/expiration. Ne pas promettre rappel d’un fichier déjà conservé ou arrêt instantané d’un transfert engagé.

### Safari physique

`127.0.0.1` sur iPhone désigne l’iPhone : ce n’est pas l’adresse de la démo du Mac. Avant essai, approuver un hôte HTTPS privé exact avec certificat fiable, authentification normale et réseau/ports limités ; ne pas contourner TLS ni désactiver Auth. Le profil optimisé a besoin de HTTPS pour ses cookies sécurisés. Un viewport mobile/WebKit/Chrome/iAB reste **émulation**, pas iPhone.

## Procédure courte future pour Ludovic

Une fois l’hôte et les comptes de test expressément autorisés, communiquer l’URL QA non secrète et ouvrir une session fictive de propriétaire/Admin normale (secrets saisis en interface, jamais dans la réponse).

1. Ouvrir l’album 12 pistes, écouter première/dernière et changer de piste ; vérifier une seule lecture et durée réelle ≤60 s.
2. En Admin QA, importer le lot synthétique associé, interrompre/reprendre un seul fichier sans perdre les autres, vérifier début d’extrait/prix et aperçu. Aucun contenu client.
3. Ajouter piste/album, reconnecter/retrouver panier ; consentements distincts non précochés et prix QA ; paiement sur le prestataire **TEST/SANDBOX autorisé**, pas LIVE.
4. Recevoir le document QA selon politique proposée, retrouver la bibliothèque ; enregistrer une piste puis ZIP dans Téléchargements/Fichiers ; ouvrir l’archive et les 12 fichiers.
5. Reconnecter/retélécharger, tester téléchargement lent/Range et reprise ; observer une erreur reprenable sans second paiement.
6. Communiquer résultat humain exact par appareil/version Safari/fichier/scénario. Le PASS physique n’est acquis qu’après cette exécution réelle.

## Isolation, traçabilité et nettoyage

Base QA dédiée, faux emails `example.invalid`, données synthétiques, origin et compte marchand attendus, `DCN_MODE=TEST`, transport mail **capture**, pas de fixtures ni credentials Production. Garder `DCN_EXTERNAL_TEST_AUTHORIZED` fermé tant que l’autorisation groupée n’existe pas. Nouveaux paiements et réconciliation sont deux commandes distinctes : fermeture de l’un n’interdit pas le traitement déjà autorisé des engagements QA.

Après recette : fermer les nouveaux achats QA ; conserver registre, acquisition, snapshot et documents aussi longtemps que la revue les exige. Nettoyage seulement des objets temporaires listés du run avec dry-run, contre-listing et preuve absence de référence/lease. **Pas de sweep de bucket**, suppression de master acquis, tables, événement ou facture. Retirer/archiver le listener/endpoint de test créé pour ce run seulement si autorisé, sans toucher aux existants. Révoquer l’accès temporaire QA et supprimer copies de secrets uniquement par le mécanisme sécurisé approuvé ; aucun nettoyage global du profil historique.

## Recettes et PASS non acquis

Stripe TEST authentique, PayPal SANDBOX authentique, R2 distant, Safari macOS physique et iPhone physique : **NOT_RUN** dans ce lot sans l’autorisation supplémentaire. Transport email distant non inclus, LIVE/push/deploy interdits. Les limites opérationnelles/juridiques du document `DCN_1_2_LIMITS.md` ne sont pas levées par ces seules recettes.

---

## Demande DCN-1.1 reprise intégralement (contenu original)

Le fichier `DCN_1_1_EXTERNAL_RECIPES.md` est inclus à l’identique dans le ZIP ; il est également transcrit ci-dessous sans suppression. Les modalités et plafonds ci-dessus complètent cette demande, en particulier le listener local Stripe et le transport authentique PayPal. Ils ne modifient pas une autorisation : aucune n’a encore été donnée pour DCN distant.

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
