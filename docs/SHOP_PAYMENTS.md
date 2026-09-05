# Paiements Boutique V1.1 — fondation Phase 3A

> Phase 4 juridique : le CTA Shop affiche visiblement une formulation équivalente à « commande avec obligation de paiement ». La case CGV reste non précochée et la version est choisie côté serveur. Les gates restent fermés sans version juridiquement approuvée.

> La Phase 3A est validée uniquement en local, avec providers mockés et
> transports externes fermés. Elle ne constitue ni un runbook d'activation
> Production, ni une autorisation d'encaissement réel.

## Périmètre

Le paiement Boutique réutilise le ledger financier, les adapters Stripe et
PayPal, les reçus provider, l'outbox et le dispatcher existants. La commande
musicale `Order` et la commande Boutique `ShopOrder` restent deux agrégats
distincts.

Les nouvelles tentatives sont fermées tant que les trois couches suivantes ne
sont pas explicitement valides :

- `SHOP_ENABLED=true` et son gate commerce ;
- `SHOP_PAYMENTS_ENABLED=true`, `PAYMENTS_ENABLED=true` et au moins un provider
  autorisé ;
- `SHOP_LEGAL_READY=true` avec une version immuable enregistrée et acceptée.

Les notifications e-mail/SMS conservent leurs propres flags. Ouvrir les
paiements Boutique ne les ouvre jamais implicitement.

## Parent financier et source métier

Une ligne `Payment` référence exactement un seul parent :

```text
orderId IS NOT NULL XOR shopOrderId IS NOT NULL
```

La source `MUSIC_ORDER` ou `SHOP_ORDER` est dérivée de cette contrainte. Il n'y
a pas de colonne source redondante susceptible de contredire les relations.
La même règle exact-one s'applique à `OrderNotification`.

Les lignes historiques musicales conservent leur `orderId`. La migration rend
ce champ nullable seulement pour permettre le parent Boutique, sans suppression
ni réécriture des paiements existants.

## Préparation Checkout

Le serveur relit la `ShopOrder`, son propriétaire, ses lignes snapshotées et
ses réservations. Il exige une commande `OPEN/AWAITING_PAYMENT`, sans revue, un
total EUR positif et des réservations encore actives. Le navigateur ne fournit
jamais le montant de confiance.

L'acceptation explicite fige sur la commande :

- `termsVersion` ;
- `termsHashSha256` ;
- `termsAcceptedAt`.

Une tentative `Payment` Boutique conserve le montant, la devise, la version de
prix et les identifiants provider. Une seule tentative active est autorisée par
provider et commande. Sa clé d'idempotence reste stable lors d'une réponse
réseau ambiguë ou d'une reprise.

## Reconciliation et tentative gagnante

Chaque preuve provider est vérifiée contre le parent, le mode TEST/LIVE, le
provider, les identifiants, le montant, la devise et la version de prix. Un
`ProviderEvent` unique rend les replays sans effet métier supplémentaire.

Un index PostgreSQL autorise au plus un paiement financier gagnant par
`ShopOrder` pour les états payés/remboursables. Stripe et PayPal peuvent donc
avoir des tentatives, mais une seule devient la gagnante. Une réussite
concurrente ou incohérente est conservée comme preuve et envoyée en revue ; elle
ne confirme pas une seconde fois la commande ou le stock.

## Confirmation atomique du stock

Pour une réussite authentifiée avant l'échéance, une seule transaction :

1. verrouille la commande, la tentative et les produits suivis ;
2. confirme que la réservation et le stock restent valides ;
3. décrémente chaque `Product.stock` suivi ;
4. écrit chaque `ProductStockAdjustment` ;
5. passe les réservations `ACTIVE` à `CONFIRMED` et écrit `STOCK_CONFIRMED` ;
6. passe `Payment` à `SUCCEEDED` et `ShopOrder.paymentStatus` à `PAID` ;
7. écrit `SHOP_PAYMENT_CONFIRMED` ;
8. émet la facture depuis le snapshot `ShopOrder` validé ;
9. enfile les notifications Boutique idempotentes.

Une erreur annule toute la transaction. Un replay ne décrémente jamais le
stock une seconde fois.

## Expiration, échec et revue humaine

Un événement `PENDING` ne confirme rien. Un échec ou une expiration provider
avant réussite met à jour la tentative sans vendre le stock. Une capture
authentique arrivée après expiration de la réservation, après un état terminal
ou après un autre gagnant est conservée dans le ledger et marque la commande
`paymentReviewAt/paymentReviewCode`.

Une commande en revue reste non fulfillable. La Phase 3A ne lance aucun
remboursement automatique : toute résolution financière tardive exige une
procédure humaine future.

## Notifications et fulfillment

Les kinds Boutique sont :

- `OWNER_SHOP_ORDER_PAID` ;
- `CUSTOMER_SHOP_PAYMENT_CONFIRMED` ;
- `CUSTOMER_SHOP_PREPARING` ;
- `CUSTOMER_SHOP_SHIPPED`.

Ils utilisent le parent `shopOrderId` et les contraintes/idempotency keys de
l'outbox. Comme pour les commandes musicales, la notification propriétaire est
persistée avec le paiement puis reste non claimable tant que son audience est
fermée; les notifications client ne sont créées que si l'audience client est
explicitement activée. Le transport est encore un gate indépendant. Aucun de
ces flags n'est ouvert implicitement par le paiement Boutique.

Les messages owner/admin Boutique prennent le nom client depuis
`ShopOrder.shippingFirstName + shippingLastName`, jamais depuis le profil
mutable `User.displayName`. Stripe et PayPal suivent ce même contrat. Le rendu
owner reste minimisé au nom attendu, sans ajouter l'adresse ni l'e-mail client,
et un replay réutilise la même clé d'idempotence. Le mail client conserve son
contrat existant.

La préparation Admin exige `OPEN/PAID`, aucune revue et l'état `PENDING`.
L'expédition exige ensuite `PREPARING`. Les transitions, l'acteur et les
données de suivi optionnelles sont audités dans `ShopOrderLifecycleEvent`; une
URL de suivi éventuelle doit être HTTPS.

## Rollback et activation future

Le rollback applicatif consiste à remettre `SHOP_PAYMENTS_ENABLED=false` et à
laisser le commerce, le juridique et les notifications fermés selon le besoin.
Les preuves financières déjà reçues restent réconciliables : fermer la création
Checkout ne doit jamais faire perdre un événement provider authentique.

Le futur runbook sandbox/Production devra inclure configuration humaine,
webhooks, lecture de l'outbox, stock, revue des captures tardives et rollback.
Il n'est ni exécuté ni autorisé par la Phase 3A.

Voir aussi : [commandes](SHOP_ORDER.md), [stock](SHOP_INVENTORY.md),
[gates juridiques techniques](SHOP_LEGAL_TECHNICAL_GATES.md) et
[QA paiements](SHOP_PAYMENT_QA.md).
