# DCN — CGV numériques France : dossier de revue, 15 octobre 2026

## Ce qui est livré

`lib/digital/france-legal.ts` contient un **nouveau brouillon distinct**, version `digital-music-france-cgv-20261015-draft-01`, avec texte client, modèle de notification de rétractation, libellés séparés de commencement anticipé/reconnaissance et empreintes SHA-256 du document et du texte. Le statut reste `DRAFT`, aucune approbation humaine/juridique/fiscale n'est enregistrée et aucune activation LIVE n'est possible du seul fait de son import.

Le périmètre commercial **déjà retenu et confirmé par l'utilisateur** est **France métropolitaine, Corse comprise, particuliers** (`commercialScopeUserConfirmed=true`). Ce choix n'est pas à redemander. `FR-MET` est un code de marché interne, pas un code ISO ni une approbation générale de `FR`. Outre-mer, étranger et B2B ne sont pas ouverts par ce fichier. **La licéité des modalités de cette restriction géographique reste à contrôler : la décision commerciale ne constitue pas un accord juridique.** `userApprovalRecorded=false` vise uniquement le texte des nouvelles CGV, conformément à `userApprovalScope=TERMS_TEXT_ONLY`.

Le vendeur et ses coordonnées sont repris des trois paragraphes d'identité des mentions légales approuvées ; le médiateur est repris de `consumerMediatorInformation`. L'EI, son SIRET et le régime historique sont des acquis, pas des questions à reposer. CM2C est déjà désigné et l'adhésion de trois ans du 27 août 2026 demeure un acquis déclaré par l'utilisateur ; la convention privée n'a pas été relue ici. Aucune nouvelle adhésion n'est préparée. Ni `data/legal.ts`, ni `digital-legal.ts`, ni leurs versions et empreintes historiques n'ont été modifiés dans ce travail.

Le brouillon décrit les WAV/MP3, les deux ZIP d'album, le nombre réel de pistes, les extraits de 60 secondes maximum, les versions acquises immuables, le complément calculé sur le net réellement payé/non remboursé et les paiements Stripe/PayPal confirmés côté serveur. **Les prix sont fixés librement par le vendeur, pas saisis librement par l'acheteur** ; aucun tarif réel n'est introduit. Aucune TVA à zéro ni mention d'exemption historique n'est appliquée automatiquement au nouveau flux.

Trois décisions commerciales supplémentaires sont conservées comme **USER_CONFIRMED, pas LEGALLY_APPROVED** : licence limitée à l'écoute/téléchargement/conservation privés, avec autorisation spécifique séparée pour diffusion publique/redistribution/publication/exploitation commerciale ; collaborations non commercialisées tant que les droits d'œuvre et de master ne sont pas vérifiés avec preuves Admin privées et historique ; changement d'avis examiné individuellement, sans remboursement commercial automatique après fourniture immédiate légalement encadrée. Aucune de ces décisions ne supprime rétractation, conformité ou autre recours impératif. Leur choix commercial n'est pas à redemander ; la relecture porte sur leur rédaction et leur mise en œuvre.

## Points juridiques ciblés et sources officielles

Consultation publique le **15 octobre 2026**, sans compte fournisseur, API de paiement ou modification distante. Certaines ouvertures directes Légifrance ont répondu 403 ; les textes officiels indexés accessibles ont été utilisés lorsqu'ils étaient lisibles. Cela n'est ni un avis juridique, ni une vérification du dossier fiscal privé.

