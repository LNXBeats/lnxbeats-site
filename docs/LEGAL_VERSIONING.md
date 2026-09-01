# Versioning juridique

## États

`DRAFT` → `AWAITING_LEGAL_REVIEW` → `APPROVED` → `ACTIVE` → `RETIRED`.

Les candidates historiques restent `DRAFT` ou `AWAITING_LEGAL_REVIEW`. La validation humaine finale V1.1.0 crée cinq nouvelles révisions immuables `APPROVED`, avec approbateur, horodatage et référence de revue. Elle ne modifie pas les candidates et ne leur attribue aucune date d’effet.

## Preuve

`LegalDocumentVersion` conserve type, version, SHA-256, création, effet, statut, approbateur, date, référence de revue et version remplacée. La base impose une seule version `ACTIVE` par type et la cohérence des dates/approbations.

`ShopOrder` conserve déjà `termsVersion`, `termsHashSha256`, `termsAcceptedAt` et `userId`. `Order` conserve séparément le snapshot d’usage personnel et la preuve de demande de commencement anticipé. Chaque preuve associe une version, une empreinte SHA-256 et un horodatage serveur.

## Commencement anticipé — implémentation finale locale

Commander présente une case distincte, non précochée, séparée de l’usage personnel. Le serveur ignore toute version fournie par le navigateur, relit la version musicale approuvée courante et conserve `earlyPerformanceConsentVersion`, `earlyPerformanceConsentHashSha256` et `earlyPerformanceConsentAcceptedAt`.

Les champs `personalUseTerms*` existants ne sont pas détournés. Une contrainte PostgreSQL impose une preuve entièrement nulle ou entièrement renseignée et une empreinte SHA-256 valide. Le premier enregistrement et tout renouvellement de version s’effectuent sous le verrou transactionnel de la commande. Le checkout Stripe/PayPal refuse une preuve absente ou qui ne correspond plus à la version musicale approuvée courante.

## Approbation humaine finale V1.1.0

Les versions `legal-notices-2026-04-approved`, `music-cgv-2026-04-approved`, `shop-cgv-2026-05-approved`, `privacy-2026-04-approved` et `withdrawal-2026-03-approved` enregistrent la validation humaine finale de Ludovic Mickaël Mathon, éditeur et exploitant. Cette référence ne constitue ni une validation par un avocat, ni un audit juridique externe.

Leur statut `APPROVED` est distinct de `ACTIVE` : `effectiveAt` reste nul. L’ouverture de la Boutique exige toujours une opération ultérieure, séparée et contrôlée de configuration/activation. `SHOP_ENABLED=false`, `SHOP_PAYMENTS_ENABLED=false` et `LIVE_REFUNDS_ENABLED=false` restent inchangés par cette approbation locale.

## QA historique

`shop-cgv-phase3-qa-v1` et `shop-cgv-phase3-qa-v0` demeurent `QA_ONLY`. `lib/shop/legal.ts` interdit leur utilisation dans un runtime `NODE_ENV=production` et exige un loopback HTTP explicitement armé.

## Activation future

1. révisions `APPROVED` relues et figées dans le code ;
2. déploiement contrôlé du code et de la migration additive du consentement ;
3. insertion/réconciliation en base des versions approuvées avec l’utilisateur Admin correspondant, sans altérer les candidates historiques ;
4. backup/PITR et contrôles read-only ;
5. activation atomique de la nouvelle version et retrait de l’ancienne ;
6. QA pages, acceptation, accusé durable et paiements ;
7. seulement ensuite, décision humaine sur les gates Shop.
