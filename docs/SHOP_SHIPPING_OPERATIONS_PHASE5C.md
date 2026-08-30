# Phase 5C — Expédition et suivi Boutique

## Périmètre

La Phase 5C ajoute la gestion opérationnelle locale d'une expédition physique déjà payée. Elle ne calcule aucun tarif et n'intègre aucun transporteur. La tarification reste la responsabilité de la Phase 5A ; le SAV et les retours restent la responsabilité de la Phase 5B.

Une `ShopOrder` représente actuellement une commande expédiée en un seul colis. Ce choix suit le modèle existant et évite d'introduire une relation multi-colis sans besoin métier démontré.

## Modèle et machine d'état

La machine d'état est stricte :

```text
PENDING -> PREPARING -> READY_TO_SHIP -> SHIPPED
```

`CANCELLED` reste l'état terminal existant des commandes annulées. Une commande doit être `OPEN`, payée (`PAID`) et sans revue financière pour entrer ou avancer dans le fulfillment.

`SHIPPED` signifie uniquement que LNX Beats a enregistré la remise du colis au transporteur. Cela ne signifie pas que le colis est en transit, livré, distribué ou reçu par le client.

Les snapshots Phase 5A (`shippingCents`, version de devis, méthode et poids) ne sont jamais recalculés. La Phase 5C ajoute :

- la date de fin de préparation ;
- la source du suivi (`MANUAL`, `PROVIDER` réservé à une phase future) ;
- la date de saisie du suivi ;
- une révision monotone du suivi.

Les anciennes commandes déjà expédiées restent compatibles, y compris lorsqu'elles précèdent ces champs.

## Suivi manuel

Avant confirmation d'expédition, un Admin actif peut enregistrer ou corriger :

- un libellé générique de transporteur ou mode ;
- un numéro de suivi borné et validé côté serveur ;
- une URL facultative.

Le numéro n'impose aucun format Colissimo. L'URL, si présente, doit utiliser `https://`, ne peut contenir ni identifiant ni mot de passe et reste bornée à 1 000 caractères. Les schémas `http`, `javascript`, `data`, `file` et `ftp` sont refusés.

Une saisie rejouée à l'identique est un no-op. Une correction avant expédition incrémente la révision et crée un nouvel événement d'audit. Une expédition confirmée ne peut plus être modifiée par ce parcours.

## Audit et notifications

Le journal append-only existant reçoit :

- `PREPARATION_STARTED` ;
- `SHIPMENT_READY` ;
- `TRACKING_RECORDED` ;
- `ORDER_SHIPPED`.

Chaque événement référence la ShopOrder, l'Admin, l'horodatage et les snapshots strictement nécessaires. La notification client `CUSTOMER_SHOP_SHIPPED` utilise sa clé d'idempotence existante et est créée dans la même transaction que la confirmation. Un replay ou deux confirmations concurrentes n'ajoutent ni événement ni notification.

## Sécurité et QA locale

Toutes les mutations sont serveur, exigent un Admin actif, verrouillent la ShopOrder et revalident son état. Les formulaires utilisent des confirmations exactes et bénéficient des protections Auth/CSRF/origin existantes.

La preview HTTP optimisée n'est autorisée que par le contrat Phase 5C cumulatif : origine `127.0.0.1:31777`, cible Prisma Dev dédiée, PostgreSQL loopback sur port non standard, paiements et transports externes désactivés, notifications capture, aucune variable Railway et aucun secret provider. Une configuration ambiguë reste fail-closed et conserve les cookies `Secure`.

## Limites et futur provider

Sont explicitement hors périmètre :

- API La Poste ou Colissimo ;
- OAuth ou credentials transporteur ;
- création d'étiquette ou affranchissement ;
- webhook, polling ou tracking distant ;
- preuve réelle de livraison ;
- gestion multi-colis ;
- activation Production.

Une phase future pourra ajouter un adapter provider alimentant la source `PROVIDER`, un identifiant de shipment et une réconciliation de statut. Elle devra conserver les snapshots historiques et ne pourra pas transformer les états locaux actuels en preuve transporteur rétroactive.
