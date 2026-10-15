# DCN — préparation lancement : Compléter l’album

Revue et corrections locales du 15/10/2026, depuis `21a790fe1668ba9b113c439dbe320c792a1c6b88`. Ce document complète, sans réécrire leurs preuves, les rapports de consolidation antérieurs. **Aucun tarif réel ni traitement fiscal du complément n’est approuvé ici. Aucun appel prestataire. Pas prêt Production.**

## Correctifs ciblés

- Une acquisition de titres dans un panier multi-titres ordinaire peut désormais être source : les lignes `TRACK`, chacune liée à une piste, doivent avoir des montants positifs figés dont la somme correspond exactement au montant payé de la commande. Un prix promotionnel ancien déjà porté par la ligne payée est conservé tel quel. Le moteur ne reconstitue jamais une promotion à partir du prix actuel ni d’un pourcentage supposé.
- Les remboursements confirmés sont répartis selon leurs **allocations exactes par ligne**. Un remboursement portant sur plusieurs titres ne se déduit pas intégralement de chacun. Une résolution d’une autre ligne de la même commande n’interdit plus le crédit des lignes demeurées actives.
- Un remboursement intégral `RESOLUTION` retire les droits concernés selon le mécanisme financier existant : cette acquisition révoquée n’est pas une source. Une réduction intégrale `PRICE_REDUCTION` peut laisser un droit `ACTIVE` : son montant restant est **0 centime**, ce qui prouve le chevauchement de propriété mais n’accorde aucun crédit monétaire et ne crée aucune réservation à zéro.
- Une véritable acquisition d’album possédant exactement les pistes/masters courants et tous les droits actifs est reconnue `ALREADY_OWNED`, y compris après modification du prix ou de l’ordre éditorial des pistes. Douze titres individuels ne sont pas assimilés à un achat d’album ou à un droit ZIP.
- La formule reste `reste album = prix album courant − somme des montants source payés non remboursés`, exclusivement en centimes entiers. Toute somme due nulle ou négative reste bloquée pour décision explicite : aucun paiement à zéro ni attribution gratuite implicite.
- Les crédits positifs restent réservés avant l’appel réseau du parcours existant, sous verrou utilisateur persistant, puis consommés de façon idempotente. L’index PostgreSQL interdisant une seconde utilisation du même titre canonique demeure la seconde défense. Un timeout ambigu ne libère rien.
- Les empreintes de preuve des acquisitions `v1` restent compatibles à données identiques ; aucune réécriture de snapshot, facture, avoir ou master historique.

## Matrice des cas

| Cas | Comportement local démontré | Limite précise |
|---|---|---|
| Titres séparés à des prix différents | Somme exacte des montants figés, pas des tarifs courants | Paiement final unique par commande source ; devise EUR/TEST dans ce candidat fermé |
| Promotion historique au niveau de chaque ligne | Montant de ligne effectivement payé et facture originelle inchangée | Remise globale sans allocation, cadeau et bundle ambigu restent en revue |
| Remboursements partiels ou complets | Allocations positives exactes, cumul par ligne borné ; résolution révoquée exclue ; réduction intégrale active = crédit 0 | Références manquantes, allocation incertaine, pending, litige ou contradiction : blocage |
| Album déjà acquis | Même offre + mêmes masters/contenu + droits actifs = déjà possédé | Un ancien album de composition différente n’est pas décomposé arbitrairement en prix de titres |
| Tous les titres achetés séparément | Complément possible si un prix positif reste dû | Le cas restant dû 0 exige encore une politique gratuite comptable/juridique explicite |
| Évolution du prix album | Nouveau devis sur le prix actuel ; l’ancien devis/panier a déjà un contrôle version/prix/empreinte | Aucun ancien document modifié ; aucun nouveau test PSP exécuté |
| Composition modifiée | Seuls les titres actuellement inclus sont éligibles ; nouveaux titres ne créent pas de crédit ; master remplacé non assimilé | Équivalences inter-éditions et crédit d’un ancien bundle/album exigent une règle distincte |
| Concurrence et double emploi | Une seule transaction réserve un groupe ; insertion directe du doublon rejetée ; consommation terminale | Pas de restitution automatique du crédit après remboursement de l’album complété |
| Remboursement d’une source déjà créditée | Revue administrative ; fait financier externe conservé et dépendance suspendue selon le mécanisme existant | Pas de recapture ni remboursement automatique d’un album dépendant |

