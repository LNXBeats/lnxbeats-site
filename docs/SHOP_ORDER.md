# Commandes Boutique V1.1 — contrat Phase 2

## Frontière fonctionnelle

Une `ShopOrder` Phase 2 est une préparation de commande locale avec snapshots
et éventuelle réservation de stock. Elle n'est ni une vente encaissée, ni une
commande musicale `Order`. Aucun Checkout, provider, webhook, facture, email ou
expédition n'est déclenché.

Le flux n'est disponible que lorsque le gate local décrit dans
[`SHOP_FOUNDATION.md`](SHOP_FOUNDATION.md) est armé. Le gate refuse la
Production.

## Parcours public et panier

Quand le gate est fermé, `/boutique` affiche le teaser éditorial. Quand il est
armé, le catalogue expose uniquement les produits `PUBLISHED` avec prix EUR et
visuel principal public admissible. Les fiches `/boutique/[slug]` montrent la
disponibilité calculée et les frais d'envoi par exemplaire.

Le panier navigateur conserve uniquement des couples `productId`/`quantity`.
Il ne constitue aucune preuve de prix ou de stock. Avant l'écriture, le serveur
relit chaque produit, sa publication, son prix, son visuel, son expédition et sa
disponibilité.

## Requête de création

`POST /api/shop/orders` accepte seulement :

- une requête same-origin autorisée ;
- une session active `MEMBER` ou `CUSTOMER` ;
- un en-tête `Idempotency-Key` contenant un UUID ;
- un JSON fermé `{ items, shippingAddress }` ;
- de 1 à 20 produits distincts après fusion, chacun avec une quantité de 1 à
  20 ;
- une adresse complète dont le pays est allowlisté si une ligne exige un
  envoi.

Les champs inconnus sont refusés. Un rôle `ADMIN` ne peut pas créer une
commande Boutique. Le compteur partagé limite un membre à dix préparations par
heure.

## Idempotence et concurrence

Le client conserve la clé UUID dans `sessionStorage` pendant une tentative et
la réutilise si la réponse réseau est ambiguë. PostgreSQL impose l'unicité de
`(userId, creationToken)` et le service verrouille cette clé avant lecture ou
création.

L'intention normalisée (lignes triées/fusionnées et adresse) reçoit une
empreinte SHA-256 :

- même membre, même clé et même empreinte : la commande existante est renvoyée ;
- même membre, même clé et autre empreinte : conflit, aucune seconde commande ;
- autre clé : nouvelle tentative soumise à toutes les validations et à la
  limite de fréquence.

Les produits sont verrouillés dans un ordre stable au sein de la transaction.
Le serveur ne fait donc pas confiance à l'état du panier pour arbitrer une
dernière unité concurrente.

## Snapshots persistés

La commande reçoit un numéro issu d'une séquence PostgreSQL au format
`LNX-SHOP-AAAA-NNNNNN`. `ShopOrderItem` conserve pour chaque produit :

- `productTitle`, `inventoryTracked`, `unitPriceCents` et `quantity` ;
- `lineTotalCents` ;
- `shippingRequired`, `unitShippingCents` et `lineShippingCents` ;
- la devise `EUR` et la position déterministe.

`ShopOrder` conserve le sous-total, les frais d'envoi, le total, l'échéance de
réservation et, si nécessaire, l'adresse complète. Le lien vers `Product` reste
présent pour l'intégrité, mais une modification ultérieure du titre ou du tarif
ne réécrit pas le snapshot.

## Calcul des montants

Le serveur applique les formules suivantes en centimes entiers :

```text
lineTotalCents    = unitPriceCents × quantity
lineShippingCents = unitShippingCents × quantity
subtotalCents     = somme des lineTotalCents
shippingCents     = somme des lineShippingCents
totalCents        = subtotalCents + shippingCents
```

`shippingPriceCents` est donc un prix **par exemplaire**. Deux exemplaires sur
une ligne paient deux fois ce tarif unitaire. Une ligne sans expédition a des
frais unitaires et de ligne nuls. Les bornes monétaires et les égalités de ligne
et de commande sont aussi contraintes en PostgreSQL.

## États exposés en Phase 2

Une création normale produit :

- `status=OPEN` ;
- `paymentStatus=AWAITING_PAYMENT` ;
- `fulfillmentStatus=PENDING` ;
- un événement `SHOP_ORDER_CREATED` et, pour chaque stock suivi, un événement
  `STOCK_RESERVED`.

Le membre peut annuler une commande encore ouverte et non payée. Elle devient
`CANCELLED`, ses états paiement/préparation deviennent `CANCELLED` et ses
réservations actives sont libérées. Une commande arrivée à échéance devient
`EXPIRED` tout en restant `AWAITING_PAYMENT`/`PENDING`, car aucun paiement
n'existe dans ce flux.

Les autres valeurs d'enum préparent les phases futures ; aucune route ni aucun
bouton Phase 2 ne confirme un paiement ou une expédition.

## Vues et autorisations

- `/compte` liste uniquement les commandes du membre connecté ;
- `/compte/achats/[orderNumber]` montre ses snapshots, son adresse, son échéance
  et permet l'annulation admissible ;
- `/admin/boutique/commandes` liste et filtre toutes les `ShopOrder` ;
- `/admin/boutique/commandes/[orderNumber]` montre snapshots, réservations,
  adresse et audit.

Les écrans Admin sont en lecture seule. La propriété utilisateur est incluse
dans la requête de détail membre, de sorte qu'un autre compte reçoit une page
introuvable plutôt que la commande.

## Phase 3 différée

Le passage à une vente réelle exigera une architecture financière Boutique
dédiée : idempotence provider, Checkout, webhooks signés, rapprochement,
facturation/TVA, règles d'annulation/remboursement, notifications et
fulfillment. Rien de cela n'est armé par `SHOP_ENABLED` en Phase 2.
