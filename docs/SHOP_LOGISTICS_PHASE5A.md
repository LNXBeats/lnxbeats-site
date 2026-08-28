# Boutique V1.1 — fondation logistique Phase 5A

## Périmètre

La Phase 5A fournit uniquement un moteur interne de devis d’expédition versionné pour la QA locale. Elle ne contient aucune API La Poste/Colissimo, aucun tarif contractuel, aucun achat ou PDF d’étiquette, aucun webhook transporteur et aucun suivi automatique.

Le mécanisme est fermé par défaut. Une grille interne ne peut être utilisée que lorsque `SHOP_ENABLED=true`, `SHOP_SHIPPING_ENABLED=true`, `SHOP_SHIPPING_QA_CONFIRM=enable-internal-shop-shipping-qa`, avec une origine HTTP loopback, hors `NODE_ENV=production` et hors Railway. Toute configuration manquante ou incohérente refuse le checkout expédiable : elle ne produit jamais une livraison gratuite ou un fallback implicite.

## Poids et emballage

- unités : grammes entiers et cents entiers ;
- poids logistique produit : 1 à 30 000 g ;
- somme maximale du panier : 1 000 000 g ;
- minimum facturable interne confirmé par la documentation du projet : 150 g ;
- emballage Phase 5A : 0 g, car aucun poids d’emballage commercial n’est encore validé.

Le modèle versionne le poids d’emballage afin qu’une valeur validée puisse être introduite plus tard sans réinterpréter les commandes existantes. Aucun poids fictif n’est backfillé. Un produit historique expédiable sans poids reste lisible dans l’Admin, mais toute nouvelle publication/republication et tout nouveau devis le concernant échouent explicitement.

## Grille QA

La fixture `phase5a-qa-internal-v1` est déterministe, `INTERNAL_QA`, en EUR, limitée à la France et au service générique `STANDARD_TRACKED_SIGNATURE`. Ses paliers sont artificiels et non contractuels. Ils ne représentent pas les prix de La Poste.

Une seule version QA peut être active. Les états sont `DRAFT`, `ACTIVE` et `RETIRED`. Lorsqu’une version est référencée par une ShopOrder, sa définition et ses paliers deviennent immuables au niveau PostgreSQL. Elle peut être retirée pour les nouveaux devis, mais reste reliée aux snapshots historiques.

## Calcul serveur et snapshots

Le serveur recharge produits, versions optimistes et stock, puis calcule :

1. `poidsProduits = somme(poidsProduit × quantité)` ;
2. `poidsEmballé = poidsProduits + poidsEmballageVersionné` ;
3. `poidsFacturable = max(minimumVersionné, poidsEmballé)` ;
4. premier palier dont la borne haute inclut le poids facturable ;
5. montant EUR entier du palier.

Le navigateur ne transmet jamais un montant de livraison. Il reçoit une prévisualisation serveur et ne renvoie que la version observée. La création de ShopOrder recalcule le devis dans sa transaction et refuse une version devenue obsolète.

La ShopOrder snapshotte la version, le service, le poids produits, le poids d’emballage, le poids facturable et `shippingCents`. Chaque ligne snapshotte aussi son poids unitaire et total.

## Compatibilité historique

`Product.shippingPriceCents` et les anciens snapshots `ShopOrderItem.unitShippingCents/lineShippingCents` restent présents pour lire les commandes historiques. Pour une nouvelle ShopOrder Phase 5A, les deux montants de ligne sont fixés à zéro et `ShopOrder.shippingCents` est alimenté uniquement par le devis versionné. Les deux mécanismes ne sont donc jamais additionnés.

Une modification ultérieure du poids/du prix produit ou une nouvelle grille n’altère ni le total, ni la facture, ni le montant provider d’une ShopOrder existante. Les paiements et la facturation continuent à utiliser exclusivement `ShopOrder.totalCents` et ses snapshots.

## Suite hors périmètre

L’intégration future d’un transporteur devra fournir une nouvelle source versionnée derrière le même contrat. Restent hors Phase 5A : tarifs réels, étiquettes, suivi automatique, points relais, international, retours, restock après retour, remboursement Boutique, scheduler Production des réservations, activation juridique et ouverture Production.