## Tests effectivement exécutés

### Tests purs / doubles de dépôt

```sh
NODE_OPTIONS=--conditions=react-server node --import tsx --test \
  tests/digital/completion.test.ts \
  tests/digital/completion-repository.test.ts \
  tests/digital/album-ownership.test.ts
```

**34 PASS, 0 FAIL, 0 SKIP.** Cette campagne ciblée inclut les cas déjà présents concernés par les changements ; elle ne s’additionne pas artificiellement aux 277 tests du précédent lot. Vérifications nouvelles : multi-lignes, promotions figées, remboursements alloués à plusieurs titres, réduction intégrale sans crédit, résolution d’une ligne tierce, duplications de remboursements, stabilité des empreintes `v1`, prix/composition/ordre éditorial et arrondis entiers.

### PostgreSQL local réel, rôle non propriétaire

```sh
NODE_OPTIONS=--conditions=react-server node --import tsx \
  scripts/test-digital-completion-complex-runtime.ts
```

**7 PASS** dans `lnx_dcn_consolidation_test` sur `127.0.0.1:55473`, rôle `dcn_runtime_a` non propriétaire/non superuser. Tous les HTTP/HTTPS/fetch/TLS sortants sont bloqués dans le processus ; seul PostgreSQL loopback exact est admis.

La recette crée de nouvelles commandes/identités synthétiques, des paiements **fixtures** et des remboursements via **doubles de prestataire**. Elle exerce le dépôt réel, les allocations financières applicatives, les factures/avoirs QA, les transactions concurrentes et les contraintes PostgreSQL. **Ce n’est pas une recette Checkout/PSP/webhook, ni une nouvelle validation audio/publication.** Les masters existants sont seulement référencés en lecture, jamais publiés à nouveau ni réécrits.

Exemple effectif : lignes payées `137 + 49 + 201` et achat séparé `89` = crédit `476` ; remboursement partiel alloué `31 + 17`, résolution de la ligne `49`, puis réduction intégrale `89` avec droits conservés : crédit positif final **290**, prix album QA **990**, montant dû **700** centimes. Deux transactions concurrentes donnent un seul groupe de deux réservations positives ; la source de net nul ne crée aucune ligne de crédit. La consommation est idempotente et l’album désormais acquis est refusé comme nouvel achat.

Preuve : `output/dcn-launch/completion-complex-runtime.json`. Les commandes, acquisitions et documents synthétiques sont conservés. Une empreinte avant/après démontre que tous les documents/acquisitions préexistants et le catalogue/master référencé sont identiques. Aucun nettoyage destructif.

Le premier lancement sans élévation a été empêché par la restriction système `EPERM` sur le port PostgreSQL local, avant création des fixtures. Le lancement autorisé limité au même PostgreSQL a réussi. Un avertissement de dépréciation `pg` relatif aux requêtes concurrentes sur un client est apparu lors de la préparation documentaire existante ; aucun échec ni anomalie financière, mais ce point doit être revu avant un futur changement majeur de `pg`.

## Ce qui reste réellement à décider/valider

1. Traitement fiscal/juridique du crédit selon les territoires réellement ouverts. Le garde existant `COMPLETION_TAX_ALLOCATION_REVIEW_REQUIRED` hors fixture locale n’est pas supprimé.
2. Fourniture gratuite lorsque les achats éligibles atteignent/dépassent le prix album : justificatif, consentements et conséquences fiscales ; aucune décision commerciale inventée.
3. Répartition de promotions globales, bundles/cadeaux, anciens achats d’album et équivalences inter-masters lorsque la preuve ne donne pas un montant effectivement affecté à chaque titre.
4. Réemploi éventuel d’un crédit après remboursement de l’album complété et traitement du remboursement d’une source déjà créditée : revue ciblée, pas de crédit circulaire automatique.

Aucune nouvelle confirmation n’est demandée sur le panier numérique séparé, le compte vérifié, la conservation des versions, l’EI ou CM2C. Aucun nouvel appel Stripe/PayPal/R2, aucun push/merge/déploiement, aucune modification Production/Railway/OVH.
