# DCN — préparer le lancement en France métropolitaine et en Corse

Décision de LNX Beats du 15 octobre 2026 : **vente directe aux particuliers résidant en France métropolitaine, Corse comprise**. L’outre-mer, l’étranger et le B2B restent fermés. Stripe et PayPal sont conservés ; **aucune préparation Merchant of Record n’est nécessaire pour ce lancement**. L’étude mondiale précédente reste une archive, pas une liste de démarches à accomplir.

Le lot part de `ee5ace65dff096545cbf1622291e55280cc4d8ae`, branche `feature/dcn-1-0`. Tout reste local et TEST-only. Cette checklist ne vaut ni validation fiscale/juridique ni autorisation de mise en Production.

## Ce qui est acquis

- Panier numérique séparé, compte actif et e-mail vérifié ; WAV + MP3, deux ZIP distincts, titres, albums indépendants et inédits.
- Conservation des versions achetées et bibliothèque privée ; aucune nouvelle édition ou remaster offert automatiquement.
- Complément d’album sur montants réellement payés et non remboursés, avec calcul serveur en centimes et crédit non réutilisable.
- **Décision de licence :** écoute, téléchargement et conservation pour usage privé ; aucune autorisation de diffusion publique, redistribution, publication ou exploitation commerciale. Les autorisations spécifiques restent séparées.
- **Collaborations :** œuvre/master vendable uniquement après vérification des droits et autorisations nécessaires, preuves administratives privées et historique d’approbation.
- **Remboursement commercial :** simple changement d’avis examiné individuellement ; pas d’automatisme après fourniture immédiate légalement encadrée. Rétractation, conformité et tous droits légaux demeurent préservés.
- EI, SIRET, BNC/micro-BNC, franchise historique et CM2C déjà documentés. Aucune nouvelle adhésion, constitution ou refonte des contrats des autres activités.

Ces décisions sont `USER_CONFIRMED`, **pas** `LEGAL_APPROVED`. Les prix sont fixés librement par LNX, et non laissés au libre montant de l’acheteur ; aucun tarif réel nouveau n’a été choisi dans le code.

## Corrections locales livrées

### Résidence et territoire

Le checkout ne propose que France métropolitaine/Corse, avec codes postaux de résidence et de facturation et confirmation explicite de l’usage particulier. Côté serveur, le code pays FR seul ne suffit plus pour un nouveau parcours non simulé. Les préfixes 97/98/99, Monaco, étranger et codes ambigus sont refusés ; les codes corses 20 sont inclus. Le filtre de syntaxe ne prétend pas être une base d’adresses ni une preuve de résidence.

Une résidence doit aussi avoir une **revue indépendante chargée par le serveur**, liée à l’utilisateur authentifié : dernier événement du journal, acteur Admin relu actif et vérifié, référence privée et empreinte, code postal ordinaire concordant, dates/échéance/intégrité. Le navigateur ne peut transmettre ni approbation, ni preuve ou acteur. Une déclaration, deux champs déclarés, une IP, la nationalité ou le pays d’émission d’une carte ne créent aucune preuve.

Le raccordement est en lecture seule dans le journal existant ; il n’émet aucun événement de résidence et ne crée pas de collecte KYC. **La source proportionnée, sa conservation et son workflow d’examen restent à arrêter/raccorder avant ouverture.** À défaut, le paiement demeure refusé ; il n’est pas présenté comme opérationnel.

Le marché `FR-MET` est un code applicatif interne, pas une subdivision ISO officielle. Son exemple de règle reste `DRAFT / REVIEW / NONE`, sans taux ni approbation, non inséré. Aucun repli sur la règle FR générale ni changement des 249 territoires existants. La preuve minimale est figée dans les nouvelles commandes concernées et revérifiée avant capture/confirmation/première délivrance ; les anciens contrats et re-téléchargements acquis ne reçoivent pas rétroactivement cette exigence.

### Droits des œuvres et collaborations

L’Admin dispose d’une revue par version de master et d’états `DRAFT`, `REVIEW_REQUIRED`, `APPROVED`, `REJECTED`, `REVOKED`. L’approbation nécessite une référence d’archive privée, l’empreinte du justificatif/manifeste et une attestation explicite après examen des droits composition/master/interprètes/collaborateurs/samples/reprises/extraits. Le logiciel trace cet examen humain ; il ne lit pas automatiquement les contrats et ne certifie pas les ayants droit.

