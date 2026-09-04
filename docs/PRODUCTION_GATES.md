# Gates de production

V0.8.0.4 ajoute les outils CLI dry-run/apply pour le premier ADMIN, les 25 projets canoniques et les 14 médias manifestés. **Le code est prêt, mais aucune de ces opérations n'a été exécutée en Production.** Restent ouverts : consolidation dans `develop`, reconstruction de la branche de promotion, déploiement Railway contrôlé, migrations Production, bootstrap ADMIN réel, imports catalogue/média, QA Auth/R2, backups et diagnostics safe-disabled. Voir [PRODUCTION_BOOTSTRAP.md](PRODUCTION_BOOTSTRAP.md) et [MAIN_PROMOTION_RUNBOOK.md](MAIN_PROMOTION_RUNBOOK.md).

La preuve humaine `RAILWAY_VOLUME_NAME=ABSENT`, `RAILWAY_VOLUME_MOUNT_PATH=ABSENT` et `/data=ABSENT` retire l'hypothèse d'un volume historique Railway. L'ancien site écrivait néanmoins orders, contacts et uploads sur son filesystem runtime éphémère lorsque `PERSISTENT_ROOT` était absent ; aucune existence historique externe ne doit être inventée.

V0.7.8 prépare les notifications de production sur une branche feature, sans déploiement ni activation. Les gates suivants restent obligatoires :

- `SECURITY ADVISORY RESOLVED` : V0.7.7 conserve Prisma 7.9.1 et force sa dépendance transitive vers `deepmerge-ts` 8.0.2. Le PoC local, les installations complète/production, Prisma, les migrations et les runtimes sont validés. Voir [SECURITY_ADVISORIES.md](SECURITY_ADVISORIES.md). Ce point ne lève aucun autre gate production.
- `PRODUCTION BLOCKED — LEGAL REVIEW REQUIRED` : les modèles droits/contrats restent soumis à revue juridique. Les notifications ne contournent pas ce gate.
- `PRODUCTION BLOCKED — NOTIFICATION ACTIVATION HUMAN REQUIRED` : l'architecture, les gardes, le preflight et le runbook V0.7.8 sont validés. La QA staging réelle du 23 août 2026 couvre delivered, bounce, complaint, suppression préalable et isolation d'environnement. Aucune configuration production, aucun webhook Dashboard ni destinataire réel ne sont toutefois activés automatiquement.
- `WORKER SCHEDULER TECHNICALLY READY` : V0.7.9 fournit le tick borné, le preflight, les preuves de concurrence PostgreSQL et le runbook. La QA staging humaine du 23 août 2026 a validé un Cron à `claimed=1`, le tick anti-doublon à `claimed=0`, le webhook `DELIVERED` avec une tentative et le Safe Reset désactivé. Le Scheduled Job Railway production n'est pas créé ; sa configuration et sa QA restent des gates humains. Ce statut ne signifie pas que le site est prêt pour la production.
- `PRODUCTION BLOCKED — SCHEDULER RAILWAY HUMAN CONFIGURATION REQUIRED` : la commande et la configuration dédiée sont prêtes dans le dépôt, mais aucun Scheduled Job production n'a été créé. L'opérateur doit encore vérifier la commande effective, la cadence, les variables, les logs, le smoke test et le rollback dans Railway.
- e-mail production : l'ouverture exige simultanément l'environnement `production`, la confirmation explicite V0.7.8, Resend pour l'Auth et l'outbox, les audiences choisies, le worker explicitement activé, un domaine From/Reply-To contrôlé sous `lnxbeats.fr`, les secrets dans le coffre et un preflight `PASS`. Toute combinaison incomplète échoue fermée.
- staging : les destinataires client restent limités aux adresses de test officielles Resend et à `NOTIFICATION_STAGING_RECIPIENT_ALLOWLIST`; la destination propriétaire reste la variable serveur exacte et son flag dédié. Ces gardes ne confèrent aucune autorisation production.
- Stripe Live, SMS réel, Railway, OVH/DNS et déploiement restent inchangés.
- `PRODUCTION BLOCKED — LIVE REFUNDS NOT ARMED` : le code B3 peut être dark-déployé avec `LIVE_REFUNDS_ENABLED=false`. L’armement futur exige le flag, la confirmation Production dédiée, le runtime strict et un provider Live compatible. Toute tentative ambiguë sans identifiant provider reste en revue sans réémission financière.
- `PRODUCTION PAYMENTS TECHNICALLY READY — LIVE CONFIGURATION HUMAN REQUIRED` : V0.8.0 apporte l’isolation persistante Test/Live, les gardes production, le preflight read-only, les hôtes PayPal fermés et l’avertissement Admin Live. Aucun credential, webhook Dashboard, variable Railway ou paiement Live n’est configuré. L’état initial obligatoire reste `PAYMENTS_ENABLED=false` avec les deux flags provider à `false`.
- `PRODUCTION PAYMENTS DIAGNOSTIC READ-ONLY` : V0.8.0.1 ajoute `payments:diagnostic`, une inspection locale/serveur sans SDK provider ni mutation. `SAFE_DISABLED` ou `CONFIGURED_DISABLED` ne lèvent aucun gate ; seul le preflight, puis la validation humaine, peuvent autoriser l’étape suivante. `INVALID` impose l’arrêt et la correction de la configuration ou des anomalies PostgreSQL.
- `PRODUCTION BLOCKED — ACCOUNTING / INVOICING DECISION REQUIRED` : l’encaissement Live doit être aligné avec facturation, TVA/comptabilité, politique de remboursement et conservation des preuves avant ouverture publique.

