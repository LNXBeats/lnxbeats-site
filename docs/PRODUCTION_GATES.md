# Gates de production

V0.7.3 reste local/staging. Les gates suivants sont obligatoires :

- `PRODUCTION BLOCKED — SECURITY ADVISORY OPEN` : Prisma 7.9.1 dépend de `deepmerge-ts` 7.1.5 et l’audit remonte CVE-2026-40345. Prisma 8 est encore RC ; aucun override, downgrade forcé ou version RC n’est introduit dans ce sprint.
- `PRODUCTION BLOCKED — LEGAL REVIEW REQUIRED` : les modèles droits/contrats restent soumis à revue juridique. Les notifications ne contournent pas ce gate.
- `PRODUCTION BLOCKED — TRANSACTIONAL EMAIL STAGING QA REQUIRED` : le domaine `email.lnxbeats.fr` est vérifié, mais le webhook, le worker staging et les scénarios delivered/bounce/complaint/suppressed restent à valider après déploiement contrôlé.
- e-mail production : le parseur refuse tout transport actif lorsque `NOTIFICATION_DEPLOYMENT_ENV=production`. Le webhook public, le worker/cron, les suppressions et la validation humaine doivent faire l’objet d’une ouverture dédiée.
- Stripe Live, SMS réel, Railway, OVH/DNS et déploiement restent inchangés.
- `PRODUCTION BLOCKED — REFUND/DISPUTE STAGING QA REQUIRED` : le moteur V0.7.6 doit être validé humainement avec Stripe Test et PayPal Sandbox (total, partiel, timeout, webhook tardif, reversal et dispute) avant toute ouverture Live.

Avant une future ouverture : sprint sécurité Prisma dédié ; revue juridique ; domaine Resend vérifié ; test delivered/bounce/complaint/suppressed ; retry concurrent ; monitoring des `REQUIRES_REVIEW` ; validation propriétaire mobile ; rotation/procédure secrets ; backup et migration additive ; rollback vers `disabled` documenté.
