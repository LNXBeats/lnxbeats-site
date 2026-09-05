# Runbook remboursements et incidents de paiement — V0.7.6

## Périmètre et règle métier

Ce runbook couvre uniquement Stripe Test et PayPal Sandbox. Il ne constitue pas une autorisation d'activer Stripe Live, PayPal Live ou un environnement de production.

## Production Live — fermée par défaut

Le Checkout Live peut être activé séparément. Un remboursement Live exige simultanément `LIVE_REFUNDS_ENABLED=true`, `LIVE_REFUNDS_PRODUCTION_CONFIRM=enable-production-live-refunds`, un runtime Railway Production strict, l’armement Payments Production et le provider Live du paiement réellement gagnant. Le flag seul ne suffit jamais. Lorsque ce gate composé est fermé, l’Admin conserve la lecture des paiements, tentatives, incidents et audits, tandis que les demandes et réconciliations Live sont indisponibles. Les webhooks signés décrivant un remboursement ou un litige externe continuent d’être reçus et rapprochés ; ils ne constituent pas une autorisation d’émettre une nouvelle mutation financière.

Le parcours TEST/Sandbox décrit ci-dessous reste disponible. Le code B3 interdit désormais toute réémission aveugle : une tentative ambiguë sans `providerRefundId` passe en revue et sa réconciliation n’émet pas un second ordre financier. L’activation Production demeure une opération humaine future, séparée du déploiement du code.

`Payment` décrit l'état financier. `Order` décrit la prestation, la création et la livraison. Un remboursement, un litige, un chargeback ou un reversal ne modifie donc jamais automatiquement `Order.status`. Toute trace liée à ces opérations est une annotation `OrderEvent` avec `fromStatus = null` et `toStatus = statut courant réel`.

Exemples valides :

- `Payment=REFUNDED`, `Order=IN_PROGRESS` ;
- `Payment=REFUNDED`, `Order=DELIVERED` ;
- `Payment=PARTIALLY_REFUNDED`, `Order=CANCELLED` ;
- incident financier ouvert, `Order=REFUSED`.

Une décision sur la prestation reste une action Admin distincte, limitée par la machine d'état `Order`. Aucun remboursement ne crée artificiellement une transition `Order`.

## Invariants persistants

- une Order ne possède qu'un paiement gagnant, tous providers confondus ;
- les états `SUCCEEDED`, `REFUND_PENDING`, `PARTIALLY_REFUNDED` et `REFUNDED` restent dans cet invariant ;
- sans paiement gagnant, aucun remboursement n'est réservable ;
- les montants sont des centimes entiers EUR, strictement positifs ;
- le montant confirmé et les tentatives actives ne peuvent dépasser le montant payé ;
- une tentative logique possède une clé locale unique et une clé provider persistante unique ;
- un événement provider est dédupliqué par `(provider, providerEventId)` ;
- un payload provider complet n'est jamais conservé.
- un remboursement Commander exige une facture source liée au `Payment` ; l'absence de facture produit `REFUND_SOURCE_INVOICE_REQUIRED` avant la création du `RefundAttempt` et avant tout appel Stripe ou PayPal ;
- une annulation payée ou un remboursement SAV Boutique exige la facture immuable liée à la même `ShopOrder` et au même `Payment`, avec devise et total cohérents ; le refus intervient avant toute nouvelle tentative, tout appel provider, avoir, notification ou restock ;
- une annulation payée réservée et toute transition logistique incompatible partagent le verrou de la `ShopOrder` ; le `RefundAttempt` persistant reste la barrière d'expédition pendant l'appel provider exécuté hors transaction longue ;
- un remboursement confirmé crée obligatoirement son avoir ; l'absence de facture n'est plus un cas silencieux.
- après preuve provider positive, un échec de finalisation locale conserve la tentative, l'identifiant provider connu et la capacité réservée en `REQUIRES_REVIEW` dans une transaction distincte ; la réconciliation relit cette tentative au lieu de renvoyer une mutation financière.

