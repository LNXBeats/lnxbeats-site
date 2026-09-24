# Admin V2 — candidat local, sans déploiement

Base vérifiée le 24 septembre 2026 : `origin/main` `f07a936d79749c560e9744db630318db94882eb1`. Travail isolé sur `feature/admin-v2-cleanup-seo-slugs`, sans déplacement du checkout principal. Le visuel fourni dans le pack donne la direction noir/blanc/or ; ses chiffres et dossiers fictifs ne sont pas injectés.

## Inventaire et décisions

L'Admin existant comporte quatorze destinations de premier niveau : accueil, commandes musicales, nettoyage, produits, commandes Boutique, logistique, SAV, tarifs, facturation, notifications, droits/contrats, catalogue, créations et membres. Les Server Actions restent derrière `requireAdmin`, la session et les gardes métier préexistants. Les modèles Catalogue, Créations, commandes musicales et Boutique ne sont pas fusionnés. Aucune route métier n'est supprimée.

La navigation V2 expose six espaces : Accueil ; Créations (Créations/collaborations, Catalogue/discographie, commandes musicales) ; Boutique (produits, commandes, SAV, logistique) ; Clients & documents (membres, factures et avoirs) ; Réglages (tarifs) ; Avancé (nettoyage, notifications techniques, droits et contrats). Les sous-rubriques restent accessibles par `details`, avec états actifs et badges. Le cockpit place « À traiter maintenant » visuellement avant les compteurs ; les zéros sont atténués. Le hub de Créations relie les deux espaces éditoriaux sans modifier les schémas métier. Les archives, factures et droits restent dans leurs surfaces existantes.

## Nettoyage : plan seulement

Le classement existant est réévalué en transaction série et audité à l'exécution. V2 refuse désormais les lots mêlant des types ou des classifications, ainsi que tout élément `KEEP_ACTION_REQUIRED`. L'UI explique les catégories et empêche leur sélection. La double soumission d'un archivage est idempotente ; la suppression physique reste réservée à une commande musicale `DELETE_SAFE` revérifiée. Boutique et Rights sont archivable/conservables seulement. Un titre contenant « QA » ne suffit jamais pour conclure qu'un enregistrement est jetable.

Plan Production futur : lancer d'abord l'inventaire prévu en transaction explicitement `READ ONLY`, sous identité Production vérifiée, sans donnée client dans le rapport ; examiner les dossiers ambigus un par un ; obtenir une autorisation séparée pour toute action. Aucun inventaire DB Production ni nettoyage Production n'a été exécuté pendant ce lot. Ne jamais supprimer une facture, un avoir, un paiement confirmé, une commande Boutique avec historique de stock/finance, un remboursement, un contrat utilisé ou une trace d'audit.

## Slugs et migration

`lib/seo/slugs.ts` centralise translittération française/Unicode, longueur, tirets, collisions suffixées sous verrou PostgreSQL et historique sans chaîne. Le slug est facultatif à la création des projets, créations et produits. Un brouillon renommé suit son titre ; un publié conserve son adresse. L'ancien slug est réservé dans `formerSlugs`, jamais repris par un autre enregistrement du même domaine. La migration additive `20260924120000_admin_v2_former_public_slugs` ajoute seulement trois tableaux vides aux tables `projects`, `creations`, `products`, sans réécrire les lignes ou URLs existantes.

Les pages `/album/[slug]`, `/creations/[slug]` et `/boutique/[slug]` ne redirigent un ancien slug que si sa cible est publique ; elles utilisent une 308 directe vers le slug courant. Une création ou un produit brouillon reste inaccessible ; une fiche Produit redirige seulement si la cible satisfait encore la requête publique. Les 404 ne doivent plus hériter du canonical d'accueil et sont `noindex`. Les slugs `nouveau` et `commandes` restent réservés là où applicables.

## SEO public

Audit du code actuel : origine canonique unique `https://www.lnxbeats.fr` ; robots autorise le public, référence le sitemap et exclut Admin/API/compte/auth/QA ; `/commander` n'est pas bloqué. Le sitemap dynamique prend les projets publics, produits publiés et créations publiées des requêtes métier, sans anciens slugs ni dates de build artificielles. Les pages publiques ont metadata et JSON-LD spécifiques déjà présents (WebSite/Person, musique, Création/VideoObject lorsque pertinent, Product/Offer). Les pages juridiques appropriées restent liées depuis le footer. Aucun `hreflang` n'est ajouté : aucune version linguistique alternative n'est servie. Aucune pagination SEO artificielle n'est introduite.

Sondage HTTP public en lecture seule du 24 septembre : accueil, Discographie, Créations, Commander, Boutique, À propos, Contact, mentions légales, robots et sitemap répondent 200 ; URL inexistante répond 404 ; health répond 200. Le sitemap XML réel contient 29 URLs : 7 pages principales, 18 projets, 2 créations, 2 produits. Ces observations ne prouvent pas l'indexation Google ni les Core Web Vitals. Search Console n'a pas été consultée ni modifiée. Les signed URLs R2, brouillons, comptes et routes privées ne sont pas ajoutés au sitemap.

## Gates et réserves de publication

La migration a été appliquée avec succès sur une base PostgreSQL **locale jetable** après les 37 migrations antérieures (38 au total). Les trois colonnes ont été vérifiées. Le test runtime vérifie génération, renommage brouillon, stabilité publiée, ancien slug public et absence de fuite brouillon. Aucune migration Production n'a été exécutée. Sur le candidat local : `npm ci`, Prisma format/validate/generate, lint, typecheck, build, suite canonique (1 239 réussites, 1 test runtime DB volontairement ignoré hors de sa base dédiée), test runtime local (1 réussite), audit npm (0 vulnérabilité) et diff-check ont été exécutés. Ces contrôles devront être rejoués au niveau approprié sur le SHA exact avant toute promotion.

La QA visuelle réelle de l'Admin à 375/390/430/768/1024/1440/1920 px, les captures avant/après et les interactions tactiles restent **à faire** : aucun navigateur automatisé isolé n'était disponible et l'accès à Safari, contenant des onglets privés hors périmètre, a été refusé. Les règles CSS fixent des cibles de navigation à 44–48 px, mais le code seul ne prouve ni absence de débordement ni qualité visuelle. Ce point bloque une déclaration « prêt Production ».

Avant déploiement : revue humaine du diff et de la navigation ; QA visuelle sur navigateur isolé ; sauvegarde et test d'upgrade DB locale fidèle à Production ; audit des collisions de slugs existants et des données ; approbation séparée de la migration additive et du push main ; puis contrôle HTTP, sitemap, 308 et régression Admin après déploiement. Ne pas déduire de ce rapport une autorisation de nettoyer la DB ou de pousser `main`.
