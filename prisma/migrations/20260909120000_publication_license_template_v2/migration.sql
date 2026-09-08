-- Add the human-decided publication licence as a new legal draft.
-- The previous template and every generated document remain immutable.
-- This migration does not approve the model and cannot open commerce.
INSERT INTO "contract_templates" (
  "id", "type", "version", "title", "status", "sourceMarkup", "createdAt"
)
SELECT
  gen_random_uuid(),
  'PUBLICATION_LICENSE',
  2,
  'Conditions particulières - Licence de publication via distributeur',
  'DRAFT',
  $template$
# CONDITIONS PARTICULIÈRES — LICENCE DE PUBLICATION VIA DISTRIBUTEUR

Contrat : {{contractNumber}}
Version générée le {{generatedDate}}
Commande : {{orderNumber}}
Demande : {{requestNumber}}

## Parties et œuvre
LNX Beats : {{lnxIdentity}}
Client : {{clientName}}
Adresse : {{clientAddress}}
Œuvre : {{workTitle}}
Nom d’artiste : {{artistName}}

## Objet et droits
La licence porte exclusivement sur cette œuvre. Elle autorise sa reproduction, sa distribution et sa communication au public strictement nécessaires à sa publication via un distributeur numérique, sur les plateformes de streaming et de téléchargement desservies par ce distributeur.

{{rightsMatrix}}

Plateformes : {{platforms}}
Territoire : monde entier
Durée : cinq ans à compter de la prise d’effet
Prix unique : {{price}}

La licence est non exclusive, n’emporte aucune cession complète de propriété intellectuelle et ne porte pas atteinte aux droits moraux. Elle ne peut être transférée ou revendue. Une sous-licence est permise uniquement dans la mesure techniquement nécessaire au distributeur choisi, pour la durée et le périmètre de la licence.

Toute adaptation substantielle nécessite un accord écrit distinct de LNX Beats. Aucun Content ID exclusif ni aucune revendication portant atteinte aux droits de LNX Beats n’est autorisé sans accord écrit. Le client crédite LNX Beats selon le rôle réellement prévu dans l’œuvre et veille à l’exactitude des métadonnées transmises au distributeur.

## Obligations et garanties
Le client garantit disposer des droits nécessaires sur les éléments, visuels, noms, marques et métadonnées qu’il ajoute. Il respecte les conditions du distributeur et des plateformes et n’accorde pas à un tiers plus de droits que ceux prévus au contrat.

LNX Beats garantit seulement être habilité à consentir les droits expressément accordés au titre de ses propres contributions. LNX Beats ne garantit ni l’acceptation par un distributeur ou une plateforme, ni un référencement, ni un volume d’écoute, ni un revenu.

## Prise d’effet et limites
La licence ne prend effet qu’après paiement confirmé de 150,00 EUR, acceptation conservée, génération valide du document contractuel final et expiration du délai légal de rétractation. Un projet, une acceptation incomplète ou un paiement incomplet n’accorde aucun droit.

Aucun commencement anticipé n’est automatique. S’il est proposé ultérieurement, il exige une demande expresse distincte du client, sans case précochée, ainsi que la reconnaissance distincte des conséquences légales applicables. Ces preuves doivent être conservées sur un support durable.

## Rétractation, retrait et fin de la licence
Le consommateur dispose du délai légal de rétractation applicable aux contrats conclus à distance. La fonctionnalité en ligne de rétractation et les coordonnées de contact sont celles publiées par LNX STUDIO. L’exercice d’un droit légal ne peut être neutralisé par le contrat.

À l’expiration normale de la licence, ou après sa résolution dans les conditions légalement applicables, le client cesse les nouvelles exploitations et demande dans un délai raisonnable le retrait de la publication à son distributeur. Les délais techniques de plateformes tierces peuvent subsister.

En cas de manquement suffisamment grave, la partie concernée peut demander la résolution après une mise en demeure écrite restée sans effet pendant trente jours, sauf urgence ou règle impérative permettant une mesure plus rapide. Les conséquences financières restent soumises aux règles légales applicables et à la situation effectivement exécutée.

## Responsabilité, droit applicable et litiges
Chaque partie répond de ses obligations dans les limites permises par la loi. Aucune clause ne prive le consommateur d’une garantie ou d’un recours impératif. Les informations personnelles sont traitées selon la politique de confidentialité publiée par LNX STUDIO.

Le contrat est soumis au droit français, sans priver le consommateur de ses protections impératives. Une réclamation préalable peut être adressée à LNX Beats. En cas de désaccord persistant, le consommateur peut saisir gratuitement le médiateur indiqué dans les mentions légales, sans préjudice de son droit de saisir la juridiction compétente.

Les droits non expressément accordés restent non accordés. La licence ne garantit ni acceptation par un distributeur, ni succès commercial, ni revenu minimum, ni validation ou revenu SACEM, ni Content ID, ni placement éditorial.

STATUT : PROJET — NON ACTIF — VALIDATION JURIDIQUE EXTERNE REQUISE. Les clauses de rétractation, commencement anticipé, résolution, retrait, responsabilité et règlement des litiges doivent être approuvées dans une revue juridique référencée avant toute approbation du modèle et toute ouverture commerciale.
  $template$,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "contract_templates"
  WHERE "type" = 'PUBLICATION_LICENSE' AND "version" = 2
);
