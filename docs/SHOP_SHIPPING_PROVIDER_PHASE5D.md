# Phase 5D — fondation provider transporteur

Cette phase prépare la frontière technique d’un futur transporteur sans intégrer La Poste ou Colissimo. Le seul adapter disponible est `FAKE_LOCAL`. Il est déterministe, sans réseau, sans credential et ne produit aucun affranchissement.

## Frontière de domaine

`ShippingProviderAdapter` reçoit une référence de commande, une clé d’idempotence, le service logistique snapshoté, le poids facturable et une destination minimale (pays et code postal). Il renvoie un résultat normalisé : `PENDING`, `SUCCEEDED`, `FAILED` ou `REQUIRES_REVIEW`.

Le provider n’est jamais autoritaire pour les prix, le paiement, le stock, les factures, les avoirs, le SAV ou les notifications. Un résultat `SUCCEEDED` peut seulement proposer un suivi opérationnel. La commande reste `READY_TO_SHIP` jusqu’à la confirmation physique Admin Phase 5C.

## Persistance et idempotence

Chaque intention est persistée dans `shop_shipping_provider_attempts`. La clé stable est :

`shop-order:<shopOrderId>:shipping-provider:<attemptNumber>:v1`

Phase 5D autorise une seule intention logique par ShopOrder. Un double clic, un replay ou deux Admins concurrents retrouvent donc la même tentative. Un échec n’est jamais réessayé automatiquement. `PENDING` est réconcilié sur la tentative existante ; aucun second shipment n’est créé.

Les statuts provider restent distincts de `ShopFulfillmentStatus` :

- `SUCCEEDED` : identifiant et suivi fictifs déterministes, puis adoption du suivi avec `trackingSource=PROVIDER` si aucun suivi n’existe ;
- `PENDING` : tentative persistée, aucun suivi actif, réconciliation locale vers `SUCCEEDED` ;
- `FAILED` : erreur normalisée, aucun suivi, aucun retry aveugle ;
- `AMBIGUOUS` : persistance en `REQUIRES_REVIEW`, sans hypothèse de succès.

Si un suivi `MANUAL` existe, le résultat provider est conservé pour audit mais la tentative passe en `REQUIRES_REVIEW` avec `MANUAL_TRACKING_CONFLICT`. Le suivi manuel n’est jamais écrasé.

Si la confirmation physique `SHIPPED` gagne la course pendant un appel provider, le résultat reste rattaché à la tentative existante et passe en `REQUIRES_REVIEW` avec `ORDER_ALREADY_SHIPPED`. Le replay retrouve cette même tentative, le suivi opérationnel actif n’est pas remplacé et aucune seconde intention provider n’est créée.

## Artefact et stockage

Aucun PDF ou faux bordereau n’est généré. Un document n’ajouterait aucune preuve aux invariants de persistance et pourrait être confondu avec une étiquette postale. Il n’existe donc aucun stockage supplémentaire et aucun accès R2. Une future implémentation devra utiliser le stockage privé existant avec contrôle d’accès, rétention et wording adapté.

## Garde QA

Le provider est activable uniquement lorsque toutes les conditions suivantes sont vraies :

- origine exacte `http://127.0.0.1:31779` ;
- cible Prisma Dev `lnx-studio-v110-shipping-provider-preview-test` ou cible runtime dédiée ;
- PostgreSQL loopback, base technique `template1`, port différent de `5432` ;
- `SHOP_SHIPPING_PROVIDER=FAKE_LOCAL` ;
- confirmation `enable-local-shop-shipping-provider-qa` ;
- paiements et remboursements Live désactivés ;
- notifications en capture et stockage local ;
- aucune variable `RAILWAY_*` ;
- aucun secret Stripe, PayPal, Resend, R2, La Poste ou Colissimo.

Toute configuration incomplète ou ambiguë échoue fermée.

## Preview humaine

La preview utilise le port `31779` et quatre ShopOrders fictives, toutes `PAID`, `READY_TO_SHIP`, réservation `CONFIRMED`, sans suivi initial :

- `LNX-SHOP-2026-510001` — scénario `SUCCEEDED` ;
- `LNX-SHOP-2026-510002` — scénario `PENDING` ;
- `LNX-SHOP-2026-510003` — scénario `FAILED` ;
- `LNX-SHOP-2026-510004` — scénario `AMBIGUOUS`.

Le bloc Admin est intitulé « Provider transporteur — QA ». Les actions exigent une confirmation explicite et ne prétendent jamais acheter ou générer une vraie étiquette. Le membre ne reçoit aucune donnée technique provider ; il voit uniquement le suivi Phase 5C adopté lorsque celui-ci est utilisable.

## Future intégration Colissimo

Une phase distincte devra auditer le contrat commercial, l’authentification, les environnements de test, les services/produits, les formats d’étiquette, l’adressage, la réconciliation, les erreurs, les webhooks ou APIs de suivi, la rétention et le coût. Aucun de ces éléments n’est implémenté ou activé ici.
