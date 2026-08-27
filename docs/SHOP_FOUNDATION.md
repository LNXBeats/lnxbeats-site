# Boutique V1.1 — Phase 2 locale et fermée par défaut

## Portée effectivement implémentée

La phase 1 a ajouté le catalogue administrable (`Product`, `ProductAsset`,
`ProductStockAdjustment`, `ProductAuditEvent`) et l'image principale produit.
La phase 2 ajoute, derrière un gate strictement local, le catalogue public
dynamique, les fiches produit, un panier navigateur, la création idempotente de
`ShopOrder`, les snapshots de commande, la réservation temporaire du stock et
les vues membre/Admin.

Ce flux est séparé des commandes musicales `Order`, de leurs `Payment` et de
leurs providers. Il ne réalise aucun paiement, n'appelle ni Stripe ni PayPal,
n'émet aucune notification Boutique et ne marque aucune expédition.

## Gate local fail-closed

`SHOP_ENABLED=false` est l'état normal. Dans cet état, `/boutique` conserve le
teaser éditorial et les données commerce ne sont pas exposées. Une configuration
invalide échoue également fermée.

Pour accepter `SHOP_ENABLED=true`, le serveur exige simultanément :

- un runtime autre que `production` ;
- `AUTH_URL` ou `SITE_URL` sur `localhost`, `127.0.0.1` ou `::1` ;
- `SHOP_LOCAL_QA_CONFIRM=enable-local-shop-commerce-qa` ;
- une allowlist explicite de codes pays ISO dans `SHOP_ALLOWED_COUNTRIES` ;
- `SHOP_RESERVATION_TTL_MINUTES` explicite, entier entre 5 et 120 ;
- `MUSIC_PRICING_SOURCE=legacy`.

La configuration QA documentée utilise une réservation de 30 minutes. Cette
valeur n'ouvre rien à elle seule : les variables requises et la confirmation
doivent toutes être présentes. Le gate refuse volontairement la Production ;
il ne constitue pas un mécanisme de lancement commercial.

## Produits, images et catalogue public

Un produit naît en `DRAFT`, possède un slug normalisé immuable, un prix entier
en centimes et une devise `EUR`. L'Admin peut suivre un stock ou laisser le
produit sans limite quantitative, définir les frais d'envoi par exemplaire,
ajouter une image principale et publier une fiche cohérente.

L'image est validée, normalisée en WebP et stockée via `MediaStorage`, jamais en
base64 dans PostgreSQL. Sa publication exige notamment une visibilité publique,
des droits confirmés et un texte alternatif. La Boutique ne liste que les
produits `PUBLISHED` ayant un prix et un visuel principal admissibles.

Quand le gate local est armé, les routes suivantes sont disponibles :

- `/boutique` : catalogue dynamique ;
- `/boutique/[slug]` : fiche et disponibilité courante ;
- `/boutique/panier` : panier et préparation de commande ;
- `/media/boutique/[assetId]` : diffusion bornée du visuel public admissible.

Le panier conserve seulement les identifiants produit et quantités dans le
navigateur. Les prix, frais d'envoi, statuts de publication et disponibilités
sont toujours relus par le serveur lors de la création.

## Création et snapshots de commande

`POST /api/shop/orders` exige une session `MEMBER` ou `CUSTOMER`, une origine
autorisée, un JSON fermé et une clé UUID `Idempotency-Key`. Un rôle `ADMIN` ne
peut pas préparer un achat. Le serveur limite aussi la fréquence de création.

La clé est unique par membre. Une répétition avec le même panier et la même
adresse renvoie la commande existante ; sa réutilisation avec une empreinte de
requête différente est refusée. Les verrous PostgreSQL sur la clé et les
produits empêchent les doubles créations et la surréservation concurrente.

La commande fige notamment :

- le titre produit, le suivi de stock, le prix unitaire et la quantité ;
- le sous-total de chaque ligne ;
- le besoin d'expédition, le tarif unitaire et le total d'envoi de la ligne ;
- la devise, les totaux commande et, si nécessaire, l'adresse de livraison.

Les frais d'envoi sont tarifés **par exemplaire** :
`lineShippingCents = unitShippingCents × quantity`, puis
`shippingCents = somme(lineShippingCents)`. Enfin,
`totalCents = subtotalCents + shippingCents`. PostgreSQL répète ces invariants
par des contraintes.

Voir [`SHOP_ORDER.md`](SHOP_ORDER.md) pour le contrat complet.

## Réservation, annulation et expiration

Une ligne avec stock suivi crée une `StockReservation` `ACTIVE`; une ligne sans
suivi n'en crée pas. La création ne décrémente pas `Product.stock`. La
disponibilité affichée et revalidée vaut stock courant moins réservations
`ACTIVE` non expirées.

La durée est calculée depuis `SHOP_RESERVATION_TTL_MINUTES` (30 minutes dans la
QA locale). Le membre peut annuler une commande encore ouverte et non payée :
ses réservations actives passent à `RELEASED`. La primitive d'expiration bornée
marque les réservations arrivées à terme `EXPIRED` et la commande `EXPIRED`, en
conservant `paymentStatus=AWAITING_PAYMENT`. Aucun scheduler de Production
n'est activé dans cette phase.

Chaque création, réservation, libération, annulation ou expiration produit un
`ShopOrderEvent`. Les détails de concurrence et de stock figurent dans
[`SHOP_INVENTORY.md`](SHOP_INVENTORY.md).

## Vues membre et Admin

Le membre retrouve ses commandes Boutique dans `/compte` et leur détail dans
`/compte/achats/[orderNumber]`. La lecture est toujours bornée au propriétaire;
une commande ouverte et non payée peut y être annulée.

L'Admin consulte la liste filtrable et le détail dans
`/admin/boutique/commandes`. Ces écrans montrent les snapshots, états,
réservations, adresse et événements. Ils sont en lecture seule : aucun bouton
ne paie, ne confirme le stock, ne prépare ou n'expédie une commande.

## Frontière de la phase 3

Les états `paymentStatus` et `fulfillmentStatus` préparent seulement une future
machine métier. La phase 3 reste différée : architecture financière Boutique,
provider de paiement, webhooks, rapprochement, facturation/TVA, notifications,
préparation et expédition devront faire l'objet d'un gate et d'un audit dédiés.

## Rollback applicatif

Le rollback reste `SHOP_ENABLED=false`. Les migrations additives, produits,
commandes et événements sont conservés pour l'audit. Aucun `DROP`, `TRUNCATE`,
reset Prisma ou effacement de produit/commande n'est requis.
