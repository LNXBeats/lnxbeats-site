# Guide Admin — Tarifs et Boutique (Phase 2 locale)

## Modifier un tarif

1. Ouvrir **Administration → Tarifs**.
2. Vérifier les montants actuels et l'historique.
3. Saisir les trois montants en euros.
4. Confirmer explicitement la création de la nouvelle version.
5. En cas de conflit, recharger la page avant de recommencer.

La Phase 2 conserve encore le runtime V1 en mode `legacy`. La nouvelle version
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

Le produit doit être en `DRAFT`. Dans **Visuel du produit**, choisir une image,
renseigner son texte alternatif et confirmer les droits de publication. Le
serveur valide le contenu réel et les dimensions, normalise le fichier en WebP,
le stocke via `MediaStorage` et associe un unique visuel principal en position
0. Ne pas créer ou relier un `Asset` manuellement.

Le remplacement, la suppression et la modification du texte alternatif sont
protégés contre les fiches concurrentes. Si le visuel a changé dans un autre
onglet, recharger la fiche. Dépublier d'abord un produit publié avant de
modifier son image.

## Mettre du stock

Activer **Suivre le stock**, enregistrer la quantité, puis utiliser
**Ajuster le stock** avec un delta et un motif. Une valeur négative finale est
refusée, tout comme une quantité qui ne couvrirait plus les réservations actives.
Les écritures concurrentes demandent de recharger la fiche. Chaque ajustement
conserve stock avant/après, delta, motif, acteur et date.

## Publier

La publication reste fermée sans titre, description, prix EUR positif, stock et
expédition cohérents, ainsi qu'une image principale publique valide avec droits
et texte alternatif. Un produit `PUBLISHED` n'apparaît dans le catalogue
dynamique que lorsque le gate local Phase 2 est explicitement armé. En dehors
de cette QA loopback, `SHOP_ENABLED=false` doit rester en place.

## Voir les commandes Boutique

Ouvrir **Administration → Boutique → Commandes Boutique**. La liste
`/admin/boutique/commandes` peut être filtrée par commande ouverte, expirée ou
annulée. Le détail affiche :

- le compte propriétaire et les trois états commande/paiement/préparation ;
- les titres, quantités, prix et frais d'envoi snapshotés ;
- le statut des réservations et leur échéance ;
- l'adresse snapshotée lorsque l'envoi est requis ;
- le journal `ShopOrderEvent`.

Les montants ne viennent pas du navigateur : le serveur les a recalculés depuis
les produits au moment de créer la commande. Les frais d'envoi sont unitaires,
multipliés par la quantité de chaque ligne, puis additionnés au niveau commande.

## Marquer une commande expédiée

Indisponible dans la Phase 2. Les vues Admin sont strictement en lecture seule :
elles ne confirment aucun paiement, ne décrémentent aucun stock et ne changent
pas l'état de préparation. Paiement, préparation et expédition restent en
Phase 3.

## Annulation et expiration

Le membre peut annuler depuis `/compte/achats/[orderNumber]` une commande encore
`OPEN` et `AWAITING_PAYMENT`; les réservations actives sont alors libérées et
l'opération est journalisée. L'expiration n'est pas un bouton Admin : la
primitive serveur bornée fait passer les réservations échues à `EXPIRED` et la
commande à `EXPIRED`. Aucun scheduler de Production n'est activé.

Une réservation ne décrémente pas le stock physique. Tant qu'elle est active et
non échue, elle réduit seulement la disponibilité calculée. La QA locale utilise
30 minutes, valeur explicitement configurable entre 5 et 120 minutes.

## Gate et limites de la Phase 2

La procédure d'activation locale et les comptes synthétiques sont décrits dans
[`SHOP_PHASE2_LOCAL_QA.md`](SHOP_PHASE2_LOCAL_QA.md). Elle exige une origine
loopback, un runtime non-Production, une confirmation non secrète, une allowlist
pays et une durée explicite. Elle interdit les services externes.

Il n'existe aucun Checkout Boutique, appel Stripe/PayPal, webhook, facture,
notification ou action d'expédition dans cette phase. Les états financiers sont
préparatoires. La Phase 3 et toute ouverture Production restent différées.
