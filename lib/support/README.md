# Soutien libre — domaine isolé, test uniquement

Cette première livraison reste **impossible à activer sur Production** :
`SUPPORT_ENABLED=true`, `SUPPORT_TEST_MODE=true`, un contexte non Production et
une origine locale/Preview sont requis. Le CHECK DB impose `mode=TEST`.
L'ouverture Live exige un lot explicite après les gates providers/juridiques.

Le domaine ne crée ni commande, facture, email, avantage, droit ou reçu fiscal.
Le registre Admin/export est distinct de la vente. Aucun email provider n'est
collecté ou réutilisé. Les trois tables ajoutées sont indépendantes des ventes.

## Configuration Preview

- Réutiliser les credentials TEST du compte Stripe existant :
  `STRIPE_MODE=test`, `STRIPE_SECRET_KEY` (de préférence clé restreinte).
- Endpoint dédié `/api/support/webhooks/stripe`, secret dédié
  `SUPPORT_STRIPE_WEBHOOK_SECRET`. Événements : checkout.session.completed,
  async_payment_succeeded, async_payment_failed, expired.
- Réutiliser PayPal Professionnel SANDBOX : `PAYPAL_ENVIRONMENT=sandbox`,
  `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `SUPPORT_PAYPAL_WEBHOOK_ID` dédié.
  Endpoint `/api/support/webhooks/paypal`, capture completed/pending/declined.
- Aucune modification des kill switches ou webhooks Commander/Boutique/Rights.
- `SUPPORT_MIN_CENTS` / `SUPPORT_MAX_CENTS` optionnels, défaut 100–50000 EUR cents.
  Configuration bornée elle-même entre 1 et 500 €, validation exclusivement serveur.

## Sessions et idempotence

Le navigateur appelle d'abord POST `/api/support/session`, attend le cookie
HTTPOnly/Secure/SameSite=Lax, puis POST `/api/support/checkout` avec provider,
montant et clé UUID stable. La clé provider est liée à une contribution durable.
Un timeout ne génère jamais une autre clé. Les reprises ambiguës sont refusées
après 30 minutes, bien avant l'expiration des garanties d'idempotence provider.
Les retours navigateur ne prouvent jamais le paiement. PayPal est capturé via
un POST explicite, la référence provider vient de la DB (pas du token URL).

Les callbacks vérifient la signature brute/postback, le contexte TEST,
référence, montant, devise et identité. Ils continuent à réconcilier quand le
flag d'ouverture checkout est OFF, tant que le contexte TEST reste configuré.
Les événements sont uniques, append-only, sérialisés par verrou transactionnel.
Les événements tardifs ne dégradent jamais un succès ou un remboursement.
L'état courant est revalidé avant toute reprise d'une tentative : un dossier
passé en revue obligatoire ne peut plus capturer ou rembourser. Une réponse
capture PENDING attend le webhook et ne relance jamais la capture, même après
expiration de la fenêtre de reprise.

## Remboursement

Admin authentifié, confirmation `REMBOURSER <UUID>`, remboursement intégral
uniquement. Une tentative durable/idempotente et un événement d'audit précèdent
l'appel provider. Un résultat ambigu reste bloquant. Un remboursement en attente
est recontrôlé via `retrieveRefund` lors d'une nouvelle action Admin explicite,
sans créer un second remboursement. Un échec exige une revue manuelle.
Aucun remboursement Live n'est possible ni testé.

## Preuves et réserves

### Release V4 fermée — permissions minimales

Le provisionnement de release utilise le groupe NOLOGIN `lnx_support_readonly`,
distinct de Créations. Seules les lectures Admin réellement utilisées sont
accordées : SELECT sur `support_contributions` et `support_contribution_events`.
`support_contribution_attempts` n'est pas accessible. Aucun INSERT/UPDATE/DELETE,
TRUNCATE, maintenance, DDL ou GRANT OPTION ; aucun accès ajouté à l'historique
Prisma ni aux tables financières existantes. Les propriétaires restent les rôles
de migration et le LOGIN runtime est fourni dynamiquement, pas codé en dur.

Le provisionneur normalise uniquement les trois tables soutien, retire leurs
anciens grants au groupe Créations et vérifie les privilèges effectifs runtime.
Il échoue si un autre héritage donne encore des droits excessifs. Le mécanisme
Créations/audit commandes reste inchangé. Ce provisionneur fermé n'est pas un
provisionneur pour une ouverture TEST/LIVE ultérieure.

Test réel local : `MIGRATION_DATABASE_URL=<base locale *_test>` puis
`node --conditions=react-server --import tsx scripts/test-support-closed-runtime.ts`.
Deux LOGIN distincts du propriétaire, quatre appels de provisioning, lectures
Prisma représentatives, refus 42501 des écritures et conservation des ACL
historiques. Ne jamais lancer ce script sur une base non jetable.

`tests/support/disabled-release.test.ts` exerce directement les routes fermées :
503 avant DB, rate-limit écrit, cookie ou fournisseur. Les endpoints de paiement
Commander/Boutique ne sont pas modifiés.

Tests unitaires et HTTP local : configuration, montant, signatures Stripe SDK,
CSRF, lecteurs bornés, scope grants, transitions et séparation comptable.
`scripts/test-support-runtime.ts` utilise exclusivement PostgreSQL local jetable
`lnx_vfinal_support_test` et providers **fakes** : races checkout/capture,
20 callbacks dupliqués, timeout/reprise, échéance, IDOR et compteurs financiers.
Ces tests ne constituent **pas** une recette Stripe/PayPal réelle.
Sans credentials sandbox disponibles et tests réels, les deux gates providers
restent PENDING et le module Production reste OFF.
