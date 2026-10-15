# Dossier fiscal du téléchargement musical en France

15 octobre 2026 — préparation ciblée, sans déclaration, option fiscale ni approbation. Le lancement retenu est la vente directe aux particuliers résidant en France métropolitaine, Corse comprise. Outre-mer, étranger et B2B restent fermés. Stripe et PayPal sont conservés ; aucune intégration Merchant of Record n'est à préparer.

L'EI LNX Beats, son SIRET, son régime spécial BNC/micro-BNC et la franchise historiquement documentée sont réutilisés. CM2C est déjà souscrit : aucune nouvelle adhésion. Les réponses historiques concernant le soutien ne qualifient pas le nouveau téléchargement. Le dossier fiscal France précédent reste conservé ; cette synthèse précise surtout les flux et le volet social manquant.

## Séparer les quatre flux

| Flux | Justificatifs à conserver | Qualification à ne pas confondre |
| --- | --- | --- |
| SACEM | Relevés de droits, brut, retenues sociales/TVA éventuelles et net effectivement versé | Droits déclarés par un tiers ; vérifier l'option BNC déjà exercée et le précompte réel, sans déclarer deux fois le même revenu |
| DistroKid | Relevés détaillés des exploitations, contrat de distribution, commissions, retenues et virements | L'intitulé « royalties » et le versement d'un distributeur ne prouvent ni traitement en salaires, ni précompte français, ni identité avec une vente directe |
| DCN direct | Commande/version, prix brut, remise de complétion, facture, capture, frais connus, net, remboursement/avoir et preuve gratuite éventuelle | Vente de fichiers à usage privé ; ne pas la décrire comme une cession de droits d'exploitation, un don ou une vente de CD |
| Collaborations | Contrats et répartitions privés, qualité d'auteur/interprète/producteur, sommes facturées/encaissées et paiements éventuels aux collaborateurs | L'autorisation de vendre un master n'est pas une qualification fiscale. Aucun partage ou reversement automatique n'est créé |

