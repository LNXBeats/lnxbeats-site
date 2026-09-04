# Boutique V1.1.0 — Release B / Shop Open Readiness

## Statut et stratégie

Le socle `172e35eda406dd3249eebacf71a809d0e14f78b5` a déjà été dark-deployed. Release B n'est ni déployée ni activée. La séquence retenue reste : **code d'abord, fonctionnalités OFF, smoke, puis activations humaines séparées**.

- **B1 — infrastructure** : guards Production, France métropolitaine, tarif versionné, SAV R2 privé, maintenance one-shot, suivi manuel, textes candidats et cockpit Admin. Tous les flags commerciaux restent OFF au déploiement.
- **B2 — ouverture commerciale** : approbation juridique, grille et emballage actifs, premier produit réel validé puis publié, stock, R2 et scheduler prouvés, smoke Shop. Le mode catalogue-only est sûr : aucune `ShopOrder`, réservation, acceptation contractuelle ou tentative de paiement n'est créée lorsque `SHOP_PAYMENTS_ENABLED=false`.
- **B3 — paiements Boutique Live** : gateways de remboursement Live, preflights Stripe/PayPal Shop, webhooks, factures/avoirs, notifications et première transaction réelle contrôlée.

L'ouverture catalogue-only est techniquement sûre, mais reste une décision humaine. Si elle apporte peu de valeur, garder `SHOP_ENABLED=false` jusqu'à B3 réduit encore le périmètre opérationnel.

## Sémantique des flags

| Flag | Active | N'active pas / comportement OFF |
|---|---|---|
| `SHOP_ENABLED` | catalogue public Boutique | n'empêche pas l'Admin ni le traitement historique des commandes existantes |
| `SHOP_PAYMENTS_ENABLED` | initiation de paiements Boutique si le stack global/provider est aussi armé | OFF bloque côté UI et serveur toute création de `ShopOrder`, réservation et tentative provider ; le devis reste consultatif |
| `SHOP_SHIPPING_ENABLED` | devis public à partir d'une grille commerciale `ACTIVE` | OFF n'empêche pas la consultation Admin |
| `SHOP_LEGAL_READY` | version immuable explicitement `APPROVED` | une candidate ne peut jamais ouvrir la Boutique transactionnelle |
| `SHOP_AFTER_SALES_ENABLED` | parcours SAV existants | n'active aucun remboursement provider ; le mode `payments` exige la politique Refund Live entièrement armée |
| `SHOP_SHIPPING_OPERATIONS_ENABLED` | préparation, suivi manuel et expédition Admin | n'active aucune API transporteur |
| `SHOP_SHIPPING_PROVIDER_ENABLED` | futur adapter transporteur | reste `false` au lancement manuel |
| `LIVE_REFUNDS_ENABLED` | première demande d’armement Refund Live | reste `false` au dark deploy et ne suffit jamais sans confirmation dédiée |
| `MEMORY_DIAGNOSTICS_ENABLED` | diagnostics mémoire explicitement autorisés | reste `false`; la limite Railway de 2 GB est temporaire et doit continuer d'être observée |

Tous les chemins Production exigent l'identité Railway `production`, la cible DB allowlistée, l'origine canonique `https://www.lnxbeats.fr` et `SHOP_PRODUCTION_CONFIRM`. La préparation Admin de la grille, Shop et shipping publics OFF, exige en plus `SHOP_SHIPPING_ADMIN_PREPARATION_ENABLED` et sa confirmation exacte. Aucun flag UI ne remplace les contrôles serveur.

## Livraison France

- Destination : particuliers, France métropolitaine uniquement, Corse incluse.
- Contrôle géographique : code pays `FR` et code postal numérique à cinq chiffres ; `00xxx`, `97xxx`, `98xxx`, pays forgé et format ambigu sont refusés. Il ne s'agit pas d'une validation postale exhaustive.
- Mode de lancement : Colissimo domicile, suivi saisi manuellement, lien La Poste HTTPS facultatif. Aucune API La Poste n'est nécessaire.
- Source tarifaire : grille Admin commerciale versionnée, `ACTIVE` uniquement en Production. Une `DRAFT` n'est utilisable que dans la QA Phase 5E strictement gardée.
- Poids facturable : produits seuls, minimum 250 g. L'emballage de 60 g reste dans le poids physique mais n'est pas facturé. Capacité : 16 articles. Maximum grille : 30 kg. Multi-carton différé après lancement.
- Le serveur relit produits, quantités, stock, poids et grille au moment transactionnel puis fige le snapshot de commande.

## SAV et stockage privé

Les preuves SAV sont facultatives à la création, limitées à cinq fichiers au total, 5 MiB chacun, JPEG/PNG/WebP validés par MIME, extension et signature. Les clés `shop-returns/<request UUID>/<object UUID>.<ext>` sont générées côté serveur. Le client n'en choisit aucune.

