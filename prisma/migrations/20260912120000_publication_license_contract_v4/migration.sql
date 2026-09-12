-- V1.2.0: additive publication licence v4 DRAFT candidate.
-- Historical templates remain immutable; this migration neither approves the
-- candidate nor opens Rights commerce.
INSERT INTO "contract_templates" (
  "id", "type", "version", "title", "status", "sourceMarkup", "createdAt"
)
SELECT
  '6c5ff2e2-056f-4ac0-ab28-6a74fb06301c'::uuid,
  'PUBLICATION_LICENSE',
  4,
  'Conditions particulières - Licence de publication via distributeur',
  'DRAFT',
  $template$
# CONDITIONS PARTICULIÈRES — LICENCE DE PUBLICATION VIA DISTRIBUTEUR

Contrat : {{contractNumber}}
Version générée le {{generatedDate}}
Commande : {{orderNumber}}
Demande : {{requestNumber}}

## Parties
LNX Beats : {{lnxIdentity}}
Client : {{clientName}}
Adresse : {{clientAddress}}

## Œuvre concernée
Titre : {{workTitle}}
Nom d’artiste : {{artistName}}

## Objet
La présente licence porte exclusivement sur l’œuvre identifiée ci-dessus. Elle autorise, dans les limites du présent contrat, sa publication par le client via le distributeur numérique identifié au document, sur les plateformes de streaming et de téléchargement qui y sont indiquées.

## Matrice exacte des droits accordés
- Reproduction : autorisée uniquement pour les copies techniques nécessaires à la livraison de l’œuvre au distributeur et à sa mise à disposition sur les plateformes autorisées.
- Distribution : autorisée uniquement sous forme numérique, par téléchargement, via le distributeur et les plateformes autorisés.
- Communication au public : autorisée uniquement par streaming et mise à disposition à la demande via le distributeur et les plateformes autorisés.
- Monétisation : autorisée pour les exploitations expressément accordées ci-dessus pendant la durée de la licence.
- Sous-licence technique : autorisée uniquement au distributeur choisi et aux plateformes qu’il dessert, dans la stricte mesure nécessaire à ces exploitations, sans élargissement du périmètre, du territoire ou de la durée.
- Adaptation : non accordée. Toute adaptation substantielle exige un accord écrit distinct de LNX Beats.
- Content ID : aucune revendication exclusive ni aucune revendication portant atteinte aux droits de LNX Beats n’est accordée.
- Transfert et revente : interdits. La licence est personnelle au client et non transférable.

Plateformes et supports : {{platforms}}
Territoire : monde entier
Durée : cinq années calendaires à compter de la prise d’effet
Rémunération forfaitaire : {{price}}

La licence est non exclusive. Elle n’emporte aucune cession complète de propriété intellectuelle et ne porte pas atteinte aux droits moraux légalement attachés à l’œuvre. Les droits non expressément accordés par la matrice ci-dessus restent non accordés.

Le client crédite LNX Beats selon le rôle réellement prévu dans l’œuvre et veille à l’exactitude des métadonnées transmises au distributeur.

## Transparence et reddition des informations d’exploitation
Le client adresse à LNX Beats, par voie électronique, au moins une fois par an et au plus tard dans les trente jours suivant chaque date anniversaire de la prise d’effet, des informations explicites et transparentes sur l’exploitation de l’œuvre. Cette reddition distingue chaque mode d’exploitation autorisé, notamment streaming, téléchargement et toute autre mise à disposition expressément couverte par le contrat, ainsi que les plateformes et territoires concernés.

Elle indique, pour la période écoulée, les quantités ou relevés d’exploitation disponibles, les revenus bruts attribuables à l’œuvre, les commissions et retenues appliquées, les revenus nets reçus, ainsi que toute rémunération due à LNX Beats pour chaque mode d’exploitation. Le client transmet les relevés correspondants fournis par son distributeur ou les plateformes, en pouvant masquer les informations étrangères à l’œuvre et les données personnelles non nécessaires. En l’absence d’exploitation ou de revenu, il adresse une déclaration électronique mentionnant cette absence. Une dernière reddition est adressée dans les trente jours suivant l’expiration ou la fin anticipée de la licence.