## Procédure Admin commune

1. Ouvrir la fiche Admin de l'Order.
2. Vérifier le paiement gagnant, le provider, le mode `TEST`, le montant payé, le montant remboursé, le solde disponible et les tentatives actives.
3. Vérifier que la prestation affichée correspond à l'Order concernée et que l'Admin affiche une facture source. Si elle est absente, arrêter : ne pas contourner le garde dans un Dashboard provider.
4. Choisir un remboursement total ou saisir le montant partiel exact.
5. Lire l'avertissement : le remboursement change l'état financier, pas le statut métier de l'Order.
6. Cocher la confirmation explicite puis soumettre une seule fois.
7. Si le résultat est en cours ou incertain, ne jamais créer une nouvelle demande : réconcilier uniquement la tentative existante. Sans identifiant de remboursement provider, contrôler le Dashboard provider et conserver `REQUIRES_REVIEW`; l’application ne réémet pas l’ordre.
8. Vérifier ensuite `RefundAttempt`, `Payment`, l'annotation `OrderEvent`, le reçu `ProviderEvent` éventuel et l'outbox.

Le provider est déduit du paiement gagnant. L'interface ne transmet ni provider, ni devise, ni identifiant de paiement arbitraire.

## Stripe Test — remboursement total ou partiel

L'adapter envoie un `POST /v1/refunds` avec le PaymentIntent persistant, le montant serveur, les identifiants internes minimaux et la clé d'idempotence persistante de `RefundAttempt`.

- partiel : saisir une valeur inférieure ou égale au solde remboursable ;
- total : le serveur calcule le solde restant, pas le navigateur ;
- deuxième partiel : il est autorisé seulement sur le solde restant ;
- total exact atteint : `Payment` devient `REFUNDED` ;
- résultat asynchrone : `Payment=REFUND_PENDING`, puis réconciliation par le même `RefundAttempt`.

Les événements Stripe pris en charge par le moteur financier sont `refund.created`, `refund.updated`, `refund.failed` et les événements `charge.dispute.*` explicitement allowlistés dans le code. La signature Stripe, le corps brut, le mode Test, les identifiants, l'EUR et les montants sont validés avant mutation.

## PayPal Sandbox — remboursement total ou partiel

L’adapter appelle `POST /v2/payments/captures/{capture_id}/refund` avec un montant EUR exact et `PayPal-Request-Id` égal à la clé provider persistante. Une référence applicative opaque et déterministe (`LNX-REFUND-` suivi du SHA-256 de cette clé) est envoyée dans le champ PayPal prévu par le refund : elle permet une corrélation anticipée sans exposer l'identifiant interne. Une réconciliation lit `GET /v2/payments/refunds/{refund_id}` lorsqu'un identifiant est connu.

- `COMPLETED` confirme la part remboursée ;
- `PENDING` conserve la tentative et le paiement en attente ;
- `FAILED` clôt la tentative sans annoncer un remboursement au client ;
- un timeout conserve la même tentative et la même `PayPal-Request-Id`.

Les webhooks acceptés sont uniquement :

- `PAYMENT.CAPTURE.REFUNDED` ;
- `PAYMENT.CAPTURE.REVERSED` ;
- `PAYMENT.REFUND.PENDING` ;
- `PAYMENT.REFUND.FAILED` ;
- `CUSTOMER.DISPUTE.CREATED` ;
- `CUSTOMER.DISPUTE.UPDATED` ;
- `CUSTOMER.DISPUTE.RESOLVED`.

`PAYMENT.CAPTURE.REFUNDED` ne contient pas toujours une preuve suffisamment précise pour attribuer chaque montant à une tentative locale : il est alors conservé en `REQUIRES_REVIEW`, sans inférer un remboursement supplémentaire.

