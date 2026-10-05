# Revue technique des événements financiers

## Diagnostic du 5 octobre 2026 (lectures Production uniquement)

Le reçu `checkout.session.expired` signalé à 19:04 UTC (21:04 Europe/Paris)
concerne un checkout LIVE de soutien de 20 EUR, pas une commande musicale.
Stripe confirme actuellement `expired`, `unpaid`, aucun PaymentIntent.
La contribution correspondante est `FAILED`, sans référence de paiement ou
de remboursement. Aucun Payment LNX ne correspond à cette session.

Le webhook historique des commandes reçoit aussi l'expiration du soutien.
Son normaliseur attend les références Payment/Order des commandes, absentes
des métadonnées `SUPPORT_LNX_BEATS`, et conserve donc REQUIRES_REVIEW.
Le webhook dédié du soutien a correctement enregistré PROVIDER_FAILED.
La liste Admin affichait un div sans lien et le cockpit pointait vers la liste
générique : aucune revue de cet événement précis n'était possible.

## Périmètre

- Détail authentifié `/admin/evenements-financiers/[id]`, navigation exacte,
  historique borné à 100 événements et date explicite Europe/Paris.
- Lecture Stripe GET uniquement, compte attendu obligatoire, modes concordants,
  délai borné et échec fermé. Aucune URL checkout, donnée client ou erreur brute.
- Classement explicitement confirmé, same-origin et rôle Admin actif revérifié.
- La preuve prestataire est relue avant la transaction, jamais pendant celle-ci.
- Seul le soutien lié déterministement, FAILED, expiré/unpaid sans PaymentIntent,
  sans remboursement, Payment, incident ou commande attendue est classable.
- Cas capturé, inconnu, PayPal ou métadonnées incompatibles : aucune action de
  classement. Aucun rapprochement automatique/arbitraire n'est ajouté.
- Transaction sérialisable, verrou du reçu, clé unique d'audit et reprise bornée.
- Le reçu signé, son outcome, le soutien, les paiements et commandes restent
  intacts. Les webhooks et les trois commandes refusées ne sont pas modifiés.
- L'exclusion de compteur porte seulement sur l'orphelin audité. Les obligations
  financières corrélées ultérieures restent visibles.

## Migration locale préparée, non appliquée en Production

`20261005230000_provider_event_technical_reviews` ajoute une table append-only.
Les journaux existants exigent une FK Payment/Invoice ; les réutiliser imposerait
un faux enregistrement financier. Cette table garde événement, acteur Admin,
date, motif et preuve expurgée ; elle interdit la suppression du reçu référencé.
Le provisionneur existant ajoute uniquement SELECT/INSERT sur cette table au
groupe stable déjà validé. Aucun nom de rôle runtime rotatif codé en dur ; aucun
GRANT global, ownership, UPDATE, DELETE, TRUNCATE ou DDL runtime ajouté.

La revue du schéma/ACL et les gates de migration Production restent à effectuer
avant une éventuelle promotion autorisée. Aucune action réelle n'a été exécutée.

## Validation reproductible

- `node --conditions=react-server --import tsx --test tests/admin/financial-event-review.test.ts tests/admin/operations.test.ts tests/auth/origin.test.ts tests/auth/roles.test.ts`
- Sur une base PostgreSQL 18 locale jetable nommée `lnx_financial_review_qa`,
  avec utilisateur owner QA puis runtime non propriétaire :
  `NODE_ENV=test NODE_OPTIONS=--conditions=react-server node --import tsx scripts/test-financial-event-review-runtime.ts`.
  DATABASE_URL doit pointer vers loopback et le owner QA, sans mot de passe.
  Appliquer les migrations dans cette base vide avant le test. Le test utilise
  uniquement des doubles Stripe et des données synthétiques, jamais Production.
- Prisma format/validate/generate, lint, typecheck, build et diff-check.

Pas de déploiement Preview ou Production réalisé ; ces preuves ne sont pas une
recette navigateur sur Production. La classification du reçu réel reste une
future décision humaine explicite après revue/promotion du candidat.
