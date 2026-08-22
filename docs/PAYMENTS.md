# Paiements — Stripe Checkout et PayPal Orders V0.7.4

> V0.7.6 ajoute un moteur commun de remboursements Stripe Test / PayPal Sandbox et un registre séparé des disputes, reversals et chargebacks. La règle approuvée est stricte : `Payment` porte l'état financier ; un remboursement ou incident ne modifie jamais automatiquement `Order.status`. Les procédures opérateur sont décrites dans [PAYMENT_REFUND_RUNBOOK.md](./PAYMENT_REFUND_RUNBOOK.md).

## Statut de cette fondation

La V0.7.4 conserve Stripe Hosted Checkout et ajoute une intégration PayPal Orders v2 **uniquement en Stripe Test / PayPal Sandbox**. Elle ne constitue ni une ouverture des paiements au public, ni une autorisation de passer en production.

Les garde-fous par défaut sont :

- `PAYMENTS_ENABLED=false` ;
- `STRIPE_PAYMENTS_ENABLED=false` et `PAYPAL_PAYMENTS_ENABLED=false` ;
- `STRIPE_MODE=test` ;
- `PAYPAL_ENVIRONMENT=sandbox` ;
- aucune clé réelle dans Git, les logs, la documentation ou le navigateur ;
- aucune action sur Stripe live, Railway, OVH, le DNS ou un compte bancaire ;
- aucune commande locale considérée payée à partir d’un retour navigateur.

Tant que la QA sandbox et une validation humaine dédiée ne sont pas terminées, le parcours public conserve son comportement sans paiement. Une configuration incomplète doit échouer fermée et ne doit jamais révéler si une clé existe.

## Architecture multi-provider

Le domaine reste commun : une `Order` porte plusieurs tentatives `Payment`, chaque tentative identifie son `provider`, et les réponses ou webhooks signés sont normalisés avant une réconciliation PostgreSQL. Aucun provider ne modifie directement l’état client.

```text
Order AWAITING_PAYMENT
  ├─ Payment STRIPE → Hosted Checkout → webhook Stripe signé ┐
  └─ Payment PAYPAL → Orders v2 → capture + webhook signé    ├─ transaction + verrous
                                                            └─ Order PAYMENT_CONFIRMED + outbox idempotente
```

Une seule tentative active est autorisée **par Order et par provider**. Une seule réussite est autorisée globalement par Order. Le premier succès vérifié gagne sous verrou ; les tentatives sœurs ouvertes sont annulées localement. Une capture PayPal déclenchée depuis le navigateur relit et verrouille d’abord l’Order : si Stripe a déjà gagné, aucun appel PayPal n’est effectué. Un succès fournisseur réellement reçu malgré cette barrière n’est jamais masqué : il est enregistré en `REQUIRES_REVIEW` pour traitement humain, sans deuxième confirmation de l’Order ni deuxième notification.

## Choix d’intégration Stripe

LNX Studio retient :

1. la **Checkout Sessions API** ;
2. la page **Stripe-hosted Checkout** en mode paiement ponctuel ;
3. les moyens de paiement dynamiques pilotés dans le Dashboard Stripe ;
4. un webhook signé comme source de vérité du paiement ;
5. PostgreSQL comme registre métier des tentatives et événements traités.

Stripe recommande Checkout Sessions pour la plupart des intégrations : elle prend en charge le cycle de vie du paiement, l’authentification, l’expiration et les moyens de paiement avec moins de code spécifique. Le Payment Element reste une évolution possible si un paiement entièrement intégré au design devient nécessaire ; il devra alors utiliser Checkout Sessions. L’API Payment Intents ne doit pas être adoptée sans besoin explicite de contrôler soi-même tout l’état du checkout.

Références officielles :

