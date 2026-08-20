# PDF contractuels et archivage privé

## Génération

Les PDF sont générés côté serveur par PDFKit, sans ressource distante ni JavaScript. Le rendu A4 utilise les polices intégrées, du texte sélectionnable, une pagination, un pied de page, les références Order/Request, la version du modèle, la date Europe/Paris et une empreinte visible.

La génération a lieu uniquement lors d’une création de version. Une consultation ne régénère pas le document. Les contenus clients sont normalisés, bornés et rendus comme texte ; les templates n’acceptent qu’une allowlist de placeholders et aucune expression/code/accès environnement/chemin.

## Stockage et accès

Chaque document possède un `Asset` de type `DOCUMENT`, rôle de commande `CONTRACT`, backend `OBJECT`, provider `r2`, visibilité `PRIVATE`, clé opaque et hash SHA-256. Aucune URL publique persistante n’est stockée. La route authentifiée prend en charge GET/HEAD, affichage ou téléchargement, `private, no-store`, `nosniff`, ETag et contrôle propriétaire/Admin. Autre membre/anonyme : refus neutre.

## Versions et conservation

Un document accepté n’est jamais écrasé. La correction crée une version et une clé R2 distinctes ; l’ancienne version reste lisible. L'acceptation client produit aussi une preuve PDF privée distincte (`ACCEPTANCE_RECEIPT`) qui référence le hash exact du contrat, son numéro, sa version et l'horodatage serveur. Le modèle, le contrat et cette preuve sont protégés contre la suppression/cascade destructrice par des clés étrangères `RESTRICT` et des triggers d’immutabilité.

Les montants cibles 150 € et 1 500 € dépassent 120 €. Les articles [L213-1](https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000032226994/2024-03-24), [D213-1](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032807208) et [D213-2](https://www.legifrance.gouv.fr/jorf/article_jo/JORFARTI000032798142) du Code de la consommation fondent la préparation d’un archivage de dix ans pour un contrat effectivement conclu. `retentionUntil` est donc prévu, mais reste nul pour les simples brouillons/acceptations QA tant que le workflow juridiquement validé ne définit pas le point de conclusion. Une future activation devra fixer la date, permettre un legal hold et préserver l’accès permanent.

## QA visuelle

Le générateur fournit `npm run test:contracts:pdf-render`. Le contrôle exige `pdfinfo`, extraction de texte et rendu PNG (`pdftoppm`) afin de vérifier coupures, chevauchements, accents, tableaux et filigrane. Le PDF échantillon reste un artefact local ignoré par Git.