Les droits intégralement déclarés par des tiers peuvent relever des traitements et salaires, avec option BNC ; les autres revenus artistiques suivent les règles BNC présentées par Service Public. Le micro-BNC est un régime fiscal : il ne suffit pas à identifier le régime social. [Service Public, fiscalité de l'artiste-auteur](https://entreprendre.service-public.gouv.fr/vosdroits/F36428).

L'autoédition et la vente de ses propres œuvres peuvent relever du BNC ; l'exploitation de droits acquis à autrui demande une analyse de l'activité. Cette base ne tranche pas à elle seule la qualité de producteur, les reprises ou les collaborations du futur catalogue. [BOFiP, auteur-éditeur, §80–90](https://bofip.impots.gouv.fr/bofip/2814-PGP.html/identifiant=BOI-BNC-CHAMP-10-10-20-20-20120912).

## Cotisations et déclarations

L'autodiffusion d'exemplaires de l'œuvre figure parmi les revenus artistiques principaux. Pour un revenu relevant effectivement du régime artistes-auteurs et du micro-BNC, Service Public présente une assiette issue des recettes, après abattement de 34 % et majoration de 15 %. Les droits précomptés par des tiers et les revenus BNC doivent rester distingués. Il faut faire confirmer le rattachement du **nouveau flux DCN**, son agrégation et l'IRCEC éventuelle à partir du dossier existant ; ne pas appliquer par défaut un taux de micro-entrepreneur ou fabriquer un nouveau statut. Aucun taux social n'est codé dans le checkout. [Service Public, régime social de l'artiste-auteur](https://entreprendre.service-public.gouv.fr/vosdroits/F23749).

Le micro-BNC porte sur les recettes brutes hors TVA et applique un abattement forfaitaire : les frais Stripe/PayPal ne deviennent pas une seconde déduction réelle automatique. La commission connue et le net restent enregistrés séparément pour rapprocher le versement. [Service Public, fiscalité de l'artiste-auteur](https://entreprendre.service-public.gouv.fr/vosdroits/F36428).

## TVA et factures

Le téléchargement de musique relève des services électroniques ; son traitement n'est pas celui du support physique. [BOFiP, services électroniques, §190](https://bofip.impots.gouv.fr/bofip/11964-PGP.html/identifiant=BOI-TVA-CHAMP-20-50-40-20-20211222).

La franchise documentée pour les activités actuelles n'est pas automatiquement une validation du téléchargement. Le BOFiP distingue auteur, interprète et producteur de phonogrammes ; la branche de franchise et les recettes à agréger doivent donc être confirmées pour cette activité précise. Les seuils et références déjà recensés dans `DCN_FRANCE_FISCAL_REVIEW_20261015.md` restent des éléments à qualifier, pas une règle active. [BOFiP, franchise des auteurs et artistes](https://bofip.impots.gouv.fr/bofip/148-PGP.html/identifiant=BOI-TVA-DECLA-40-30-20260701).

Franchise ne signifie ni taux de TVA « 0 % », ni absence d'impôt. Faire valider la mention légale actuellement applicable, puis le taux et les conséquences d'une sortie de franchise pour la métropole **et la Corse**. La DGFiP rappelle aussi que les seuils TVA sont distincts de ceux du micro-régime. [DGFiP, franchise et micro-entreprise](https://www.impots.gouv.fr/professionnel/questions/en-tant-que-micro-entrepreneur-puis-je-etre-redevable-de-la-tva).

Avant LIVE, relire un exemple de facture DCN avec identité EI existante, séquence définitive, dates, vraie désignation numérique, prix/remise, montant et mention fiscale validés. Les séquences `DCN-QA` et mentions TEST ne sont pas des factures de lancement. Les originaux historiques restent immuables.

## Comptabiliser sans réécrire l'histoire

- Vente à 10 €, frais connus 0,60 €, versement 9,40 € : garder les trois montants ; le prix initial n'est pas 9,40 €.
- Remboursement confirmé de 2 € : conserver la facture initiale et l'avoir relié ; ne pas prendre un état incertain pour un remboursement acquis. Confirmer le traitement d'un remboursement sur un exercice différent.
- Complétion : prix catalogue, sommes de titres éligibles réellement payées et non remboursées, déduction et nouveau montant dû restent distincts. Le crédit ne doit pas être consommé deux fois. L'ancien achat de titre n'est pas annulé par une remise sur un nouvel album.
- Complément à 0 € : aucune capture, aucun remboursement et aucune facture de paiement fictive. Conserver la preuve d'attribution, le calcul des crédits consommés et les documents contractuels. Faire confirmer si un document comptable complémentaire est nécessaire ; aucune recette positive n'est inventée.
- Tenir le livre et les pièces selon les obligations applicables ; un export technique n'en certifie pas à lui seul la conformité. [Service Public, obligations comptables](https://entreprendre.service-public.gouv.fr/vosdroits/F23266).

## Une demande regroupée, non envoyée

À joindre aux **quatre questions déjà préparées** dans le dossier France, sans redemander de créer l'EI ou de souscrire CM2C :

1. SIE/conseil fiscal : confirmer pour les propres compositions et enregistrements la qualification de l'autoédition directe dans le BNC existant, et préciser toute ventilation nécessaire auteur/interprète/producteur/collaborations. Confirmer la branche de franchise, les agrégats avec SACEM/DistroKid/autres activités et la mention applicable ; préciser le traitement hors franchise, Corse comprise.
2. Urssaf/conseil compétent : confirmer le régime social du nouveau téléchargement dans la situation existante, les rubriques/assiettes et le traitement des revenus déjà précomptés ; préciser l'éventuelle retraite complémentaire. Ne pas déduire le régime social du seul mot micro-BNC.
3. Conseil comptable : valider le complément payant ou gratuit, sa remise/documentation, les remboursements/avoirs et frais de PSP, notamment entre deux exercices ; confirmer les obligations de facturation électronique/e-reporting déjà recensées.

Le professionnel doit répondre sur ces faits et non sur une vente mondiale générique. Les pièces originales restent privées. Aucun accès à l'espace fiscal, relevé réel SACEM/DistroKid, correspondance confidentielle, inscription, option ou déclaration n'a été utilisé ou effectué dans ce lot.

## État applicatif à conserver

`FR-MET` reste `DRAFT / REVIEW / NONE`, sans taux ni exemption et sans insertion d'une règle `ALLOW`. Les autres territoires restent fermés. Le nouveau contrat DCN reste DRAFT ; aucune réponse favorable supposée ne devient une approbation serveur. La recette locale peut démontrer les mécanismes, pas leur validité fiscale LIVE.

Sources officielles relues le 15 octobre 2026 ; les limites d'accès et de consolidation des références historiques restent indiquées dans le dossier précédent. Ce dossier est préparatoire et ne remplace pas la validation du cas particulier.
