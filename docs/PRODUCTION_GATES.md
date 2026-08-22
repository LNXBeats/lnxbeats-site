# Gates de production

V0.7.3 reste local/staging. Les gates suivants sont obligatoires :

- `SECURITY ADVISORY RESOLVED` : V0.7.7 conserve Prisma 7.9.1 et force sa dépendance transitive vers `deepmerge-ts` 8.0.2. Le PoC local, les installations complète/production, Prisma, les migrations et les runtimes sont validés. Voir [SECURITY_ADVISORIES.md](SECURITY_ADVISORIES.md). Ce point ne lève aucun autre gate production.
- `PRODUCTION BLOCKED — LEGAL REVIEW REQUIRED` : les modèles droits/contrats restent soumis à revue juridique. Les notifications ne contournent pas ce gate.
- `PRODUCTION BLOCKED — TRANSACTIONAL EMAIL STAGING QA REQUIRED` : le domaine `email.lnxbeats.fr` est vérifié, mais le webhook, le worker staging et les scénarios delivered/bounce/complaint/suppressed restent à valider après déploiement contrôlé.
- e-mail production : le parseur refuse tout transport actif lorsque `NOTIFICATION_DEPLOYMENT_ENV=production`. Le webhook public, le worker/cron, les suppressions et la validation humaine doivent faire l’objet d’une ouverture dédiée.
- Stripe Live, SMS réel, Railway, OVH/DNS et déploiement restent inchangés.
- `PRODUCTION BLOCKED — REFUND/DISPUTE STAGING QA REQUIRED` : le moteur V0.7.6 doit être validé humainement avec Stripe Test et PayPal Sandbox (total, partiel, timeout, webhook tardif, reversal et dispute) avant toute ouverture Live.

Avant une future ouverture : maintenir le contrôle de l’override Prisma ; revue juridique ; domaine Resend vérifié ; test delivered/bounce/complaint/suppressed ; retry concurrent ; monitoring des `REQUIRES_REVIEW` ; validation propriétaire mobile ; rotation/procédure secrets ; backup et migration additive ; rollback vers `disabled` documenté.