- [Checkout Sessions API](https://docs.stripe.com/payments/checkout-sessions)
- [Checkout hébergé](https://docs.stripe.com/payments/checkout)
- [Stripe Elements](https://docs.stripe.com/payments/elements)
- [Bonnes pratiques du Payment Element](https://docs.stripe.com/payments/payment-element/best-practices)

## Versions verrouillées

La fondation est définie pour :

- `stripe` **22.5.0**, verrouillé exactement dans `package.json` et `package-lock.json` ;
- API Stripe **`2026-07-29.dahlia`** ;
- l’endpoint webhook serveur utilise la même version d’API.

Depuis `stripe-node` v12, chaque version du SDK est typée pour la version d’API courante au moment de sa publication. Une surcharge vers une autre version peut désaligner les types TypeScript. Toute montée de version doit donc rester une opération explicite : lecture des changelogs, sandbox, tests et contrôle des webhooks avant adoption.

Références officielles :

- [Versioning de l’API Stripe](https://docs.stripe.com/api/versioning?lang=node)
- [Politique de versioning des SDK](https://docs.stripe.com/sdks/versioning?lang=node)
- [`stripe-node` 22.5.0](https://github.com/stripe/stripe-node/releases/tag/v22.5.0)

## Configuration et secrets

Variables prévues :

| Variable | Valeur de fondation | Exposition autorisée |
| --- | --- | --- |
| `PAYMENTS_ENABLED` | `false` | serveur uniquement ; garde fonctionnelle |
| `PAYMENT_DEPLOYMENT_ENV` | `development` | `development` ou `staging`, jamais production en V0.7.4 |
| `PAYMENT_STAGING_CONFIRM` | vide | confirmation non secrète exigée en staging |
| `STRIPE_PAYMENTS_ENABLED` | `false` | activation explicite du seul adapter Stripe |
| `STRIPE_MODE` | `test` | serveur uniquement ; `live` est refusé à ce stade |
| `STRIPE_SECRET_KEY` | vide dans le dépôt | secret serveur sandbox, jamais journalisé |
| `STRIPE_WEBHOOK_SECRET` | vide dans le dépôt | secret `whsec_…` propre à l’endpoint sandbox/CLI |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | facultative et vide | uniquement si une future UI Elements l’exige |
| `STRIPE_DIAGNOSTIC_CONFIRM` | vide par défaut | confirmation locale non secrète du diagnostic réseau Stripe Test |
| `PAYMENT_QA_CONFIRM` | vide par défaut | confirmation locale non secrète de la QA paiement sur base jetable |
| `PAYPAL_PAYMENTS_ENABLED` | `false` | activation explicite du seul adapter PayPal |
| `PAYPAL_ENVIRONMENT` | `sandbox` | `live` et `production` sont refusés |
| `PAYPAL_CLIENT_ID` | vide | secret/configuration serveur Sandbox |
| `PAYPAL_CLIENT_SECRET` | vide | secret serveur Sandbox |
| `PAYPAL_WEBHOOK_ID` | vide | identifiant serveur de l’endpoint webhook Sandbox |

Préfixes Stripe à reconnaître sans jamais publier les valeurs :

- sandbox : `pk_test_`, `rk_test_`, `sk_test_` ;
- live : `pk_live_`, `rk_live_`, `sk_live_` ;
- signature webhook : `whsec_` — ce n’est pas une clé API et sa valeur diffère pour chaque endpoint et chaque mode.

Le Checkout hébergé ne nécessite pas de clé publiable côté navigateur. La clé serveur doit rester dans `.env.local` ignoré ou dans le coffre à secrets de l’hébergeur. Une clé restreinte `rk_*` avec les permissions minimales est préférable à une clé secrète illimitée pour un nouvel usage. Pour le flux actuel, elle doit autoriser la création et la lecture des Checkout Sessions ainsi que la lecture des PaymentIntents et PaymentMethods nécessaires à la réconciliation ; aucun droit Balance, Customer, remboursement ou administration du compte n’est requis. Une valeur `sk_live_`, `rk_live_` ou `pk_live_` doit être refusée lorsque `STRIPE_MODE=test`.

Ne jamais :

- demander à quelqu’un de coller une clé dans le chat ;
- imprimer une clé, même partiellement, dans un log ou un rapport ;
- transmettre `STRIPE_SECRET_KEY` ou `STRIPE_WEBHOOK_SECRET` au client ;
- mettre une clé, un email ou une donnée personnelle dans une clé d’idempotence ou dans les metadata Stripe ;
- confondre le secret produit par `stripe listen` avec celui d’un endpoint créé dans le Dashboard.

Références officielles :

- [Clés API Stripe](https://docs.stripe.com/keys)
- [Protection des clés secrètes](https://docs.stripe.com/keys-best-practices)

## Prix et création d’une Checkout Session

Le navigateur ne choisit jamais le montant, la devise, l’objet facturé ni l’éligibilité. Il transmet au plus l’identifiant opaque d’une commande appartenant au membre authentifié.

### Commande finalisée avant paiement

Une `Order` doit exister dans PostgreSQL **avant** toute tentative de paiement. La fondation V0.7.0 n’ouvre Checkout que pour une commande personnelle déjà finalisée, appartenant à l’acteur authentifié, sans contrat commercial, et dont le statut est exactement `AWAITING_PAYMENT`. Une commande encore en brouillon, une commande introuvable ou un prix fourni par le navigateur ne peut pas créer de Session.

Le prix payable provient exclusivement du snapshot serveur enregistré sur cette commande :

- `basePriceCents` ;
- `coverPriceCents` ;
- `priorityPriceCents` ;
- `totalCents` ;
- `currency` ;
- `pricingVersion`.

Le serveur valide la cohérence arithmétique de ce snapshot et sa conformité au registre tarifaire versionné. Chaque version publiée doit rester dans ce registre aussi longtemps qu’une commande correspondante peut être payable : changer l’offre courante ne réécrit donc pas une ancienne commande. Il réserve ensuite un `Payment` local avec `amountCents`, `currency` et `pricingVersion` **avant** l’appel Stripe. Cette copie devient le contrat de la tentative en cours : une modification ultérieure de la commande ne doit ni modifier silencieusement son montant, ni réutiliser cette tentative avec d’autres paramètres. Une version inconnue ou un conflit de snapshot échoue fermé et exige une décision métier explicite.

Le service est ouvert au **propriétaire authentifié, actif et vérifié** de l’Order, quel que soit son rôle applicatif. La QA locale V0.7.4 reste strictement confinée au runtime `lnx-studio-v074-test`, aux confirmations explicites et aux modes Stripe Test/PayPal Sandbox. Elle ne rend ni `lnxbeats.fr`, ni un environnement Live payables.

Le serveur doit, au moment de créer une session :

1. exiger un compte actif, vérifié et propriétaire de la commande ;
2. relire la commande et son état dans PostgreSQL ;
3. vérifier qu’elle est réellement payable et qu’aucun paiement réussi n’existe déjà ;
4. recalculer le montant en unité mineure depuis les snapshots et règles tarifaires serveur ;
5. imposer `EUR` et vérifier un montant entier strictement positif ;
6. créer ou réutiliser une tentative locale avant l’appel Stripe ;
7. envoyer à Stripe le montant serveur, jamais un montant reçu du client ;
8. associer seulement des identifiants internes non sensibles via `client_reference_id` et des metadata bornées ;
9. enregistrer l’identifiant et l’expiration de la Checkout Session renvoyée par Stripe ;
10. rediriger vers l’URL Stripe sans exposer la clé serveur.

Pour une commande de création, le tarif reste plafonné par les règles métier existantes. Une extension de droits commerciaux constitue un objet et un paiement distincts ; son montant ne doit jamais être fusionné implicitement avec celui de la création.

La création de session doit être protégée contre les doubles clics et les requêtes concurrentes. Une tentative déjà payée n’est jamais repassée à un état antérieur.

### Périmètre commercial volontairement fermé

La Session contient uniquement les lignes déterministes produites par le snapshot serveur : création musicale, cover si elle a été commandée, et priorité si elle a été commandée. La V0.7.0 n’active ni codes promotionnels, ni remises libres, ni pourboires/dons, ni frais ou adresse de livraison, ni quantités modifiables, ni ajout d’option depuis Checkout, ni tarification adaptative. Chacun de ces sujets exigera une règle métier, des tests et une validation dédiés avant activation.

### PCI, CSP, CSRF et limitation de débit

Stripe-hosted Checkout reçoit directement les données de carte : LNX Studio ne construit aucun champ carte, ne reçoit aucun numéro complet, CVC ou date d’expiration et ne les persiste jamais. Ce choix réduit le périmètre PCI, mais ne dispense pas l’exploitant de ses obligations ni de vérifier son éligibilité au questionnaire SAQ A applicable. Référence : [guide de sécurité et conformité PCI Stripe](https://docs.stripe.com/security/guide).

Le simple redirect vers Checkout ne justifie pas d’affaiblir globalement la Content Security Policy. Les `success_url` et `cancel_url` proviennent d’une origine serveur canonique. Si une future version embarque Stripe.js ou Elements, elle devra ajouter uniquement les origines Stripe officiellement requises aux directives `script-src`, `frame-src` et `connect-src`, sans introduire `unsafe-inline` par facilité. Référence : [CSP recommandée par Stripe](https://docs.stripe.com/security/guide#content-security-policy).

La création de Checkout est une mutation authentifiée et protégée par le contrôle same-origin/CSRF de l’architecture des commandes. Le webhook suit une frontière différente : il n’accepte ni session navigateur ni `Origin` comme preuve, et authentifie le corps brut uniquement par `stripe-signature`.

Le service borne actuellement la création à **10 demandes par acteur sur 10 minutes**, côté serveur, avant l’accès Stripe. Cette protection complète les verrous et l’idempotence ; elle ne remplace ni la surveillance ni une limitation distribuée adaptée à une future ouverture publique. Le webhook n’utilise pas ce quota navigateur : sa surface est défendue par la taille maximale du corps, la signature, le mode test, la déduplication et les transitions transactionnelles.

## Modèle `Payment` et événements métier

Le modèle local représente une **tentative de paiement**, pas une preuve bancaire brute. La migration additive V0.7.0 ne réalise aucun backfill et rattache chaque `Payment` à une `Order` avec suppression restreinte. V0.7.2 remplace le flux de droits runtime historique par `RightsRequest`, mais n’ajoute aucun paiement de droits. Une future prise en charge exigera une relation explicite dédiée à la demande contractuelle ; elle ne doit pas être simulée dans l’`orderId` du paiement initial.

Le registre contient :

- une clé primaire interne ;
- `orderId`, vers la commande concernée ;
- `provider=STRIPE|PAYPAL` et `mode=TEST|LIVE` (V0.7.4 n’autorise que `TEST`) ;
- `status`, selon l’énumération ci-dessous ;
- `amountCents`, `currency` et `pricingVersion`, tous issus du serveur ;
- une clé d’idempotence unique ;
- `providerCheckoutId` et `providerPaymentId`, uniques par fournisseur lorsqu’ils existent ;
- `paymentMethod=CARD|PAYPAL|WERO|OTHER` lorsqu’il est connu ;
- `failureCode`, sans message sensible ;
- l’expiration, la réussite, l’échec, l’annulation, le remboursement et les dates de création/mise à jour ;
- le montant remboursé, borné entre zéro et le montant payé ;
- les informations de diagnostic non sensibles strictement nécessaires.

> `provider=PAYPAL` identifie l’adapter PayPal Orders v2. `paymentMethod=PAYPAL` identifie le moyen effectivement capturé. La présence de `WERO` dans `PaymentMethod` ne signifie pas qu’il est activé ou promis.

Les statuts prévus sont `CREATED`, `PENDING`, `SUCCEEDED`, `FAILED`, `CANCELED`, `EXPIRED`, `REFUND_PENDING`, `PARTIALLY_REFUNDED`, `REFUNDED` et `REQUIRES_REVIEW`. Le flux nominal reste monotone :

```text
CREATED → PENDING ──────→ SUCCEEDED → REFUND_PENDING → PARTIALLY_REFUNDED / REFUNDED
              ├────────→ FAILED
              ├────────→ CANCELED
              ├────────→ EXPIRED
              └────────→ REQUIRES_REVIEW
```

`SUCCEEDED` est définitif quant au fait que le paiement a réussi ; un remboursement ultérieur ne réécrit pas cette histoire mais fait progresser la tentative vers ses statuts de remboursement. `FAILED`, `CANCELED` ou `EXPIRED` clôt normalement la tentative, pas nécessairement la commande : une nouvelle tentative, avec un nouvel identifiant et une nouvelle clé d’idempotence, peut être créée si la commande reste payable. Une exception bornée existe pour le code `STRIPE_PAYMENT_ATTEMPT_FAILED` : il représente un refus immédiat dans une Checkout Session encore ouverte. Ce paiement reste la tentative active et le bouton reprend strictement la même Session ; aucune deuxième Session ne peut être créée avant expiration ou échec terminal. Une réussite Stripe authentique reçue tardivement pour les mêmes identifiants ne doit jamais être ignorée au seul motif qu’un événement d’échec est arrivé avant elle. `REQUIRES_REVIEW` bloque toute automatisation jusqu’à une réconciliation sûre.

La base impose notamment une seule tentative active par couple `(orderId, provider)` (`CREATED`, `PENDING`, `REQUIRES_REVIEW`, ou Stripe `FAILED` avec le code retryable exact ci-dessus) et un seul paiement réussi par commande, tous providers confondus. Les contraintes vérifient aussi les montants, la devise sur trois lettres, les identifiants non vides et la cohérence des timestamps. Ces protections complètent, sans remplacer, les transactions applicatives.

Les transitions visibles par le membre doivent aussi produire un événement métier horodaté, distinct du payload Stripe. La timeline ne doit jamais exposer d’identifiant Stripe sensible, de secret, de cookie ou de détail bancaire. Le statut `AWAITING_PAYMENT` de la commande ne prouve pas un paiement ; seule une réconciliation serveur signée peut faire progresser le métier.

Le modèle `ProviderEvent` mémorise le fournisseur, `event.id` avec une contrainte unique, le type, le mode, l’identifiant de l’objet Stripe concerné, le paiement local éventuellement associé, la date de réception/création et la date de traitement. Son résultat est `PROCESSED`, `IGNORED` ou `REQUIRES_REVIEW`. La conservation du payload brut complet n’est pas requise par défaut.

## Idempotence et concurrence

Tous les `POST` Stripe de création ou mutation utilisent une clé d’idempotence. Une stratégie adaptée est :

```text
checkout-session:<payment-id-interne>
```

La clé est persistée avant l’appel. Un retry réseau de la même opération réutilise exactement la même clé et les mêmes paramètres. Une tentative volontairement nouvelle ou une requête corrigée utilise une nouvelle clé.

Stripe conserve le premier résultat associé à une clé, y compris certains échecs, puis peut supprimer la clé après au moins 24 heures. Réutiliser une clé avec d’autres paramètres est une erreur. La base locale reste donc également responsable des contraintes uniques et d’une transition transactionnelle concurrent-safe.

Pour les webhooks :

- dédupliquer d’abord sur `event.id` ;
- tolérer deux événements différents représentant le même résultat métier ;
- vérifier l’état courant avant toute transition ;
- ne jamais supposer l’ordre d’arrivée ;
- récupérer la Session depuis Stripe si l’événement ne suffit pas à établir l’état actuel ;
- rendre le fulfillment idempotent, y compris sous deux appels simultanés.

Références officielles :

- [Requêtes idempotentes](https://docs.stripe.com/api/idempotent_requests?lang=node)
- [Gestion des erreurs et retries](https://docs.stripe.com/error-low-level)
- [Doublons et ordre des webhooks](https://docs.stripe.com/webhooks#handle-duplicate-events)

## Webhook Stripe

Route réservée :

```text
POST /api/payments/stripe/webhook
```

Cette route n’est pas une action utilisateur. Elle n’utilise ni session navigateur ni contrôle `Origin` comme preuve d’authenticité : elle exige la signature Stripe.

Avec le Next.js App Router :

1. lire `stripe-signature` ;
2. lire **une seule fois** le flux d’octets non modifié dans un `Buffer` borné à 256 Kio ;
3. ne jamais appeler `request.json()` avant la vérification ;
4. appeler `stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET)` ;
5. répondre `400` si le corps, la signature ou le secret ne permettent pas la vérification ;
6. vérifier que `event.livemode` correspond à `STRIPE_MODE` ;
7. enregistrer/dédupliquer et appliquer une transition courte ;
8. répondre rapidement en `2xx`, puis déléguer les traitements lourds.

Stripe signe le corps octet pour octet : parser puis re-sérialiser le JSON invalide la signature. Les endpoints sandbox, CLI et live ont chacun leur propre secret `whsec_…`.

Événements Checkout requis :

| Événement | Effet local attendu |
| --- | --- |
| `checkout.session.completed` | Réconcilier la Session. Confirmer uniquement si `payment_status` autorise le fulfillment ; sinon conserver l’attente. |
| `checkout.session.async_payment_succeeded` | Confirmer le paiement différé et déclencher le fulfillment une seule fois. |
| `checkout.session.async_payment_failed` | Marquer la tentative échouée sans inventer une réussite ni supprimer la commande. |
| `checkout.session.expired` | Marquer la tentative expirée et permettre une nouvelle tentative si le métier l’autorise. |
| `payment_intent.payment_failed` | Enregistrer le refus immédiat en `FAILED`, sans confirmer la commande et sans créer une deuxième Session ; la reprise réutilise la Session ouverte. |

Ne pas ajouter `payment_intent.succeeded` comme second déclencheur métier pour le même Checkout sans nécessité démontrée. Des événements de remboursement ou de litige seront ajoutés au sprint qui implémentera réellement ces opérations.

Avant de confirmer un succès, le serveur relit la Checkout Session Stripe avec `payment_intent.payment_method` développé, hors transaction PostgreSQL. Il vérifie à nouveau l’identifiant, les metadata internes, le montant, la devise, le mode Test et le statut `succeeded`, puis enregistre `CARD`, `PAYPAL`, `WERO` ou `OTHER` selon le type réellement retourné. `payment_method_types` n’est jamais utilisé pour deviner le moyen choisi : il ne décrit que les moyens proposés.

Un refus instantané de carte peut produire `payment_intent.payment_failed` tout en laissant la même Checkout Session ouverte afin que l’utilisateur corrige son moyen de paiement. La fondation enregistre alors `FAILED` avec le code borné `STRIPE_PAYMENT_ATTEMPT_FAILED`, conserve la commande en `AWAITING_PAYMENT` et considère encore cette ligne comme l’unique tentative active. Une reprise relit la même `providerCheckoutId` et redirige vers la même Session ; elle ne crée aucun nouveau Payment ni aucun nouveau Checkout. Un succès ultérieur de cette Session peut promouvoir la même ligne vers `SUCCEEDED`. Son expiration la transforme en `EXPIRED`; un échec asynchrone terminal remplace le code retryable par `STRIPE_ASYNC_PAYMENT_FAILED`. Ce n’est qu’après l’un de ces événements terminaux qu’une nouvelle tentative peut être créée.

Références officielles :

- [Recevoir et sécuriser les webhooks](https://docs.stripe.com/webhooks?lang=node)
- [Corps brut et signatures](https://docs.stripe.com/webhooks/signature?lang=node)
- [Exemple officiel Next.js App Router](https://github.com/stripe/stripe-node/blob/master/examples/webhook-signing/nextjs/app/api/webhooks/route.ts)
- [Fulfillment Checkout](https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted)
- [Types d’événements](https://docs.stripe.com/api/events/types)

## Expiration d’une session

Une Checkout Session expire après 24 heures par défaut. `expires_at` peut être fixé entre 30 minutes et 24 heures après sa création. Pour une commande créative sans réservation de stock rare, la fondation conserve la valeur Stripe par défaut et stocke l’échéance renvoyée.

Une session expirée ne doit pas annuler automatiquement la commande. Elle clôt seulement la tentative concernée. Une future réservation de stock pourra justifier une fenêtre plus courte et une politique dédiée.

De même, le clic sur le lien d’annulation Checkout, l’expiration d’une Session ou l’annulation métier d’une commande ne constitue **jamais** un remboursement. Aucun argent n’a nécessairement été capturé dans ces cas. Un remboursement ne peut partir que d’un paiement effectivement `SUCCEEDED`, par un futur workflow authentifié, audité et idempotent faisant progresser `REFUND_PENDING` vers `PARTIALLY_REFUNDED` ou `REFUNDED`. La V0.7.0 n’exécute aucun remboursement.

Références officielles :

- [Cycle de vie et expiration Checkout](https://docs.stripe.com/payments/checkout/how-checkout-works)
- [Créer une Checkout Session](https://docs.stripe.com/api/checkout/sessions/create)

## Moyens de paiement

### Cartes

La sandbox doit couvrir un paiement réussi, un refus, une authentification 3D Secure et les retours/annulations à partir des scénarios officiels Stripe. Aucun numéro de carte réel ne doit être utilisé ou stocké. La documentation de test officielle reste la seule source des valeurs de simulation : [Tester une intégration Stripe](https://docs.stripe.com/testing).

### PayPal via Stripe

PayPal via Stripe est disponible pour un compte Stripe établi en France et accepte notamment l’euro. Checkout et Elements sont compatibles, mais l’activation live exige une action dans le Dashboard, la connexion d’un compte PayPal et le choix du mode de règlement.

Cette fondation ne prétend pas que PayPal est activé sur le compte LNX Beats. Les moyens de paiement dynamiques doivent l’afficher uniquement si Stripe le juge disponible pour la Session.

Références officielles :

- [Paiements PayPal](https://docs.stripe.com/payments/paypal)

### PayPal Orders API directe

V0.7.4 ajoute parallèlement un adapter PayPal direct, limité à `https://api-m.sandbox.paypal.com`. Le navigateur ne transmet que le numéro d’Order dans la route et le token PayPal opaque lors du retour ; le montant, la devise, `paymentId`, `return_url` et `cancel_url` proviennent du serveur.

Flux prévu :

1. `POST /api/orders/[orderNumber]/payments/paypal/checkout` réserve la tentative locale sous verrou ;
2. le serveur crée ou relit une Order PayPal avec `PayPal-Request-Id=paypal-order:<paymentId>` ;
3. le client est redirigé vers l’approval URL Sandbox ;
4. au retour, `POST /api/orders/[orderNumber]/payments/paypal/capture` verrouille d’abord l’Order et refuse tout appel fournisseur si un autre paiement a déjà gagné ;
5. le serveur capture avec `PayPal-Request-Id=paypal-capture:<paymentId>` et vérifie Order, capture, `custom_id`, montant et devise ;
6. `POST /api/payments/paypal/webhook` vérifie les cinq en-têtes PayPal, l’événement brut exact et le `webhook_id` par l’API officielle, puis réconcilie `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.COMPLETED` ou `PAYMENT.CAPTURE.DECLINED` ; un événement Capture sans `custom_id` est corrélé par l’Order PayPal persistée ;
7. `ProviderEvent(provider=PAYPAL, providerEventId)` déduplique durablement les replays.

Le corps webhook est borné à 256 Kio. `paypal-cert-url` doit être HTTPS, appartenir au domaine API Sandbox et viser `/v1/notifications/certs/`; l’algorithme admis est `SHA256withRSA`. Une signature invalide, un endpoint live, une preuve de montant/devise divergente ou une configuration incomplète échoue fermé. Le payload brut, la signature, les credentials OAuth et les URLs d’approbation ne sont jamais journalisés.

Références officielles :

- [PayPal Orders v2](https://developer.paypal.com/docs/api/orders/v2/)
- [Idempotence REST PayPal](https://developer.paypal.com/api/rest/reference/idempotency/)
- [Vérification des signatures webhook](https://developer.paypal.com/api/rest/webhooks/rest/)
- [Événements de paiement PayPal](https://developer.paypal.com/api/rest/webhooks/event-names/)

### Wero

La documentation Stripe actuelle présente Wero avec accès contrôlé/preview. Les comptes français font partie des localisations professionnelles listées, mais les clients éligibles sont actuellement indiqués en Allemagne, en EUR. Checkout en mode paiement et Elements sont annoncés, pas les modes abonnement/setup ni Express Checkout Element.

LNX Studio garde donc une architecture compatible avec les moyens dynamiques, mais **ne promet pas Wero**, ne le hardcode pas et ne l’affiche pas comme disponible avant l’accès Stripe et une validation d’éligibilité dédiés.

Référence officielle : [Paiements Wero](https://docs.stripe.com/payments/wero).

## Taxes, facture et reçu

La V0.7.0 n’active ni Stripe Tax, ni calcul automatique de TVA, ni collecte d’identifiant fiscal, ni génération de facture, ni workflow applicatif de reçu. Une confirmation Checkout ou le statut `SUCCEEDED` prouve un événement de paiement dans le registre technique ; ce n’est pas à lui seul une facture conforme.

Stripe peut envoyer un reçu selon la configuration email du Dashboard et le moyen de paiement, mais LNX Studio ne doit ni le promettre ni le présenter comme une facture légale. Les règles de TVA, numérotation, mentions obligatoires, avoirs, factures et conservation comptable seront définies avec validation juridique/comptable avant toute ouverture live.

## Absence de couplage bancaire

L’intégration ne contient aucun IBAN et ne dépend ni de BoursoBank ni d’un autre établissement bancaire particulier. Le compte bancaire de règlement se configure uniquement dans Stripe, hors du dépôt et hors du runtime applicatif. Changer de banque ne doit exiger aucune modification du code ou du modèle métier.

## QA locale avec Stripe CLI

Les validations automatisées destructives utilisent exclusivement la cible jetable
`lnx-studio-v074-test`, un runtime PostgreSQL loopback sur le port `51254` et
une origine HTTP loopback distincte du port personnel `3000`. La preuve Prisma est
obligatoire et doit correspondre exactement à `DATABASE_URL`. Elles exigent en plus
`NODE_ENV=test`, `EMAIL_PROVIDER=capture` et
`PAYMENT_QA_CONFIRM=run-v074-sandbox-payment-qa`. La base
`lnx-studio-local-preview` est explicitement refusée.

Le parcours local doit être servi sur un port QA dédié avec la preuve de base jetable et `PAYMENTS_ENABLED=true`. Chaque provider exige aussi son flag explicite. En staging, le runtime accepte uniquement Railway `staging`, une origine HTTPS canonique, `PAYMENT_DEPLOYMENT_ENV=staging` et `PAYMENT_STAGING_CONFIRM=payments-staging-sandbox-approved`; Stripe reste Test et PayPal Sandbox. Tout environnement production ou toute configuration ambiguë est refusé.

Le diagnostic réseau est séparé des tests mocks et s'exécute uniquement après la
confirmation non secrète prévue :

```bash
STRIPE_DIAGNOSTIC_CONFIRM=run-stripe-test-diagnostic npm run stripe:check
```

Il vérifie seulement l'accès au compte sandbox, sans afficher de clé, d'identifiant
de compte, de solde ou de réponse fournisseur.

Installation officielle sur macOS :

```bash
brew install stripe/stripe-cli/stripe
stripe login
```

Écoute locale limitée aux événements utiles :

```bash
stripe listen \
  --latest \
  --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired,payment_intent.payment_failed \
  --forward-to http://localhost:31740/api/payments/stripe/webhook
```

Le port `31740` est le port HTTP exact dédié à la QA paiement jetable V0.7.4. Le runtime QA, `AUTH_URL`/`SITE_URL` et le listener doivent tous employer **exactement** `http://localhost:31740`. Cette identité est opérationnelle, pas cosmétique : sur macOS, Next peut résoudre `localhost` vers `[::1]`; un listener dirigé vers `127.0.0.1` reçoit alors un refus de connexion même si le port paraît identique. Vérifier systématiquement les HTTP `2xx` du listener. Après tout redémarrage de `stripe listen`, recopier son nouveau secret uniquement dans l’environnement QA puis redémarrer Next avant de reprendre un parcours.

Il ne faut jamais transférer ces événements vers le port personnel `3000`, ni vers `lnx-studio-local-preview`. Stripe CLI 1.50 utilise `--latest` pour demander la dernière version d’événement ; le webhook refuse ensuite toute valeur `event.api_version` différente de `2026-07-29.dahlia`. Une évolution future échoue donc de manière fermée jusqu’à la mise à jour explicite du SDK et des tests.

Le secret affiché par `stripe listen` est utilisé uniquement dans `.env.local` pour cette session de QA. Il ne doit pas être copié dans le dépôt ni confondu avec le secret d’un endpoint Dashboard.

`stripe trigger <event>` vérifie le transport et la signature, mais ne remplace pas un vrai parcours sandbox lié à une commande QA. La validation complète doit aussi couvrir :

- montant calculé côté serveur ;
- double clic et deux créations concurrentes ;
- rediffusion du même événement ;
- arrivée des événements dans un ordre différent ;
- paiement réussi, refusé, différé, échoué et expiré ;
- session Stripe liée à la bonne commande sans IDOR ;
- retour succès sans webhook, puis webhook retardé ;
- absence de transition si signature ou mode invalide ;
- aucune donnée de la base personnelle dans les tests automatisés.

Références officielles :

- [Installer Stripe CLI](https://docs.stripe.com/stripe-cli/install)
- [Utiliser Stripe CLI et transférer les événements](https://docs.stripe.com/stripe-cli/use-cli)
- [Clés et permissions de Stripe CLI](https://docs.stripe.com/stripe-cli/keys)

## Ordre de QA staging V0.7.4

Cette procédure est humaine et future ; aucun de ces appels n’est exécuté pendant la construction de la feature.

1. Déployer d’abord avec `PAYMENTS_ENABLED=false`, les deux flags provider à `false` et les secrets absents ; `/api/health` doit rester `200` avec les providers désactivés.
2. Créer une base et des Orders staging strictement fictives, activer le transport notification `capture`, puis renseigner `PAYMENT_DEPLOYMENT_ENV=staging` et la confirmation non secrète.
3. Configurer Stripe Test, son endpoint signé et `STRIPE_PAYMENTS_ENABLED=true`; valider succès, refus, reprise, annulation, expiration et replay avant d’activer PayPal.
4. Créer une application **PayPal Developer Sandbox**, un compte business sandbox et un compte buyer sandbox. Ne jamais utiliser de compte ou moyen de paiement réel.
5. Configurer les trois valeurs serveur PayPal et l’endpoint `POST /api/payments/paypal/webhook` pour les quatre événements allowlistés, puis activer `PAYPAL_PAYMENTS_ENABLED=true`.
6. Valider create Order, approval, cancel, capture, webhook, replay, amount/currency mismatch et IDOR avec des Orders séparées.
7. Ouvrir Stripe et PayPal sur la même Order fictive ; confirmer Stripe, puis vérifier qu’une capture PayPal ultérieure est refusée avant l’appel provider et qu’un éventuel événement tardif est quarantiné sans deuxième notification.
8. Vérifier les deux notifications logiques en transport capture uniquement, puis nettoyer les fixtures PostgreSQL et les objets sandbox ciblés selon leur runbook, sans toucher aux données personnelles.

La QA s’arrête au premier écart d’identifiant, montant, devise, signature, environnement ou compteur. Elle ne bascule jamais Stripe Live ni PayPal Live.

## Santé et observabilité

`GET /api/health` expose uniquement un résumé agrégé du paiement : fournisseur, activation, configuration complète ou non, mode et version d’API. Il ne doit jamais renvoyer la valeur d’une clé, l’identifiant d’un compte Stripe, un secret webhook, un détail de paiement, ni le message brut d’une erreur fournisseur. Une configuration invalide rend la santé indisponible sans préciser quel secret manque.

Les logs paiement sont structurés et minimaux. Ils peuvent contenir l’événement applicatif, les identifiants internes de `Order`/`Payment`, l’identifiant d’événement fournisseur nécessaire à la déduplication, un statut ou un résultat borné et, pour un diagnostic autorisé, un Request ID Stripe non secret. Ils ne doivent jamais contenir le corps brut du webhook, les headers de signature, cookies, tokens, clés, URL Checkout complète, email, metadata libres, données de carte ou réponse fournisseur intégrale.

Avant une ouverture publique, la supervision devra au minimum signaler :

- les échecs répétés de signature et les réponses webhook `5xx` ;
- les événements toujours rediffusés ou durablement non traités ;
- les transitions `REQUIRES_REVIEW` et les incohérences montant/devise/identifiants ;
- les paiements `CREATED` ou `PENDING` anormalement anciens ;
- une hausse des refus de création, du quota ou des erreurs Stripe ;
- les écarts entre Sessions Stripe, `ProviderEvent`, `Payment` et statut de commande lors d’une réconciliation planifiée.

Un doublon signé correctement dédupliqué peut être normal et ne doit pas, seul, déclencher une alerte critique. À l’inverse, l’absence de secrets dans les logs doit faire partie des tests et revues d’exploitation.

## Runbooks de sécurité

### Webhook en échec

1. Ne jamais marquer une commande payée depuis la page de retour.
2. Vérifier dans Workbench le statut de livraison et le code HTTP sans afficher les secrets.
3. Vérifier l’horloge serveur, la route, le corps brut, le mode et le bon secret d’endpoint.
4. Corriger la cause puis renvoyer l’événement depuis Workbench ou avec `stripe events resend`.
5. Laisser la déduplication par `event.id` rendre la relance sûre.
6. Réconcilier la Checkout Session via l’API si des événements ont été reçus hors ordre.

Stripe réessaie automatiquement les webhooks live jusqu’à trois jours avec backoff exponentiel ; une réponse rapide en `2xx` évite des duplications inutiles.

### Suspicion de double paiement

1. Geler toute nouvelle tentative pour la commande concernée sans supprimer les données.
2. Comparer les enregistrements locaux uniques, Checkout Sessions et PaymentIntents dans Stripe.
3. Vérifier la clé d’idempotence, les Request IDs et les événements traités.
4. Ne jamais rembourser automatiquement sur une simple suspicion.
5. Faire valider humainement le paiement canonique puis lancer le futur workflow de remboursement audité.
6. Ajouter un test de non-régression avant réouverture.

### Fuite de clé

1. Considérer la clé comme compromise ; ne pas la recopier dans un ticket, chat ou rapport.
2. Désactiver `PAYMENTS_ENABLED` et bloquer le trafic de paiement.
3. Faire expirer ou tourner immédiatement la clé dans Stripe ; faire de même pour le secret webhook s’il est concerné.
4. Mettre à jour uniquement le coffre à secrets ou `.env.local`, puis redémarrer le runtime.
5. Examiner les request logs Stripe et l’historique Git ; si une valeur a été commitée, révoquer d’abord puis traiter l’historique séparément.
6. Relancer le scan de secrets et les tests sandbox avant réactivation.

## Gates de production

Le passage en production n’appartient pas à V0.7.4. Il nécessitera un sprint et une validation séparés comprenant au minimum :

- activation du compte Stripe, informations légales et compte de règlement validés ;
- clés live et webhook live dans le coffre Railway, jamais dans `.env.local` partagé ou Git ;
- endpoint HTTPS public créé avec l’API `2026-07-29.dahlia` et uniquement les événements requis ;
- vérification des méthodes réellement activées, des CGV, de la confidentialité, des remboursements, taxes et factures ;
- test live contrôlé avec un montant minimal autorisé, validation humaine et procédure de remboursement ;
- monitoring, alertes, réconciliation et runbooks exercés ;
- compte marchand PayPal production, application Live, credentials et webhook Live distincts, jamais réutilisés depuis Sandbox ;
- stratégie explicite de remboursement/réconciliation d’un succès tardif entre providers ;
- maintien vérifié de l’override `deepmerge-ts` corrigé tant que Prisma 7 ne l’intègre pas directement ;
- maintien du Legal Review Gate pour les droits et contrats ;
- modification volontaire du code qui refuse actuellement Stripe Live, PayPal Live et `PAYMENT_DEPLOYMENT_ENV=production`, suivie d’une nouvelle revue ;
- bascule des flags provider seulement après ces preuves, puis de `PAYMENTS_ENABLED=true`, jamais l’inverse.

Le parcours client V0.7.1, ses règles de reprise, d’édition et de confirmation sont décrits dans [CHECKOUT.md](CHECKOUT.md). Toute activation publique ou Live demeure un sprint séparé.