## Obligations et garanties
Le client garantit disposer des droits nécessaires sur les éléments, visuels, noms, marques et métadonnées qu’il ajoute à la publication. Il respecte les conditions du distributeur et des plateformes et n’accorde pas à un tiers plus de droits que ceux prévus au présent contrat.

LNX Beats garantit seulement être habilité à consentir les droits expressément accordés au titre de ses propres contributions. LNX Beats ne garantit ni l’acceptation de la publication par un distributeur ou une plateforme, ni un référencement, ni un volume d’écoute, ni un revenu.

## Conclusion, rétractation et prise d’effet
Le présent contrat à distance portant sur une prestation de licence est conclu lorsque le paiement intégral est confirmé après l’acceptation traçable du client et la validation du dossier par LNX Beats. Le délai légal de rétractation de quatorze jours court à compter de cette conclusion. La date de confirmation du paiement, conservée dans le dossier, constitue le point de départ appliqué par le parcours.

Ne sont proposés ni commencement anticipé ni renonciation anticipée. La licence reste sans effet pendant toute la période de rétractation et ne prend effet qu’après paiement confirmé, acceptation conservée, génération valide du document contractuel final, absence de rétractation et expiration complète du délai de quatorze jours. Un projet, une acceptation incomplète ou un paiement incomplet n’accorde aucun droit.

Le consommateur peut exercer son droit au moyen de la fonctionnalité en ligne et des coordonnées de contact publiées par LNX STUDIO, ou au moyen du formulaire type reproduit ci-dessous. L’exercice d’un droit légal ne peut être neutralisé par une clause du présent contrat.

## Formulaire type de rétractation
Veuillez compléter et renvoyer le présent formulaire uniquement si vous souhaitez vous rétracter du contrat.

À l’attention de Ludovic Mickaël Mathon, entrepreneur individuel — LNX Beats, 35 Impasse des Orties, 07370 Ozon, France — lnx.beats.pro@gmail.com :

Je vous notifie par la présente ma rétractation du contrat de prestation de licence de publication via distributeur portant sur l’œuvre suivante : ____________________

Contrat ou demande numéro : ____________________
Contrat conclu le : ____________________
Nom du consommateur : ____________________
Adresse du consommateur : ____________________
Date : ____________________
Signature du consommateur, uniquement en cas de notification sur papier : ____________________

## Retrait et fin de la licence
À l’expiration normale de la licence, ou après sa résolution dans les conditions légalement applicables, le client cesse les nouvelles exploitations et demande dans un délai raisonnable le retrait de la publication à son distributeur. Les copies, délais de cache et traitements déjà engagés par des plateformes tierces peuvent subsister pendant leur délai technique normal.

En cas de manquement suffisamment grave, la partie concernée peut demander la résolution après une mise en demeure écrite restée sans effet pendant trente jours. Une suspension immédiate n’est possible que lorsqu’elle est nécessaire pour faire cesser une situation grave, illicite ou manifestement préjudiciable, ou lorsqu’une règle impérative l’exige. Les conséquences financières et les éventuels remboursements restent soumis aux règles légales applicables et à la situation effectivement exécutée.

## Responsabilité, droit applicable et litiges
Chaque partie répond de ses propres obligations dans les limites permises par la loi. Aucune clause ne prive le consommateur d’une garantie ou d’un recours impératif. Les informations personnelles sont traitées selon la politique de confidentialité publiée par LNX STUDIO.

Le contrat est soumis au droit français, sans priver le consommateur des protections impératives dont il bénéficie. Une réclamation préalable peut être adressée à LNX Beats. En cas de désaccord persistant, le consommateur peut saisir gratuitement le CM2C selon les coordonnées indiquées dans les mentions légales, sans préjudice de son droit de saisir la juridiction compétente.

LNX Beats conserve les droits correspondant à ses contributions créatives. La licence ne garantit ni acceptation par un distributeur, ni succès commercial, ni revenu minimum, ni validation ou revenu SACEM, ni Content ID, ni placement éditorial.
  $template$,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "contract_templates"
  WHERE "type" = 'PUBLICATION_LICENSE' AND "version" = 4
);
