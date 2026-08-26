# Boutique V1.1 — fondations fermées

## Portée de la phase 1

La V1.1.0 prépare un catalogue de produits administrable sans ouvrir une
boutique publique. Elle ajoute les modèles `Product`, `ProductAsset`,
`ProductStockAdjustment` et `ProductAuditEvent`, ainsi que les écrans privés
`/admin/boutique`.

Cette phase ne contient volontairement aucun panier, `ShopOrder`, réservation
de stock, Checkout Stripe/PayPal, notification Boutique ou adresse de
livraison. Le modèle financier V1 reste exclusivement lié aux commandes
musicales et n'est pas généralisé silencieusement.

## Fermeture par défaut

`SHOP_ENABLED` est absent ou vaut `false` par défaut. La valeur `true` est
elle-même refusée par le healthcheck de cette phase : elle ne pourra être
acceptée qu'avec les routes publiques et les invariants de la phase 2. Aucun
endpoint d'achat n'existe et la page publique `/boutique` conserve son contenu
éditorial actuel. Un produit `PUBLISHED` signifie seulement qu'il est prêt pour
une future ouverture contrôlée ; il ne devient pas achetable.

Le healthcheck expose uniquement l'état non sensible du flag. Une valeur autre
que `true`, `false`, vide ou absente échoue fermée.

## Produits

Un produit est créé en `DRAFT`. Son slug est normalisé et immuable. Les prix
sont des entiers en centimes et la devise est exclusivement `EUR`. Un produit
peut suivre un stock (`trackInventory=true`) ou ne pas être limité. Les
mutations sensibles utilisent une session Admin, un contrôle d'origine, une
transaction PostgreSQL, un verrou par produit et une version optimiste.

La suppression physique n'est pas proposée. L'archivage conserve l'historique.
Les ajustements numériques de stock enregistrent la quantité avant/après, le
delta, le motif, l'acteur et la date. L'activation ou la désactivation du suivi
reste également visible dans l'événement d'audit de la fiche.

## Images

`ProductAsset` prépare la relation avec l'infrastructure `Asset`. L'upload R2
produit n'est pas activé dans cette phase : il devra réutiliser la validation
MIME/signature/dimensions, la normalisation et la compensation déjà employées
par le catalogue. Aucun blob ou base64 n'est stocké en PostgreSQL.

## Phases suivantes

1. Phase 2 : média produit public sécurisé, catalogue public dynamique, panier,
   `ShopOrder`, snapshots de lignes et réservation de stock.
2. Phase 3 : adaptation financière dédiée Stripe/PayPal, webhooks,
   notifications et expédition.

Le paiement Boutique nécessitera un audit financier distinct : `Payment`, les
index d'idempotence, les webhooks et l'outbox V1 sont aujourd'hui liés à
`Order`.

## Rollback

Le rollback applicatif consiste à conserver `SHOP_ENABLED=false`. La migration
additive et les données Admin restent en place. Aucun `DROP`, `TRUNCATE`, reset
Prisma ou suppression de produit n'est requis.

## Ordre de déploiement futur et sauvegarde

Avant tout `prisma migrate deploy` en Production, l'opérateur devra vérifier un
backup PostgreSQL/PITR récent et sa procédure de restauration, relever les
compteurs protégés (`Order`, `Payment`, `ProviderEvent`, notifications, droits,
catalogue et médias), puis conserver `SHOP_ENABLED=false` et
`MUSIC_PRICING_SOURCE=legacy`. Le déploiement technique ajoute la 19e migration
et doit être suivi d'un healthcheck et d'une comparaison des compteurs.

L'ancien code peut ignorer les nouvelles tables en cas de rollback applicatif ;
la migration n'est jamais annulée par une down migration destructive. Aucune
ouverture publique ni activation tarifaire ne fait partie de cette procédure.