| Sujet | Source et constat | Conséquence de rédaction |
| --- | --- | --- |
| Rétractation de principe | [DGCCRF, fiche du 2 octobre 2026](https://www.economie.gouv.fr/dgccrf/les-fiches-pratiques/delais-de-reflexion-ou-de-retractation-comment-sappliquent-t-ils) : quatorze jours à partir de la conclusion pour le contenu numérique sans support matériel. | Droit de principe annoncé, absence de motif exigé. |
| Exception de fourniture immédiate | [L. 221-28, 13°](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044563170/2026-06-23), version en vigueur depuis le 28 mai 2022 : commencement, consentement exprès préalable, reconnaissance et confirmation sont cumulatifs. | Ni paiement ni acceptation générale des CGV ne valent exception à eux seuls. |
| Confirmation durable | [L. 221-13](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044563210/2023-07-22) : remise de la confirmation avant le début de fourniture selon les conditions légales. | Version/consentements et preuve de remise doivent précéder le commencement ; définition de l'étape technique à relire avant LIVE. |
| Fonction en ligne | [L. 221-21](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044563193), version en vigueur depuis le 19 juin 2026 : fonctionnalité gratuite pour les contrats conclus en ligne. | Ne pas présenter le formulaire historique comme une prise en charge DCN déjà réalisée. |
| Remboursement après rétractation valable | [L. 221-24](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032226828). | Délai maximal de quatorze jours et moyen initial, sauf accord exprès sans frais ; pas de clause absolue « non remboursable ». |
| Modèle de notification | [Annexe de R. 221-1](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000045418600/2022-05-28/), référence officielle indexée ; accès direct refusé. | Modèle proposé avec vendeur, contrat, date, consommateur/adresse et signature papier seulement ; relecture finale requise. |
| Conformité du téléchargement ponctuel | [L. 224-25-12](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044132956/2024-10-06), version en vigueur depuis le 1er octobre 2021. | Défauts existant à la fourniture et apparaissant dans les deux ans ; corrections légales distinctes d'une nouvelle édition artistique. |
| Charge de la preuve | [L. 224-25-16](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044132877/2022-07-17), version en vigueur depuis le 1er octobre 2021. | Douze mois de présomption, non deux ans : le brouillon distingue ces durées. |
| Encadré légal | [Présentation des contrats, D. 211-3](https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069565/LEGISCTA000032807190/2025-06-25/?anchor=LEGIARTI000045981108) et [annexe officielle](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000045981318). | Le résumé ne prétend pas remplacer l'encadré réglementaire ; sa reproduction, sa mise en forme et la qualification fourniture ponctuelle sont des validations finales explicites. L'accès direct à l'annexe a renvoyé 403. |
| Géoblocage UE | [Commission européenne](https://digital-strategy.ec.europa.eu/fr/policies/geoblocking), page officielle lisible via son contenu indexé, et [règlement 2018/302](https://eur-lex.europa.eu/legal-content/en/ALL/?uri=CELEX%3A32018R0302), notamment art. 4(1)(b). | L'exception relative aux services électroniques dont l'objet principal est le contenu protégé par droit d'auteur doit être examinée précisément ; elle ne prouve pas une liberté générale de bloquer site, nationalité ou paiement. |
| Outre-mer et résidence nationale | [L. 121-23](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000042615545/2024-03-03), version en vigueur depuis le 5 décembre 2020. | Le texte français vise notamment l'accès aux interfaces et certaines différences de conditions ou de paiement liées à la résidence nationale. La mise en œuvre du périmètre métropole/Corse hors outre-mer doit être justifiée et relue ; le code interne ne constitue pas un accord juridique. |

## Écart applicatif constaté : rétractation numérique en ligne

Le lien `/retractation` est réel et les informations approuvées y sont rendues. Toutefois, à l'audit ciblé, `components/withdrawal-form.tsx` et `lib/legal/withdrawal.ts` acceptent seulement `MUSIC_ORDER` et `SHOP_ORDER`, avec leurs formats de référence ; ils ne traitent pas explicitement l'achat de catalogue numérique DCN. Le brouillon ne promet donc pas une fonctionnalité DCN inexistante. La notification par e-mail/courrier et le modèle ne dispensent pas de régler cette exigence en ligne avant ouverture.

**Aucun changement du formulaire, de son API, de sa table ou de ses preuves historiques n'a été effectué par ce lot documentaire.** Un raccordement ciblé devra préserver l'accusé durable, l'horodatage, l'anti-énumération et l'absence de remboursement automatique. Il ne faut pas assimiler une demande numérique à une fausse commande personnalisée pour contourner le manque.

## Validations réellement restantes

1. Relecture/approbation du nouveau texte numérique France et de la traduction juridique des décisions commerciales déjà confirmées, ainsi que des conséquences de fin de service, sans redemander ces décisions ni réapprouver les anciennes CGV.
2. Base juridique des modalités de la restriction de lancement **commercialement déjà décidée**, particulièrement outre-mer ; séparation entre consultation ouverte et autorisation d'engager une vente dans un marché fiscal/contractuel validé. Aucun nouveau choix de territoire demandé et aucune discrimination par nationalité, IP seule ou pays de carte ajoutée par ce fichier.
3. Qualification fiscale du nouveau téléchargement et mention exacte de facture ; le régime historique connu ne vaut pas validation automatique de ce flux.
4. Encadré réglementaire final de garantie et contrôle de la qualification fourniture ponctuelle/bibliothèque accessoire.
5. Prise en charge DCN de la rétractation en ligne et revue de l'enchaînement consentements, confirmation durable et commencement.
6. Couverture du nouveau commerce par la convention CM2C **existante**, uniquement si sa portée ne le couvre pas déjà ; aucune nouvelle adhésion.
7. Vrais prix et politique de traitement des seuls cas de complément restant en revue ; aucune décision de prix prise par le code juridique.

Ces réserves empêchent de qualifier le brouillon d'approuvé ou d'activer une vente réelle ; elles n'annulent pas les acquis techniques.

## Tests exécutés

```sh
NODE_OPTIONS=--conditions=react-server node --import tsx --test tests/digital/france-legal.test.ts
npx eslint lib/digital/france-legal.ts tests/digital/france-legal.test.ts
git diff --check
```

**10 tests PASS, 0 FAIL, 0 SKIP** ; lint ciblé et diff-check PASS. Contrôles du statut fermé, hashes déterministes, conservation des références antérieures, périmètre commercial et trois décisions confirmés sans accord juridique inventé, contenu WAV/MP3/ZIP, consentements cumulatifs et garanties, existence du lien de rétractation sans fausse prise en charge DCN, absence d'URL ODR obsolète et absence de taux/exemption fiscale inventés.

Aucune modification de code des parcours historiques, aucun appel Stripe/PayPal/R2, aucune configuration fournisseur, aucun push/merge/déploiement ni mutation Production/Railway/OVH.
