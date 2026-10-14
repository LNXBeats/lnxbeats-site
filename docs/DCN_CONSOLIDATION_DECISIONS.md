# DCN — décisions nouvelles restantes, après rapprochement des acquis

Ce registre ne remplace ni les décisions du propriétaire ni les validations historiques. Il distingue des choix réellement ouverts des vérifications opérationnelles. **Aucune activation LIVE, aucun prix réel, aucune validation fiscale ou juridique n’est effectuée dans ce lot.**

## Acquis à ne pas redemander

- Panier numérique séparé ; compte actif et e-mail vérifié.
- WAV + MP3 pour les nouveaux achats ; ZIP WAV et ZIP MP3 séparés.
- Conservation des versions originales payées, pas de remaster automatiquement ajouté.
- Complément d’album fondé sur les sommes effectivement payées et non remboursées, calculé en centimes, sans crédit dupliqué ni montant négatif.
- Catalogue d’albums, singles et inédits autorisés sans distribution préalable requise.
- Objectif international B2C, mais checkout ouvert uniquement par politique territoriale probante.
- CM2C déjà souscrit trois ans et payé 48 € le 27/08/2026. Pas de nouvelle adhésion.
- EI LNX Beats, SIRET et régime BNC/micro-BNC documentés ; franchise française historiquement appliquée. Ce n’est pas un avis fiscal sur le nouveau DCN.
- Documents juridiques antérieurs approuvés/versionnés conservés. Seuls les nouveaux documents DCN sont DRAFT.
- Safari iPhone physique : `NOT_RUN — validation facultative différée`, jamais PASS.

## Choix commerciaux/juridiques véritablement nouveaux

| Sujet restant | Comportement sûr actuellement livré | Décision utile, précisément limitée |
|---|---|---|
| Complément à montant dû nul, y compris crédit supérieur au prix album | Blocage informatif ; aucune session PSP à 0 €, aucune attribution silencieuse | Autoriser ou non une délivrance gratuite auditable ; document, justification comptable/fiscale, consentements et traitement des garanties |
| Bundles, cadeaux, promotions, avoirs commerciaux ou achats multi-lignes comme sources | Seuls singles acquis individuellement avec paiement final et allocation certaine sont admissibles ; cas complexes refusés | Méthode de montant effectivement attribuable à chaque piste, règles de preuve et plafonnement. Pas de prix « catalogue ancien » inventé |
| Crédit album et taxe réelle | Complément exercé uniquement sur fixture locale QA ; taxe réelle non présumée | Qualification de la déduction et répartition taxe/base par pays ; mentions facture/avoir du complément sans réécriture du single historique |
| Remboursement/chargeback d’un single dont le crédit est réservé ou consommé | Remboursement administratif bloqué pour revue ; fait externe conservé ; album dépendant suspendu pour revue, sans remboursement automatique | Conséquences commerciales et légales, maintien/retrait d’accès, éventuelle restitution ou compensation expressément autorisée ; jamais recapture silencieuse |
| Réutilisation d’un crédit après remboursement de l’album complété | Crédit consommé non libéré automatiquement ; histoire conservée | Conditions exactes de réutilisation ou non, calcul net historique et prévention d’un crédit circulaire |
| Une même œuvre dans plusieurs albums/éditions ou master différent | Référence canonique + même master exigés ; édition incompatible ou acquisition ambiguë refusée | Définir les équivalences commerciales légitimes, si souhaitées. Aucun rapprochement au titre textuel |
| Bénéfice MP3 des anciens achats WAV uniquement | Historiques et WAV acquis inchangés ; aucun octroi implicite ni conversion de leurs snapshots | Autoriser ou non un bénéfice rétroactif distinct, dérivé de l’exact ancien master avec une preuve additionnelle, sans changer son identité ni les factures historiques |
| Nouveau texte de licence personnelle | Brouillon sans cession de droits d’exploitation ; Rights existant préservé | Revue juridique de la formulation, usages personnels permis, droits impératifs selon pays |
| Fourniture immédiate, rétractation et confirmation durable | Consentements distincts et remise/accusé QA, non assimilés à une validation légale | Mécanisme, formulation, début d’exécution, dispositif de rétractation en ligne et preuve durable adaptés aux territoires ouverts |
| Fin de service, indisponibilité et conformité | Versions conservées, liens renouvelables, pas de promesse d’hébergement perpétuel | Modalités contractuelles de fin de service et corrections obligatoires de conformité, sans privation de recours |

Les prix réels restent **à renseigner et valider avant lancement**, comme déjà établi ; ils ne sont pas demandés à nouveau pour poursuivre le développement local. Les montants QA ne constituent aucun tarif définitif.

## Validations spécialisées nouvelles — pas reconstruction de l’EI

