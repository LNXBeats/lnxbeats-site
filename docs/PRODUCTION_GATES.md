# Gates de production

V0.7.8 prépare les notifications de production sur une branche feature, sans déploiement ni activation. Les gates suivants restent obligatoires :

- `SECURITY ADVISORY RESOLVED` : V0.7.7 conserve Prisma 7.9.1 et force sa dépendance transitive vers `deepmerge-ts` 8.0.2. Le PoC local, les installations complète/production, Prisma, les migrations et les runtimes sont validés. Voir [SECURITY_ADVISORIES.md](SECURITY_ADVISORIES.md). Ce point ne lève aucun autre gate production.
- `PRODUCTION BLOCKED — LEGAL REVIEW REQUIRED` : les modèles droits/contrats restent soumis à revue juridique. Les notifications ne contournent pas ce gate.
- `PRODUCTION BLOCKED — NOTIFICATION ACTIVATION HUMAN REQUIRED` : l'architecture, les gardes, le preflight et le runbook V0.7.8 peuvent être validés localement, mais aucune configuration production, aucun cron/worker, aucun webhook Dashboard et aucun destinataire réel ne sont activés automatiquement.
- e-mail production : l'ouverture exige simultanément l'environnement `production`, la confirmation explicite V0.7.8, Resend pour l'Auth et l'outbox, les audiences choisies, le worker explicitement activé, un domaine From/Reply-To contrôlé sous `lnxbeats.fr`, les secrets dans le coffre et un preflight `PASS`. Toute combinaison incomplète échoue fermée.
- staging : les destinataires client restent limités aux adresses de test officielles Resend et à `NOTIFICATION_STAGING_RECIPIENT_ALLOWLIST`; la destination propriétaire reste la variable serveur exacte et son flag dédié. Ces gardes ne confèrent aucune autorisation production.
- Stripe Live, SMS réel, Railway, OVH/DNS et déploiement restent inchangés.
- `PRODUCTION BLOCKED — REFUND/DISPUTE STAGING QA REQUIRED` : le moteur V0.7.6 doit être validé humainement avec Stripe Test et PayPal Sandbox (total, partiel, timeout, webhook tardif, reversal et dispute) avant toute ouverture Live.

Avant une future ouverture : maintenir le contrôle de l’override Prisma ; revue juridique ; domaine Resend vérifié ; test delivered/bounce/complaint/suppressed ; retry concurrent ; monitoring des `REQUIRES_REVIEW` ; validation propriétaire mobile ; rotation/procédure secrets ; backup et migration additive ; rollback vers `disabled` documenté. Voir [PRODUCTION_NOTIFICATIONS.md](PRODUCTION_NOTIFICATIONS.md) et [NOTIFICATION_RUNBOOK.md](NOTIFICATION_RUNBOOK.md).