L’audit append-only lie le master exact, les identités et empreintes WAV/MP3/extrait, le réviseur et les dates. Une nouvelle version, un refus ou une révocation ne reprend jamais silencieusement une ancienne approbation. Sans preuve approuvée, sélection commerciale et activation d’offre sont bloquées avant écriture. Les nouvelles commandes portent un marqueur de politique et sont revérifiées avant capture, confirmation et première fourniture. Les achats, documents et téléchargements historiques ne sont pas réécrits par cette préparation.

### Documents et remboursements

Le nouveau brouillon `digital-music-france-cgv-20261015-draft-01` est consultable dans les conditions numériques et le registre Admin. Il réutilise l’identité et CM2C existants, porte les décisions confirmées et préserve les droits légaux. Aucun ancien document approuvé ni son hash ne change. L’ancien texte QA reste conservé pour les démonstrations et snapshots ; le nouveau texte France doit être approuvé puis raccordé aux **seules nouvelles commandes**, pas simplement renommé dans un ancien achat.

Le service financier existant ne nécessite pas de nouvel automatisme : une demande Admin réserve un remboursement, une action distincte l’exécute, la réconciliation ne transforme pas les demandes `REQUESTED` en remboursements spontanés. Les faits financiers authentiques restent rapprochés ; facture originale, avoir unique, historique et droits sont conservés selon la réduction de prix ou la résolution. Ce contrôle technique ne décide pas de l’éligibilité légale d’une demande.

## Checklist restante avant vente réelle

| Lot nécessaire | Action précise | État actuel |
|---|---|---|
| Fiscalité française du nouveau produit | Réponse ciblée SIE/comptable : autoédition BNC ou ventilation, branche effective de franchise et cumul avec activités existantes, mention/taux éventuel Corse comprise, traitement du complément/remboursement. Quatre questions déjà préparées, aucun dossier mondial requis | À valider ; aucun taux ni exemption paramétré |
| Nouveau contrat DCN France | Relecture du brouillon, licence privée, modalités de fourniture/confirmation durable, fin de service et restriction territoriale commerciale ; CM2C existant, vérifier la portée seulement si nécessaire | DRAFT ; pas de nouvelle adhésion |
| Conformité des CGV | Intégrer et faire relire l’encadré réglementaire applicable D. 211-3, ainsi que les modalités de garantie et consentement | Résumé préparé ; encadré final non intégré |
| Rétractation numérique en ligne | Raccorder explicitement DCN à une fonctionnalité de notification en ligne, avec accusé durable, horodatage et sans remboursement automatique. Le formulaire historique ne traite actuellement que commandes personnalisées/physiques | Développement ciblé restant ; ne pas présenter `/retractation` comme DCN déjà fonctionnel |
| Résidence | Valider la méthode de preuve proportionnée et la conservation puis raccorder son examen/émission serveur avant engagement financier ; tester révocation, expiration, incohérence et cas Corse/DOM | Contrôleur et adaptateur de lecture prêts ; aucune preuve réelle collectée/émise |
| Vrais albums | Importer masters/covers et métadonnées, choisir extraits, vérifier WAV/MP3 et deux ZIP. Enregistrer les preuves et approbations de droits dans l’Admin | Aucun album réel importé ni dossier de droits réel approuvé par ce lot |
| Prix et cas limites | Renseigner les tarifs librement décidés par LNX ; statuer seulement sur les cas encore en revue : complément gratuit, allocations incertaines, équivalences entre éditions et réemploi après remboursement | Aucun prix fictif transformé en tarif réel ; blocages sûrs conservés |
| Version contractuelle et règle FR-MET | Après validations, lier nouvelle version France, paramètres fiscaux et preuve d’approbation au seul marché FR-MET ; conserver les versions précédentes et tous autres marchés fermés | Exemple DRAFT seulement ; aucune insertion `ALLOW` |
| Passage TEST → LIVE DCN | Adapter les garde-fous dédiés avec identité marchande, séparations TEST/LIVE, signatures, idempotence et arrêt indépendant ; ne pas activer les flags des autres paiements | TEST-only conservé ; pas un simple changement de flag |
| Recette/release autorisées séparément | Uniquement les tests affectés, nouveaux cas France/droits/contrat sur les environnements autorisés ; audit migrations réelles, backup/restore si applicable, revue Git et autorisation distincte de promotion | NOT_RUN pour toute nouvelle recette externe et toute promotion |

La restriction hors métropole est une **décision commerciale acquise**, mais sa mise en œuvre doit respecter les règles françaises/européennes applicables au contenu protégé. Aucun blocage du catalogue, de la nationalité ou des cartes étrangères n’a été ajouté. La franchise historique de TVA et une réponse fiscale favorable sur le soutien ne valent pas une approbation fiscale du téléchargement.

