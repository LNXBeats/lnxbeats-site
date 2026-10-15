# DCN — Préparation finale des validations France

15 octobre 2026. Lot local issu de `d0e995e612e353230a318ad4214daa9cb3697795`, sur `feature/dcn-1-0`. Le SHA et le tree livrés sont consignés dans `REVISION.json` de l’archive, après commit local. Aucune ouverture commerciale ou approbation juridique n’est effectuée.

## Résultat livré

- Un dossier professionnel ciblé, son PDF de six pages, les textes DCN DRAFT exacts, les trois consentements et la chaîne de preuves de confirmation/rétractation. Un exemple PDF QA antérieur est joint sans modification. Les correspondances fiscales, contrats confidentiels et preuves de droits réelles ne sont pas collectés dans l’archive.
- Un guide Admin détaillé pour le premier album : création, titres, cover, import WAV groupé, association explicite, extraits, versions, droits, prix indépendants, prévisualisation privée et publication conditionnelle. Aucun code ou SQL n’est nécessaire pour saisir cet album lorsque l’environnement et son worker sont configurés.
- Une checklist séparant les validations indispensables des améliorations facultatives. Les décisions de licence privée, versions exactes, France métropolitaine et Corse, complétion d’album et médiation existante sont conservées.
- Des libellés Admin plus lisibles : édition complète adaptée à Album/Single/Projet, offre à l’unité distincte, versions WAV/MP3 privées, durées exactes et états audio en français. Le contrôle audio ne vaut pas approbation des droits. Les prix demeurent vides tant qu’ils ne sont pas décidés.

## Correctif mobile démontré

La revue à 390 px a révélé un débordement du formulaire des droits : sa région de 356 px avait un contenu de 567 px et son fieldset dépassait le bord de l’écran. La taille minimale intrinsèque du fieldset et de la grille empêchait la réduction du formulaire. La correction permet la réduction et le retour à la ligne dans ce seul formulaire, sans cacher de champ, de preuve ou d’attestation. Après build, sa largeur de contenu est de 356 px pour 356 px disponibles en mobile, et de 1 143 px pour 1 143 px en desktop : aucun champ ne dépasse. La preuve finale et les captures sont consignées dans `preuves/browser-review.json`.

## Validations encore nécessaires

Le dossier ne traite pas le nouveau téléchargement direct comme des recettes SACEM ou DistroKid par simple analogie. Il réutilise les faits EI/BNC/franchise déjà documentés et pose les seules questions nouvelles au conseil juridique, au SIE/conseil fiscal et au professionnel social compétent. CM2C est déjà souscrit : vérifier au besoin le périmètre de la convention, sans nouvelle adhésion automatique.

Restent à faire approuver les conditions DCN et la garantie applicable, les consentements et la remise durable effective, la rétractation, les données de résidence et le périmètre territorial, puis la qualification fiscale/sociale et les documents comptables du nouveau flux. Les textes gelés restent DRAFT ; toute future correction doit créer une version distincte sans altérer les contrats historiques. Aucun message n’a été envoyé à ces destinataires.

Pour le premier catalogue réel, LNX choisira les masters/covers, l’édition, les prix et les disponibilités, et examinera les vraies autorisations par œuvre/master/version. Les preuves et leur SHA-256 se préparent hors Admin ; les WAV ne créent pas automatiquement les titres. L’exploitation doit disposer du worker. Les deux ZIP sont liés aux acquisitions et non générés dans la prévisualisation prévente ; leurs bornes restent à respecter.

## Contrôles et portée des preuves

Les résultats finaux, commandes et logs expurgés sont inclus dans `preuves/` : **17 tests PASS, 0 FAIL, 0 SKIP**, lint PASS (quatre avertissements préexistants, aucune erreur), typecheck PASS, build Web PASS et diff-check PASS. Les tests couvrent les libellés, leurs invariants, l’intégration Admin, les équivalences et les règles CSS ciblées. Après découverte du débordement réel, ces seuls gates de présentation ont été rejoués sur le correctif final. La revue navigateur locale porte sur desktop 1440 et mobile 390, sans import, enregistrement d’offre ou de droits. Ce n’est pas une nouvelle recette Safari physique ou de paiement.

Le PDF a été rendu puis ses six pages inspectées. Les exports contrôlent les empreintes des textes gelés et leur statut non approuvé. L’archive possède un index HTML hors ligne et un manifeste SHA-256 ; sa décompression et les empreintes des entrées sont vérifiées. Le scan de secrets s’effectue aussi contre les valeurs du profil QA en mémoire, sans les imprimer ni les intégrer au dossier.

Les recettes Stripe, PayPal, R2 et Safari Mac sont réutilisées dans leur périmètre acquis, sans nouvel appel ou scénario. Safari iPhone reste NOT_RUN, facultatif différé. Prisma et le build worker ne sont pas rejoués pour ce changement de présentation : schéma, migrations, worker, paiements, bibliothèque, contrats sources et dépendances sont inchangés.

## État et protections

Aucun nouvel album réel importé ; aucune donnée d’acquisition, facture, preuve juridique, prix ou approbation de droits modifiée. Aucun e-mail réel, appel financier, nouvelle recette prestataire, changement de dépendance ou migration. Aucun push, fusion, déploiement, changement Production/Railway/OVHcloud. Le dossier OVH Free 100M reste **BLOCKED** sans opération.

La prévisualisation privée est conservée. Les contrats des autres activités, Boutique physique, DistroKid, Commander, Créations, Rights, soutien, authentification, facturation et médias historiques restent hors diff. Le candidat est destiné à la validation professionnelle et à la préparation locale du premier album ; **pas prêt Production**.
