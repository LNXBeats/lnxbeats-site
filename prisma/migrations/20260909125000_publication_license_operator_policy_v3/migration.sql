-- Final operator-approved publication licence policy. This creates a new
-- immutable DRAFT version; it does not approve a legal model or open commerce.
INSERT INTO "contract_templates" (
  "id", "type", "version", "title", "status", "sourceMarkup", "createdAt"
)
SELECT
  gen_random_uuid(),
  'PUBLICATION_LICENSE',
  3,
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
La présente licence porte exclusivement sur l’œuvre identifiée ci-dessus. Elle autorise, dans les limites du présent contrat, sa reproduction, sa distribution et sa communication au public strictement nécessaires à sa publication par le client via un distributeur numérique, sur les plateformes de streaming et de téléchargement desservies par ce distributeur.

## Droits expressément accordés
{{rightsMatrix}}

Plateformes et supports : {{platforms}}
Territoire : monde entier
Durée : cinq ans à compter de la prise d’effet
Prix unique : {{price}}

La licence est non exclusive. Elle n’emporte aucune cession complète de propriété intellectuelle et ne porte pas atteinte aux droits moraux légalement attachés à l’œuvre. Le client ne peut ni transférer ni revendre la licence. Une sous-licence est permise uniquement dans la mesure techniquement nécessaire au distributeur choisi, pour la durée et le périmètre de la licence.

Toute adaptation substantielle nécessite un accord écrit distinct de LNX Beats. Aucun Content ID exclusif ni aucune revendication portant atteinte aux droits de LNX Beats n’est autorisé sans accord écrit. Le client crédite LNX Beats selon le rôle réellement prévu dans l’œuvre et veille à l’exactitude des métadonnées transmises au distributeur.

## Obligations et garanties
Le client garantit disposer des droits nécessaires sur les éléments, visuels, noms, marques et métadonnées qu’il ajoute à la publication. Il respecte les conditions du distributeur et des plateformes et n’accorde pas à un tiers plus de droits que ceux prévus au présent contrat.

LNX Beats garantit seulement être habilité à consentir les droits expressément accordés au titre de ses propres contributions. LNX Beats ne garantit ni l’acceptation de la publication par un distributeur ou une plateforme, ni un référencement, ni un volume d’écoute, ni un revenu.

## Prise d’effet
La licence ne prend effet qu’après paiement confirmé du prix de 150,00 EUR, acceptation conservée, génération valide du document contractuel final, absence de rétractation et expiration complète du délai de rétractation de quatorze jours. Un projet, une acceptation incomplète ou un paiement incomplet n’accorde aucun droit.

Aucun commencement anticipé ni renoncement anticipé n’est proposé dans cette version. La licence reste sans effet pendant toute la période de rétractation.

## Rétractation, retrait et fin de la licence
Le consommateur dispose du délai légal de rétractation applicable aux contrats conclus à distance. La fonctionnalité en ligne de rétractation et les coordonnées de contact sont celles publiées par LNX STUDIO. L’exercice d’un droit légal ne peut être neutralisé par une clause du présent contrat.

À l’expiration normale de la licence, ou après sa résolution dans les conditions légalement applicables, le client cesse les nouvelles exploitations et demande dans un délai raisonnable le retrait de la publication à son distributeur. Les copies, délais de cache et traitements déjà engagés par des plateformes tierces peuvent subsister pendant leur délai technique normal.

En cas de manquement suffisamment grave, la partie concernée peut demander la résolution après une mise en demeure écrite restée sans effet pendant trente jours. Une suspension immédiate n’est possible que lorsqu’elle est nécessaire pour faire cesser une situation grave, illicite ou manifestement préjudiciable, ou lorsqu’une règle impérative l’exige. Les conséquences financières et les éventuels remboursements restent soumis aux règles légales applicables et à la situation effectivement exécutée.

## Responsabilité, droit applicable et litiges
Chaque partie répond de ses propres obligations dans les limites permises par la loi. Aucune clause ne prive le consommateur d’une garantie ou d’un recours impératif. Les informations personnelles sont traitées selon la politique de confidentialité publiée par LNX STUDIO.

Le contrat est soumis au droit français, sans priver le consommateur des protections impératives dont il bénéficie. Une réclamation préalable peut être adressée à LNX Beats. En cas de désaccord persistant, le consommateur peut saisir gratuitement le CM2C selon les coordonnées indiquées dans les mentions légales, sans préjudice de son droit de saisir la juridiction compétente.

Les droits non expressément accordés restent non accordés. LNX Beats conserve les droits correspondant à ses contributions créatives. La licence ne garantit ni acceptation par un distributeur, ni succès commercial, ni revenu minimum, ni validation ou revenu SACEM, ni Content ID, ni placement éditorial.

STATUT : PROJET — NON ACTIF — VALIDATION JURIDIQUE RÉFÉRENCÉE REQUISE. La politique contractuelle V2 a été approuvée par l’opérateur. Le modèle doit encore suivre le mécanisme normal d’approbation et de versioning avant toute ouverture commerciale ; cette mention ne vaut pas revue par un avocat externe.
  $template$,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "contract_templates"
  WHERE "type" = 'PUBLICATION_LICENSE' AND "version" = 3
);