En Production, le domaine utilise l'abstraction média existante et le bucket R2 privé. La route de lecture réapplique session, rôle, ownership, statut actif, `private, no-store`, `nosniff` et `noindex`. Un dossier clôturé refuse les nouveaux uploads. L'upload concurrent et la purge partagent un advisory lock; la limite de cinq est recomptée sous transaction. Si la DB échoue après un PUT, un DELETE compensatoire est tenté et son éventuel échec est journalisé sans secret.

La purge intervient 90 jours après clôture, par lot borné de 100. Le média est supprimé avant que la ligne soit marquée `PURGED`; un échec R2 laisse la ligne active et retentable. Les métadonnées d'audit subsistent. Les fixtures locales ne nécessitent aucune migration média Production.

## Maintenance Shop séparée

Décision : `SEPARATE_CRON`, nom recommandé `lnxbeats-shop-maintenance`, afin qu'une panne DB/R2 Shop n'arrête jamais `lnxbeats-notifications`.

- commande one-shot : `npm run shop:maintenance:run`
- cadence recommandée : `*/5 * * * *`
- restart policy : `NEVER`
- aucun domaine, healthcheck ni pre-deploy propre au Cron
- lot réservations : 100; lot purge : 100; advisory lock PostgreSQL; aucune boucle infinie
- variables non sensibles : `NODE_ENV`, `RAILWAY_ENVIRONMENT_NAME`, `LNX_DATABASE_TARGET`, `AUTH_URL`, `SITE_URL`, `SHOP_PRODUCTION_CONFIRM`, `SHOP_MAINTENANCE_ENABLED`, `SHOP_MAINTENANCE_CONFIRM`, `SHOP_AFTER_SALES_ENABLED`, `LIVE_REFUNDS_ENABLED`, `MEDIA_DEPLOYMENT_ENV`, `MEDIA_STORAGE_DRIVER`, `MEDIA_STORAGE_PROVIDER`, `MEDIA_S3_REGION`, `MEDIA_PUBLIC_BUCKET`, `MEDIA_PRIVATE_BUCKET`, `MEDIA_S3_FORCE_PATH_STYLE`
- secrets au moindre privilège : `DATABASE_URL`, `MEDIA_S3_ENDPOINT`, `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY`
- inutiles : Stripe, PayPal et Resend. La maintenance écrit l'outbox/les alertes DB; le Cron notifications reste responsable de ses propres envois.

Ne jamais créer le service Cron avant que B1 Web soit healthy. `/api/health` Web ne dépend pas du dernier tick Shop.

## Juridique et confidentialité

Les versions finales `shop-cgv-2026-05-candidate` et `privacy-2026-04-candidate` sont immuables et `AWAITING_LEGAL_REVIEW`. Elles ne sont pas `APPROVED`. Aucune migration ne seed une approbation. Toute modification après approbation devra créer une nouvelle version.

Checklist humaine :

- [ ] identité et coordonnées professionnelles;
- [ ] CM2C et vérification/renouvellement avant le 27 août 2029;
- [ ] France métropolitaine et Corse;
- [ ] préparation 2–3 jours et délai transport indicatif;
- [ ] minimum facturable 250 g, emballage 60 g / 16 articles;
- [ ] rétractation/retour des CD;
- [ ] photos SAV privées et purge à 90 jours;
- [ ] Railway, PostgreSQL et Cloudflare R2;
- [ ] version candidate approuvée humainement.

## Checklists d'activation

Premier produit : titre, slug, description, prix, poids (25 g uniquement si vérifié pour ce CD), stock réel, cover avec droits et alt, création `DRAFT`, preview Admin, publication manuelle après validation.

Shipping : candidate vérifiée, minimum 250 g, emballage 60 g/16, activation atomique de la grille et du packaging, quote smoke, Shop encore OFF pendant la préparation.

SAV : R2 privé configuré, contrôle d'ownership, purge runner, Cron Production, texte Privacy, puis flag séparé.

Shop Open : B1 healthy et mémoire stable, juridique approuvé, CM2C complet, une seule grille et un seul packaging actifs, Cron prouvé, R2 prêt, suivi manuel prêt, produit réel publié, stock correct, smoke public, stratégie paiements décidée.

Payments On : remboursement Live, Stripe/PayPal Shop preflight, stratégie provider, réconciliation webhook, facture/avoir, première transaction réelle, remboursement opérable.

## Rollback

Le rollback est applicatif et non destructif : remettre les flags commerciaux à `false`, arrêter le Cron Shop si nécessaire, conserver migrations et snapshots, ne pas supprimer les tables ni les objets. Une grille active est archivée par une activation contrôlée; ne jamais modifier une version historique utilisée. Aucune down migration, aucun `migrate reset`.

Dette externe distincte : `https://lnxbeats.fr` apex reste un sujet DNS/SEO hors de ce chantier.
