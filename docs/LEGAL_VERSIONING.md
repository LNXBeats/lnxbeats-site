# Versioning juridique

## États

`DRAFT` → `AWAITING_LEGAL_REVIEW` → `APPROVED` → `ACTIVE` → `RETIRED`.

La Phase 4 autorise uniquement `DRAFT` et `AWAITING_LEGAL_REVIEW`. Le registre applicatif lève une erreur si une candidate porte une date d’effet, une approbation ou un statut actif.

## Preuve

`LegalDocumentVersion` conserve type, version, SHA-256, création, effet, statut, approbateur, date, référence de revue et version remplacée. La base impose une seule version `ACTIVE` par type et la cohérence des dates/approbations.

`ShopOrder` conserve déjà `termsVersion`, `termsHashSha256`, `termsAcceptedAt` et `userId`. `Order` conserve le snapshot d’usage personnel. Ces snapshots deviennent immuables pour la commande et ne sont jamais remplacés lors d’une nouvelle publication.

## Commencement anticipé — décision candidate Phase 4C

La formulation candidate n’est pas activée dans Commander. Avant une activation future, l’étape finale devra présenter une case distincte, non précochée, séparée de l’usage personnel. La preuve devra conserver au minimum le choix, la version, l’empreinte SHA-256 et l’horodatage côté serveur.

Les champs `personalUseTerms*` existants ne constituent pas une preuve distincte adaptée et ne doivent pas être détournés. Une extension additive du modèle `Order`, accompagnée d’un gate empêchant le passage en création avant quatorze jours lorsque la demande n’a pas été formulée, devra être auditée séparément après validation juridique professionnelle. Aucune migration ni collecte runtime n’est introduite en Phase 4C.

## QA historique

`shop-cgv-phase3-qa-v1` et `shop-cgv-phase3-qa-v0` demeurent `QA_ONLY`. `lib/shop/legal.ts` interdit leur utilisation dans un runtime `NODE_ENV=production` et exige un loopback HTTP explicitement armé.

## Activation future

1. revue juridique et comptable ;
2. décisions logistiques ;
3. contenu final figé ;
4. SHA-256 recalculé ;
5. insertion `APPROVED` avec approbateur/référence ;
6. backup/PITR ;
7. activation atomique de la nouvelle version et retrait de l’ancienne ;
8. QA pages, acceptation, accusé durable et paiements ;
9. seulement ensuite, décision humaine sur les gates Shop.
