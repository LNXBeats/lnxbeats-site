# Versioning juridique

## États

`DRAFT` → `AWAITING_LEGAL_REVIEW` → `APPROVED` → `ACTIVE` → `RETIRED`.

La Phase 4 autorise uniquement `DRAFT` et `AWAITING_LEGAL_REVIEW`. Le registre applicatif lève une erreur si une candidate porte une date d’effet, une approbation ou un statut actif.

## Preuve

`LegalDocumentVersion` conserve type, version, SHA-256, création, effet, statut, approbateur, date, référence de revue et version remplacée. La base impose une seule version `ACTIVE` par type et la cohérence des dates/approbations.

`ShopOrder` conserve déjà `termsVersion`, `termsHashSha256`, `termsAcceptedAt` et `userId`. `Order` conserve séparément le snapshot d’usage personnel et la preuve de demande de commencement anticipé. Chaque preuve associe une version, une empreinte SHA-256 et un horodatage serveur.

## Commencement anticipé — implémentation finale locale

Commander présente une case distincte, non précochée, séparée de l’usage personnel. Le serveur ignore toute version fournie par le navigateur, relit la candidate musicale courante et conserve `earlyPerformanceConsentVersion`, `earlyPerformanceConsentHashSha256` et `earlyPerformanceConsentAcceptedAt`.

Les champs `personalUseTerms*` existants ne sont pas détournés. Une contrainte PostgreSQL impose une preuve entièrement nulle ou entièrement renseignée et une empreinte SHA-256 valide. Le premier enregistrement et tout renouvellement de version s’effectuent sous le verrou transactionnel de la commande. Le checkout Stripe/PayPal refuse une preuve absente ou qui ne correspond plus à la candidate musicale courante.

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
