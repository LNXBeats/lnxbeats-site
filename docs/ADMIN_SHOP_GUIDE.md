# Guide Admin — Tarifs et Boutique (phase 1)

## Modifier un tarif

1. Ouvrir **Administration → Tarifs**.
2. Vérifier les montants actuels et l'historique.
3. Saisir les trois montants en euros.
4. Confirmer explicitement la création de la nouvelle version.
5. En cas de conflit, recharger la page avant de recommencer.

La phase 1 conserve encore le runtime V1 en mode `legacy`. La nouvelle version
est donc préparée et auditée, sans changer un paiement Live ni une commande
existante. Le cutover fera l'objet d'un gate financier séparé.

## Créer un produit

1. Ouvrir **Administration → Boutique → Nouveau produit**.
2. Renseigner le titre, la description et le prix.
3. Choisir si le stock est suivi et, le cas échéant, sa quantité.
4. Enregistrer : le produit est toujours créé en `DRAFT`.

## Mettre à jour ou archiver

La fiche produit permet de modifier les informations avec contrôle de version,
d'ajuster explicitement le stock avec un motif, puis d'archiver le produit.
L'archivage est préféré à toute suppression.

## Ajouter une photo

Indisponible dans la phase 1. Le futur écran réutilisera l'upload R2 public avec
validation du type réel, des dimensions et de la taille. Ne pas créer un
`Asset` manuellement en Production.

## Mettre du stock

Activer **Suivre le stock**, enregistrer la quantité, puis utiliser
**Ajuster le stock** avec un delta et un motif. Une valeur négative finale est
refusée et les écritures concurrentes demandent de recharger la fiche.

## Publier

La publication reste fermée sans image publique valide. Même publié dans la
fondation Admin, un produit n'est ni visible dans un catalogue dynamique ni
achetable tant que la phase 2 et `SHOP_ENABLED` ne sont pas autorisés.

## Voir une commande Boutique

Indisponible dans la phase 1 : aucun `ShopOrder` n'est encore créé.

## Marquer une commande expédiée

Indisponible dans la phase 1. Le workflow de préparation, suivi et expédition
sera ajouté après le modèle `ShopOrder` et sa revue juridique/logistique.

## État fermé de la phase 1

Le modèle d'image est préparé, mais l'upload R2 produit et l'ouverture publique
sont reportés à la phase 2. Panier, commandes Boutique, paiement et expédition
n'existent pas encore. `SHOP_ENABLED=false` doit rester en place.
