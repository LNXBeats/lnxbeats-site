# Stock Boutique V1.1 — réservation et expiration Phase 2

## Stock suivi et non suivi

`Product.trackInventory` distingue deux comportements :

- `true` : `Product.stock` est un entier positif ou nul et chaque ligne de
  commande crée une `StockReservation` ;
- `false` : la disponibilité quantitative est illimitée pour ce flux et aucune
  réservation n'est créée.

Une réservation ne décrémente jamais immédiatement `Product.stock`. Elle
réduit temporairement la quantité vendable :

```text
available = max(0, stock - somme des réservations ACTIVE non échues)
```

Une réservation `ACTIVE` dont `expiresAt` est déjà passé n'est plus comptée
comme disponible retenue, même avant que le traitement d'expiration persiste
son nouvel état.

## Création concurrente

La préparation d'une commande s'exécute dans une transaction PostgreSQL. Les
identifiants produit sont triés, puis verrouillés par advisory locks. Pour
chaque ligne, le service relit le stock et additionne uniquement les
réservations `ACTIVE` dont l'échéance est future.

Si la quantité demandée dépasse la disponibilité, toute la création échoue :
aucune commande, ligne ou réservation partielle n'est conservée. Les erreurs de
sérialisation reconnues sont retentées de façon bornée. Les mêmes verrous sont
utilisés par les ajustements Admin afin qu'un stock ne puisse pas être abaissé
sous les réservations actives.

## Durée de réservation

`SHOP_RESERVATION_TTL_MINUTES` doit être fourni explicitement avant d'armer la
Boutique. Il accepte un entier de 5 à 120. Le profil QA Phase 2 utilise 30
minutes :

```text
reservationExpiresAt = heure serveur de création + 30 minutes
```

Toutes les réservations suivies d'une même commande partagent cette échéance.
Une variable absente ou invalide laisse le commerce non configuré et empêche
`SHOP_ENABLED=true`.

## Cycle de vie

Une réservation commence en `ACTIVE`, avec tous ses horodatages terminaux à
`NULL`.

- annulation membre admissible : `RELEASED` et `releasedAt` renseigné ;
- expiration : `EXPIRED` et `expiredAt` renseigné ;
- la valeur future `CONFIRMED` n'est atteinte par aucun parcours HTTP/UI Phase
  2.

L'annulation d'une commande `OPEN`/`AWAITING_PAYMENT` libère immédiatement
toutes ses réservations encore actives, passe la commande et ses états associés
à `CANCELLED`, puis écrit les événements `STOCK_RELEASED` et
`SHOP_ORDER_CANCELLED`.

## Traitement de l'expiration

La primitive `expireShopOrderReservations` sélectionne par lot borné les
commandes `OPEN`/`AWAITING_PAYMENT` dont l'échéance est atteinte. Elle utilise
`FOR UPDATE SKIP LOCKED`, ce qui permet à plusieurs workers de ne pas traiter la
même commande simultanément.

Pour chaque candidate, elle :

1. passe chaque réservation encore `ACTIVE` à `EXPIRED` ;
2. écrit un événement `STOCK_RESERVATION_EXPIRED` par réservation ;
3. passe la commande à `EXPIRED` et renseigne `expiredAt` ;
4. écrit une fois `SHOP_ORDER_EXPIRED`.

La commande expirée conserve `paymentStatus=AWAITING_PAYMENT` et
`fulfillmentStatus=PENDING`. Aucun stock physique n'est décrémenté ou recrédité,
puisqu'une réservation n'avait fait que réduire la disponibilité calculée.

La Phase 2 fournit cette primitive et ses invariants, mais n'active aucun cron
ou scheduler de Production. Son orchestration Production appartient à une
phase ultérieure.

Pour la QA locale jetable uniquement, `npm run shop:phase2:reservations:expire`
traite au maximum 50 commandes par invocation. La commande réutilise le garde
Phase 2 complet (cible Prisma Dev, loopback, preuve du processus, transports
externes désactivés) avant tout accès PostgreSQL. Son garde de maintenance exige
un `SHOP_ENABLED` explicite mais accepte `false` afin qu'une fermeture immédiate
de la Boutique ne bloque jamais l'expiration des réservations déjà actives. Il
ne constitue pas un scheduler de Production.

## Audit et contraintes

`StockReservation` est reliée à la ligne exacte par `(shopOrderId, productId,
quantity)`. Une seule réservation peut exister par produit et commande. Les
contraintes SQL imposent la quantité 1–20, une échéance postérieure à la
création et exactement l'horodatage correspondant à l'état terminal.

`ShopOrderEvent` distingue les événements de commande des événements de
réservation et des index uniques empêchent de journaliser deux fois le même
type pour la même portée. Les clés étrangères `RESTRICT` empêchent de supprimer
un produit, une ligne ou une commande qui porte cet historique.

## Frontière paiement

Réserver ne signifie pas payer. Aucun provider, webhook ou action Admin ne
confirme une réservation en Phase 2. La future confirmation atomique du
paiement, la décrémentation définitive du stock, les remboursements et le
fulfillment restent différés à la Phase 3 et devront conserver les mêmes
verrous, preuves d'idempotence et événements d'audit.