| Validation | État | Question strictement nouvelle |
|---|---|---|
| France : activité et TVA du téléchargement direct | FISCAL_REVIEW_REQUIRED | Qualification du produit et des recettes BNC/BIC/droits d’auteur, articulation avec l’activité artiste-auteur existante, franchise effectivement applicable au nouveau produit, seuils et mentions |
| UE hors France | FISCAL_REVIEW_REQUIRED | Régime transfrontalier retenu, conditions réelles des seuils/OSS/SME, preuves et conservation, puis règles par pays |
| Royaume-Uni | FISCAL_REVIEW_REQUIRED | Immatriculation et règles numériques applicables au vendeur non établi dans son cas réel |
| États-Unis / Canada / Australie / autres | FISCAL_REVIEW_REQUIRED | État/province quand requis, taxabilité/nexus/inscription et taxes applicables ; aucune dispense globale supposée |
| Contrats et langues par territoire | LEGAL_REVIEW_REQUIRED | Texte numérique et licence adaptés aux pays effectivement ouverts, recours impératifs, confidentialité/conservation internationale |
| Droits musicaux territoriaux | RIGHTS_REVIEW_REQUIRED | Autorisations du master/composition/interprètes/samples et extraits par territoire ; distribution préalable et paiement de royalties ne les prouvent pas automatiquement |
| Convention CM2C existante | Portée DCN à vérifier si nécessaire | Champ sectoriel/territorial du nouveau commerce. Récupérer la convention privée si requis ; **pas nouvelle inscription** |
| Merchant of Record éventuel | Étude seulement | Comparaison vendeur légal/responsabilité fiscale/couverture/frais/relation client avant toute décision ; aucun prestataire choisi ou intégré |

## Vérifications opérationnelles, distinctes d’un choix commercial

- **FFprobe** : binaire absent de l’environnement actuel. Conversion MP3 et contrôles réels exécutés avec FFmpeg borné (codec, durée, bitrate, décodage). Ne pas appeler ces preuves « FFprobe PASS ». Avant un environnement cible, décider si un binaire FFprobe vérifié doit être embarqué, puis valider son installation/version/licence/limites sans upgrade non nécessaire.
- **Worker** : confirmer les limites CPU/RSS/disque et les reprises sur l’hôte autorisé avant une éventuelle release. Les mesures locales ne prouvent pas la capacité de Production. Aucun changement mémoire Railway effectué.
- **Migration/rollback** : tester le candidat final sur une base jetable et un rôle non propriétaire ; conserver les nouveaux champs/tables lors d’un rollback. Un ancien binaire d’archive indexé seulement par `lineId` ne doit pas être relancé avec DCN ouvert après passage à `(lineId, format)`.
- **Catalogue réel** : importer des masters dont les droits sont validés, renseigner les tarifs définitifs, choisir les extraits et vérifier disponibilité des deux formats. Aucun ancien master, achat ou document ne doit être nettoyé globalement.
- **Activation future** : approbations explicites et versions probantes des nouveaux contrats et territoires, puis autorisation distincte de push/merge/déploiement. Le présent lot ne les accorde pas.

## Recettes externes conservées — portée exacte

| Preuve conservée | Statut acquis | Limite de réutilisation |
|---|---|---|
| Stripe TEST, base `88ca36e…` | PASS financier sur parcours exécuté ; recette clôturée | Ne certifie pas automatiquement les nouveaux formats, complément et pays. Aucun nouvel appel Stripe dans ce lot |
| PayPal SANDBOX, base `5ad9fe3…` | PASS financier : 1 Order/capture, 2 refunds, 3 webhooks authentiques | DECLINED/PENDING réels, timeout et relivraisons HTTP désordonnées restent NOT_RUN. Nouveaux scénarios uniquement locaux dans ce lot |
| R2 réel, base précédente `a3ddf22…` | PASS sur périmètres exécutés, objets acquis conservés, jeton QA révoqué | N’est pas une nouvelle recette R2 des MP3/doubles ZIP. Aucun accès distant ici |
| Safari Mac physique, base précédente `a3ddf22…` | PASS sur périmètre exécuté | Les nouvelles captures locales ne constituent pas une nouvelle recette physique complète du candidat modifié |
| Safari iPhone physique | NOT_RUN facultatif | Ni PASS, ni blocage automatique isolé |

Les nombres de contrôles locaux ne s’ajoutent pas artificiellement aux campagnes déjà clôturées. Les captures de démonstration, doublures de prestataire et PostgreSQL local sont identifiés comme tels.

**Conclusion :** développement local vérifiable et dossier de revue transmissible ; validations nouvelles `LEGAL/FISCAL/RIGHTS_REVIEW_REQUIRED`. Pas prêt Production.