## Documents de travail

- `docs/DCN_FRANCE_FISCAL_REVIEW_20261015.md` : sources officielles publiques datées et quatre questions nouvelles, pas une requalification globale de l’EI.
- `docs/DCN_FRANCE_CGV_REVIEW.md` et `lib/digital/france-legal.ts` : nouveau brouillon et points réglementaires restants.
- `docs/DCN_FRANCE_TERRITORY_PLAN.md` : territoire, provenance des preuves et constante DRAFT.
- `docs/DCN_RIGHTS_REVIEW_20261015.md` : fonctionnement Admin, protections et limites de preuve.
- `docs/DCN_COMMERCIAL_DECISIONS_20261015.md` : décisions confirmées et absence d’automatisme financier.
- `docs/DCN_REAL_ALBUM_IMPORT.md` : procédure réutilisée ; ajouter maintenant la revue des droits après import et avant activation de l’offre.

## Preuves et protections du lot

Les commandes, résultats et environnements finaux sont consignés dans `output/dcn-france-launch/final-checks.json` et `targeted-tests.json`. Les tests de services, routes, sessions et prestataires utilisent des doubles en mémoire ; les politiques/migrations existantes peuvent être testées avec PGlite jetable. **Ce ne sont pas de nouvelles recettes Stripe/PayPal/R2 ni des preuves juridiques.** Les campagnes précédentes, Safari Mac et les preuves audio restent conservés et ne sont pas rejoués pour gonfler les chiffres.

Résultats : **123 tests ciblés PASS, 0 FAIL, 0 SKIP sur 17 fichiers**. Le dernier ajustement de verrou partagé droits/import est validé séparément par les seuls 17 contrôles droits/import concernés ; ce sous-ensemble n'est pas additionné au total. Lint, typecheck, build Web, build worker numérique et diff-check passent ; quatre avertissements lint préexistants restent dans les anciens outils QA hors périmètre, aucun nouvel avertissement. Les preuves du dernier état gelé sont préfixées `final-`.

Installation, audit dépendances, génération Prisma, sauvegarde/restauration et recette runtime PostgreSQL/ACL du lot précédent ne sont pas relancés : aucun changement de dépendance, schéma, migration ou privilège ne le nécessite. Les résultats antérieurs sont conservés, pas présentés comme fraîchement réexécutés. L'interface Admin authentifiée et une nouvelle recette de paiement de bout en bout sont **NOT_RUN** sur ce lot ; les tests des nouveaux services utilisent des dépôts/session/prestataire doublés.

Pour reprendre la version locale construite : `npm run dcn:local:built -- consolidation` depuis ce worktree, puis `http://127.0.0.1:3140`. Le lanceur utilise uniquement le profil privé QA existant, le rôle runtime local non propriétaire et PostgreSQL en loopback sur 55473 ; il n'hérite d'aucune clé de prestataire. Les comptes QA sont conservés dans le fichier privé existant, pas dans ce dossier de restitution. Aucun worker, tunnel public ou port réseau entrant n'est lancé par la procédure Web.

Le smoke du build réel sur ce seul loopback est **PASS** : healthcheck, album QA, nouveau brouillon de conditions et connexion en 200 ; bibliothèque anonyme redirigée en 307 ; nouvelle API Admin refusée en 401 hors session. Scan ciblé des fichiers du lot **PASS**, zéro correspondance avec les secrets QA connus ou motifs de clés privées. Les deux URL de dépôt explicitement fictives des tests sont identifiées comme telles, sans exemption du contrôle des véritables valeurs privées. L'archive de restitution est rouverte, chaque fichier est comparé à son manifeste SHA‑256 ; aucun master, base, `.env`, credential ou justificatif confidentiel n'y figure.

Aucune migration, dépendance, configuration de paiement ou donnée historique ne change dans ce lot. Aucune nouvelle insertion/approbation de territoire, aucun justificatif de personne réelle, nouvel achat ou remboursement réel n’a été créé. Les sources documentaires sont publiques officielles ; aucun compte prestataire ou dossier fiscal privé n’a été consulté.

**Aucun push, merge, déploiement, modification Production/Railway/OVH, paiement LIVE ou e-mail réel. Pas prêt Production.** La version locale reste accessible via le profil QA existant, nouveaux paiements désactivés ; les anciens masters non qualifiés/dossiers non approuvés ne sont pas rendus vendables pour embellir la démonstration.
