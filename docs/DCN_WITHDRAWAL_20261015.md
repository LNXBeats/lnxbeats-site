# DCN — Rétractation et demandes consommateurs — local uniquement

Date : 15 octobre 2026. Base : `3a015d380e876e885feceb9c9e0bb603dbcc8fb3`.

## Réutilisation et parcours

Le modèle historique `ConsumerWithdrawalRequest`, `/retractation`, le reçu opaque et les limites persistantes existantes sont étendus à `DIGITAL_ORDER`. Aucun second registre de rétractations, aucun remboursement autonome, aucune modification des anciens documents juridiques.

1. Depuis la confirmation/bibliothèque, ouvrir `/retractation?contrat=digital&commande=<UUID>`. Sans connexion, seul l’UUID déclaré est prérempli ; aucune donnée de commande n’est recherchée pour affichage public.
2. Choisir **Rétractation**, **Non-conformité** ou **Geste commercial**. Prénom, nom, référence complète du contrat et adresse électronique sont requis. Aucune justification ni motif obligatoire pour se rétracter.
3. Relire le contenu, le corriger avec **Modifier**, puis **Confirmer ma rétractation** (autres démarches : **Confirmer ma demande**).
4. L’enregistrement transactionnel archive le contenu exact, date/heure UTC, empreinte et accusé. Un cookie opaque HttpOnly/SameSite donne immédiatement accès à l’accusé texte téléchargeable. Même réponse publique pour une référence rapprochée ou inconnue.
5. Pour DCN, la file `DigitalNotification` existante reçoit `CONSUMER_REQUEST_ACK`, atomiquement avec la demande et son événement. La capture locale ne vaut jamais `SENT` ni preuve de remise réelle. Le document téléchargeable n’attend pas le worker.
6. `/admin/musique/retractations` montre les 50 dernières demandes, leur accusé, les éléments disponibles et au plus 100 dernières revues du lot affiché. Le journal complet reste conservé. Le rôle Admin actif/email vérifié est recontrôlé en base à chaque lecture/décision.

La décision humaine est motivée, idempotente et protégée contre une vue périmée, y compris deux écritures dans la même milliseconde. Une décision retenue ne modifie ni commande, facture, acquisition, accès, paiement ni remboursement. Le lien vers l’achat ouvre la procédure financière DCN existante, distincte et contrôlée ; aucune opération prestataire n’est appelée ici.

## Évaluation juridique, sans rejet automatique

Les consentements exprès et reconnaissance de perte, la confirmation durable et le commencement effectif de l’exécution sont quatre exigences cumulatives de l’exception numérique, à examiner avec l’information délivrée. Deux cases ne suffisent pas. Un document streamé ou un e-mail capturé QA ne démontre pas une remise juridique ni un stockage sur appareil. Le seul dépassement apparent de quatorze jours n’entraîne aucun rejet : complétude de l’information et éventuelle prolongation restent à examiner.

`assessDigitalWithdrawalEvidence` expose une grille indicative, toujours `HUMAN_REVIEW_REQUIRED`. Le parcours TEST actuel conserve `durableConfirmation=false` car sa preuve de réception est explicitement QA/non validée juridiquement. Un rejet invoquant l’exception numérique est refusé si l’un des quatre éléments manque. La non-conformité et le geste commercial ne sont jamais traités comme cette exception. Une demande non rapprochée demeure enregistrée ; les décisions finales sont fermées tant que la correspondance n’est pas établie. Il n’existe pas encore de procédure technique de rattachement a posteriori d’une référence inconnue : traitement humain distinct à définir, sans écrasement de l’original.

Sources juridiques vérifiées par le lot principal : D221-5 (correction puis confirmation explicite et accusé sur support durable), L221-13 et L221-28 13°, information/prolongation L221-20. Ce développement ne constitue pas une validation des CGV DCN.

## Sécurité et migration additive

Migration nouvelle : `20261015040000_digital_consumer_withdrawal`. Ajout du type DCN, lien vers achat numérique, nature de demande, motivation privée, parent alternatif strict de la notification et déclencheur d’immutabilité de l’accusé/identification d’origine. Aucun historique réécrit. Les nouveaux accusés ont une politique/empreinte canonique versionnée résistant à l’ordre JSONB. Les anciens hash sont vérifiés en rétablissant l’ordre exact connu, sans les modifier.

La déduplication ne rend jamais le contenu d’une ancienne déclaration à une nouvelle personne connaissant seulement référence et adresse. Un contenu différent obtient son propre reçu ; l’ancien n’est pas exposé ni remplacé. Le taux reste 5 demandes/identité/heure et 20/adresse réseau/heure, sous verrou PostgreSQL existant. Corps JSON limité réellement à 8 Kio, origine même site, aucune capacité d’accusé dans l’URL.

Le provisionneur DCN ne reçoit que SELECT/INSERT et UPDATE des colonnes nécessaires de `consumer_withdrawal_requests` (capacité opaque, revue, projection d’accusé, horodatage). Aucun UPDATE du contenu/identification/hash, ni `refundStatus`, DELETE, TRUNCATE, ownership ou DDL. Les événements DCN restent append-only. Les permissions des autres domaines ne sont pas remplacées.

## Vérifications

Commandes locales :

```sh
NODE_OPTIONS=--conditions=react-server node --import tsx --test tests/legal/withdrawal.test.ts tests/legal/digital-withdrawal.test.ts
npm run prisma:generate
npm run prisma:validate
npm run typecheck
```

Tests propres : normalisation/catégories ; absence de motif ; reçu canonique/legacy après permutation JSONB ; origine et vraie limite de corps ; enregistrement/file atomiques sous doubles ; unicité/retries ; confidentialité d’une déclaration différente ; limite persistante ; quatre preuves cumulatives ; rôle Admin frais ; revue/audit/idempotence JSONB ; protection contre version périmée ; capture QA sans faux envoi ; portée du traitement de file ; invariants SQL et ACL. Ce sont des tests de logique/repository doubles, pas une recette prestataire, navigateur, e-mail réel ou juridique. Les résultats réels de migration/ACL sur une copie PostgreSQL sont consignés séparément par le lot principal.

`processDigitalNotifications(limit, sender?, orderId?, withdrawalRequestId?)` permet de traiter uniquement l’accusé QA nouvellement créé sans consommer les notifications historiques copiées. Les deux scopes simultanés sont interdits.

Limites de lancement : transport/délivrance réelle de l’accusé DCN et confirmation durable juridiquement recevable non validés par capture ; wording juridique final à revoir ; recette navigateur réelle du nouveau formulaire non exécutée dans ce sous-lot. Aucun vrai e-mail, fournisseur, acquisition historique, Production, Railway, push ou déploiement touché.