Références officielles : [PayPal Refund captured payment](https://developer.paypal.com/docs/api/payments/v2/#captures_refund), [événements webhook PayPal](https://developer.paypal.com/api/rest/webhooks/event-names/), [PayPal-Request-Id](https://developer.paypal.com/api/rest/requests/).

## Timeout, crash et retry

L'ordre d'exécution est volontairement séparé :

1. transaction PostgreSQL courte : verrou Order, validation du solde, création `RefundAttempt`, annotation et audit ;
2. appel provider hors transaction ;
3. transaction PostgreSQL de rapprochement avec la preuve provider.

Après timeout ou réponse ambiguë en TEST/Sandbox :

- la tentative devient `REQUIRES_REVIEW` ;
- le paiement reste dans l'historique gagnant et généralement `REFUND_PENDING` ;
- aucune nouvelle tentative logique ne doit être créée ;
- l'Admin utilise **Réconcilier cette tentative** ; cette action reste indisponible en Live tant que le gate Refund Live est fermé ;
- si aucun `providerRefundId` n'existe, aucune nouvelle mutation provider n'est émise automatiquement ou depuis la réconciliation Admin ;
- si l'identifiant existe, le provider est relu avant mutation locale.

Un échec PostgreSQL après l'appel provider ne justifie jamais un deuxième remboursement. Il faut reprendre la tentative existante, contrôler le provider puis appliquer une preuve cohérente.

## Webhook tardif ou anticipé

- webhook avant la réponse API : il n'est rattaché que par une référence applicative exacte et authentifiée — identifiants `paymentId`/`refundAttemptId` dans les métadonnées Stripe, ou référence opaque PayPal attendue ; paiement, provider, montant, devise et opération autorisée doivent aussi correspondre ;
- webhook sans référence applicative suffisante : la preuve est conservée pour rapprochement ciblé, sans choisir « la dernière tentative », sans finaliser sur le montant seul et sans empêcher la réponse API attendue de compléter sa tentative ;
- webhook après la réponse API : il ajoute un reçu dédupliqué mais ne recrée ni notification ni remboursement ;
- replay du même event ID : résultat idempotent ;
- plusieurs événements distincts pour le même remboursement : le `providerRefundId` stable empêche une deuxième mutation logique ;
- montant, devise, paiement ou identifiant contradictoire : `REQUIRES_REVIEW`.

La réponse API, le retrieve et un webhook suffisamment corrélé convergent vers le même finaliseur transactionnel. Pour une annulation client confirmée, l'avoir conserve le code sémantique `WITHDRAWAL` et précise « Annulation demandée par le client avant expédition » ; une véritable erreur vendeur conserve `SELLER_ERROR`. Les rendus HTML et PDF de l'avoir reprennent l'identité immuable du client depuis le snapshot de la facture source, jamais depuis le profil courant. Un échec d'avoir, de stock ou de finalisation après succès provider laisse la tentative et la preuve en `REQUIRES_REVIEW` et ne déclenche jamais un second remboursement.

## Double provider

Le paiement gagnant n'est jamais oublié après remboursement ou incident. Les statuts financiers remboursés restent dans l'index PostgreSQL qui interdit une deuxième réussite sur la même Order.

- Stripe gagnant + tentative PayPal tardive : aucune deuxième confirmation ;
- PayPal gagnant + tentative Stripe tardive : aucune deuxième confirmation ;
- Stripe remboursé + ancien PayPal non gagnant : le remboursement cible seulement Stripe ;
- PayPal remboursé + ancien Stripe non gagnant : le remboursement cible seulement PayPal ;
- preuve réelle contradictoire provenant d'un second provider : revue manuelle, jamais correction automatique destructive.

## Litiges, chargebacks et reversals

Ces objets sont des `PaymentIncident`, jamais des `RefundAttempt`. Leur statut, montant éventuel, issue et besoin de revue sont conservés sans payload brut.

- dispute ouverte ou mise à jour : incident ouvert/en revue et alerte propriétaire idempotente ;
- dispute résolue : issue bornée (`BUYER_FAVOUR`, `SELLER_FAVOUR` ou valeur sûre équivalente) ;
- reversal : incident distinct et stable lié à la capture ;
- aucune de ces entrées ne change automatiquement `Payment` en échec, ne libère le paiement gagnant ou ne modifie `Order.status` ;
- aucun incident ne déclenche un remboursement supplémentaire automatique.

La décision opérateur se fonde sur le Dashboard Sandbox, l'identifiant externe affiché dans l'Admin et les preuves locales. Une réconciliation ne doit jamais supprimer l'historique.

Références officielles : [PayPal disputes overview](https://developer.paypal.com/docs/disputes/), [Stripe refunds](https://docs.stripe.com/refunds), [Stripe disputes](https://docs.stripe.com/disputes).

## Notifications

- remboursement partiel confirmé : une notification client logique ;
- remboursement total confirmé : une notification client logique ;
- incident financier : une alerte propriétaire logique ;
- remboursement technique échoué ou ambigu : audit interne uniquement ;
- aucune notification ne bloque la transaction financière ;
- les flags notification, suppressions et contrôles de destination existants restent applicables.

Une panne de transport n'a aucun effet sur `Payment`, `Order`, `RefundAttempt` ou `PaymentIncident`.

Le service web et le worker doivent néanmoins être évalués ensemble avant un remboursement réel. Une notification client persistée alors que le worker a `CLIENT_EMAIL_NOTIFICATIONS_ENABLED=false` devient `FAILED_FINAL` avec `CLIENT_EMAIL_DISABLED`, sans appel Resend et sans incrément de tentative. Cet état reste visible dans l'Admin Notifications, mais il ne relance jamais le provider financier. La politique de lancement doit être décidée humainement entre blocage préventif du remboursement, information manuelle avec alerte opérateur, ou activation contrôlée du canal client sur le worker. Le code ne choisit pas silencieusement entre ces politiques.

## Commandes historiques sans facture

Les paiements antérieurs à l'introduction de la facturation automatique ne doivent pas être backfillés à l'aveugle. Avant toute régularisation, rapprocher la preuve provider, la date comptable retenue, le montant et la devise, le snapshot client disponible à la vente, la prestation, les pièces éventuellement déjà remises et les écritures externes. La séquence courante ne doit être ni réécrite ni antidatée arbitrairement. Deux voies restent soumises à décision humaine : un backfill contrôlé et audité utilisant la séquence courante, ou une émission manuelle rapprochée ensuite au `Payment`. Dans les deux cas, le document devient immutable et l'avoir n'est émis qu'après existence de la facture source.

## Commande livrée ou annulée

- `Order=DELIVERED` reste `DELIVERED` ; les fichiers livrés et l'historique ne sont pas réécrits ;
- `Order=CANCELLED` ou `REFUSED` conserve son état ;
- une Order non commencée conserve également son état courant ;
- toute décision de poursuivre ou d'annuler la prestation après remboursement total est manuelle et passe par les transitions Order existantes.

## Diagnostic et données autorisées

Consulter :

- statut, montant payé/remboursé et identifiant externe utile dans Admin ;
- `RefundAttempt.status`, `attempts`, `failureCode` assaini, timestamps ;
- `PaymentIncident.status`, issue et besoin de revue ;
- `PaymentAuditEvent` ;
- `ProviderEvent.outcome` ;
- `OrderEvent` et `OrderNotification`.

Ne jamais copier dans un ticket, un e-mail ou un chat :

- clé Stripe ou PayPal, secret webhook, cookie ou token ;
- `DATABASE_URL` ;
- payload provider complet ;
- données carte ou compte PayPal ;
- URL signée R2 ;
- brief, fichier ou donnée personnelle non nécessaire.

## Retour fail-closed

Après QA, remettre les flags de paiement staging à `false` selon la procédure de déploiement. Ne supprimer aucune ligne financière pour « nettoyer » une divergence : conserver l'audit, documenter l'incident et utiliser seulement des fixtures jetables explicitement inventoriées.
