# Exigences juridiques de la future logistique

Colissimo n’est pas actif et aucune valeur tarifaire n’est codée par cette phase.

## Information avant paiement

- pays desservi ;
- caractéristiques, quantité et disponibilité ;
- délai de préparation et estimation de livraison ;
- transporteur/service ;
- frais exacts et total ;
- suivi/signature si applicable ;
- adresse de livraison validée ;
- droit de rétractation, adresse et coût de retour ;
- garanties légales et parcours SAV.

## Architecture future

Chaque produit devra porter son poids propre. Emballage, protection et calage devront être administrables séparément. Le poids facturable sera calculé puis snapshoté avec la grille tarifaire versionnée dans la ShopOrder. Le minimum interne de 150 g requiert une décision logistique ; il ne doit pas être présenté comme une règle La Poste.

Le suivi doit accepter une intégration automatisée et un fallback Admin manuel. Numéro, lien et état seront visibles au client. Aucun texte ne doit prétendre que les risques sont transférés dès la remise du colis au transporteur : la règle impérative de prise de possession physique doit être respectée.

## Gates

Voir `LEGAL_DECISIONS_REQUIRED.md` pour les huit décisions logistiques. Les tarifs, conditions Colissimo et zones devront être revérifiés dans les documents La Poste en vigueur au jour de l’activation.