Avant une future ouverture : maintenir le contrôle de l’override Prisma ; revue juridique ; domaine Resend vérifié ; test delivered/bounce/complaint/suppressed ; retry concurrent ; monitoring des `REQUIRES_REVIEW` ; validation propriétaire mobile ; rotation/procédure secrets ; backup ; rollback vers `disabled` documenté ; configuration et smoke Live humains séparés. Voir [PRODUCTION_NOTIFICATIONS.md](PRODUCTION_NOTIFICATIONS.md), [NOTIFICATION_RUNBOOK.md](NOTIFICATION_RUNBOOK.md), [PRODUCTION_PAYMENTS.md](PRODUCTION_PAYMENTS.md) et [PAYMENT_PRODUCTION_RUNBOOK.md](PAYMENT_PRODUCTION_RUNBOOK.md).

## V1.1.0 — gates Boutique et tarifs

- `SHOP_ENABLED=false` reste la valeur Production sûre. Panier, `ShopOrder`,
  paiements, facturation, SAV et logistique existent désormais comme fondations
  locales fail-closed ; leur présence ne constitue aucune activation.
- `MUSIC_PRICING_SOURCE=legacy` maintient la grille V1 validée pendant la revue
  de l'Admin Tarifs. Le cutover vers PostgreSQL exige un sprint financier dédié
  prouvant la compatibilité Stripe et PayPal avec toute nouvelle version.
- Aucun produit n'est créé ou publié automatiquement par la migration.
- Avant la migration du candidat V1.1.0 : backup PostgreSQL/PITR vérifié, inventaire des
  compteurs V1 et procédure de restauration humaine obligatoires. Le rollback
  applicatif conserve les tables additives ; aucune down migration destructive.
- La Phase 5E porte le total à 28 migrations, cible les particuliers en France,
  prépare une grille Colissimo 2026 `DRAFT`, un packaging offert, les réservations
  30 minutes, le SAV privé et un runner one-shot local. Activation tarifaire,
  Railway Cron, provider transport réel, R2 Production, textes juridiques actifs
  et ouverture publique restent des décisions humaines distinctes.
- Le rollback est applicatif : flags fermés et tables additives conservées ;
  aucune down migration destructive.

Voir [SHOP_PRODUCTION_READINESS_PHASE5E.md](SHOP_PRODUCTION_READINESS_PHASE5E.md).

## V1.1.0 — Release B

Release B sépare désormais trois gates : **B1 infrastructure avec tous les flags commerciaux OFF**, **B2 ouverture commerciale après validations humaines**, puis **B3 paiements Boutique Live**. Le code ne vaut ni approbation juridique, ni activation tarifaire, ni création de produit, ni configuration Railway.

Le paiement Boutique OFF est un vrai verrou transactionnel : le catalogue et le panier peuvent rester consultables, mais aucune `ShopOrder`, réservation, acceptation contractuelle ou tentative provider n'est créée. Le SAV Production est prévu sur R2 privé, la maintenance sur un Cron séparé `npm run shop:maintenance:run`, et le suivi de lancement reste manuel sans API La Poste. Voir [SHOP_OPEN_READINESS_V1.1.0.md](SHOP_OPEN_READINESS_V1.1.0.md).
