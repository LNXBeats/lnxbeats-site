# DCN — consolidation corrigée, 14–15 octobre 2026

## Résultat visible et limites avant lancement

**DEV_READY local** : pistes WAV + MP3, deux ZIP distincts par album, bibliothèque avec formats et documents, complément d’album chiffré sur les sommes réellement payées après remboursements, Admin des masters et registre territorial en lecture seule.

La démonstration utilise 12 pistes synthétiques. Le titre acquis 1,29 € puis remboursé de 0,29 € donne exactement 1,00 € de crédit : album QA 9,90 €, complément 8,90 €. Ces prix sont **fictifs**, pas des tarifs validés. Les quatre téléchargements effectués dans le navigateur correspondent aux SHA-256 des assets figés.

**Pas prêt Production.** Restent les tarifs réels et les nouvelles validations juridiques/fiscales/droits territoriaux du téléchargement mondial B2C, ainsi que les cas commerciaux complexes explicitement bloqués. Aucun pays LIVE autorisé ; 249 règles initiales REVIEW, zéro ALLOW. Les anciennes recettes prestataires ne certifient pas automatiquement les nouvelles fonctions.

## Base, rapprochement et sources

- Worktree isolé : `feature/dcn-1-0`, base `5ad9fe3073c971c1403197ccfcffe83abc84c760`, tree `e1fc4b88872534467304d92065c2ce70e0b60557`, initialement propre.
- Le checkout historique du bureau n’a pas été modifié. Aucun fetch, push, merge ou accès Railway/Production/OVH dans ce lot ; pas de prétendue vérification fraîche d’origin/main.
- Les 14 fichiers du dossier `LNX_DCN_RECONCILIE_20261014_CODEX.zip` ont été lus intégralement, dont 01 et 11. Les 13 empreintes du manifeste correspondent. SHA-256 de l’archive : `d91e74aaba23e73ece8127efe77896879384118485ab8028eb81496382219f70`.
- CM2C (27/08/2026, trois ans, 48 €), EI/SIRET, régime spécial BNC/micro-BNC et franchise française historique : **dossier utilisateur et référentiel existant**, pas nouvelle vérification de convention privée ou rescrit. Aucune nouvelle adhésion.
- Les documents APPROVED de `data/legal.ts`, leurs hashes, approbations et `effectiveAt:null` sont conservés. La portée des nouvelles ventes numériques reste distincte.

## Fonctionnalités et garde-fous livrés

### Formats, versions et worker

Un nouveau master WAV privé génère réellement un MP3 CBR privé (320 kbit/s par défaut ; 192/256/320 seulement) et un extrait public physiquement limité à 60 secondes. Les nouvelles acquisitions figent les deux assets et leur version. Les anciennes acquisitions restent au format original ; aucun octroi MP3 rétroactif ni modification de snapshot historique.

Chaque ligne album dispose de deux archives privées : ZIP WAV et ZIP MP3. Les pistes restent téléchargeables individuellement. Les noms d’entrée sont assainis, les octets et checksums contrôlés. Les routes vérifient propriétaire, compte, droits, remise contractuelle et incidents ; aucune clé de stockage complète dans les données client.

Le worker conserve ses leases persistantes, sa concurrence bornée (deux audio, un ZIP), son streaming, ses limites de disque/RSS, sa reprise après crash et son nettoyage par job. Les tests ont arrêté réellement les processus audio et ZIP puis repris le travail sans doublon.

FFprobe n’est pas disponible : le contrôle réel est réalisé par FFmpeg borné (codec, durée, bitrate et décodage), **pas “FFprobe PASS”**. Une qualification FFprobe explicite demeure à compléter si cette exigence est maintenue pour l’environnement cible. Aucun binaire n’a été téléchargé.

### Compléter l’album

Le serveur retrouve les singles individuels admissibles, le paiement confirmé et les remboursements confirmés correctement attribués. Il exige le même master et une source financière non ambiguë. Le crédit est réservé durablement sous verrou utilisateur et unicité persistante ; aucun appel réseau sous transaction PostgreSQL.

Le devis, le prix, les sources, les remboursements et la réservation sont revérifiés avant attribution puis première délivrance. Une piste n’est pas créditée deux fois. Les droits créés par la ligne cible ne sont pas confondus avec une source de crédit lors de la revérification.

Un remboursement/litige affectant une source réservée ou consommée conserve le fait financier et suspend l’album dépendant pour revue, sans recapture/remboursement automatique ni réactivation silencieuse. Une réduction de prix partielle conserve les droits ; une résolution totale les révoque selon la politique QA, sans supprimer l’historique.

Les compléments à zéro, sources complexes/multi-lignes/promotions/cadeaux, autres versions, preuve fiscale incertaine et réemploi circulaire de crédit restent fermés. Douze singles possédés ne sont pas artificiellement traités comme un achat album ; un complément positif peut être calculé, zéro reste à décider.

### Pays, fiscalité et contrats

Registre append-only par pays/subdivision B2C, version, preuve, dates et approbations distinctes. État américain/province canadienne exigés selon la règle ; pas de fallback ni résidence IP-only. Une règle absente, expirée, contradictoire ou non approuvée bloque avant PSP. Le runtime ne peut que lire ce registre.

La règle FR de démonstration est synthétique et **uniquement en mémoire** dans le profil loopback QA exact, sans credentials PSP ; elle ne peut pas ouvrir LIVE. Aucun champ navigateur ne permet de l’activer. Le paiement confirmé conserve sa preuve financière même si la délivrance doit passer en revue.

La première remise vérifie de nouveau le contexte territorial et les médias figés. Une expiration ultérieure de politique, seule, ne supprime pas un achat déjà délivré. Les contrôles compte/propriétaire/droits/remboursement continuent.

Deux documents nouveaux seulement : CGV musique catalogue et addendum de confidentialité, statut **DRAFT**. Licence personnelle, consentements distincts, confirmation durable, rétractation, conformité et médiation existante y sont proposés pour revue. Les commandes historiques continuent de vérifier leur ancien texte/hash ; les documents déjà émis restent immuables.

Facture, confirmation, avoir, export et e-mails QA réutilisent l’infrastructure existante. L’export conserve brut/crédit/taxe/formats/pays et neutralise les formules CSV. Frais/net ne sont pas inventés. Aucun e-mail réel ; cinq messages capturés, jamais marqués envoyés/livrés.

## Base locale, migrations et ACL

Source conservée en lecture seule : `127.0.0.1:55473/lnx_dcn_runtime_test`. Nouvelle copie de revue : `lnx_dcn_consolidation_test` ; copies d’upgrade distinctes, jamais écrasées.

Sauvegarde locale pg_dump chiffrée AES-256-GCM, clé séparée 0600, déchiffrement et SHA-256 vérifiés. SHA du dump : `b289b2eee7b7f8c9325183b264fb09a6ce47b0f91869487174e1bf762caad657`. Restauration PostgreSQL réelle puis application SQL finale des trois migrations. Les 104 tables historiques ont les mêmes compteurs et empreintes canaris ; source encore inchangée lors de l’upgrade final.

| Migration nouvelle | Objet |
|---|---|
| 20261015010000_digital_formats | Assets MP3 nullable, formats ZIP/tickets et invariants d’identité |
| 20261015020000_digital_completion_credit | Crédits persistants, unicité/réservations et snapshot |
| 20261015030000_digital_country_tax_rules | Registre pays en revue et snapshot de juridiction |

Aucune migration historique modifiée, aucune donnée historique réécrite. Les migrations sont des extensions ciblées sans suppression de données. L’ancienne unicité archive par `lineId` est remplacée par `(lineId, format)` : **rollback vers un ancien binaire mono-ZIP incompatible si DCN reste actif**. Fermer DCN et conserver schéma/archives/traces ; n’utiliser qu’un binaire compatible ou un adaptateur. Ne pas supprimer de MP3 pour recréer l’ancien index.

664 contrôles positifs/négatifs réellement exécutés avec rôles non propriétaires A/B, rotation et réexécution du provisionneur ; refus DELETE/TRUNCATE/DDL et champs non nécessaires. Crédit : mises à jour limitées au cycle d’état ; pays SELECT seulement. ACL des autres domaines inchangées. Le restore final réapplique le provisionneur sans prétendre répéter 664 nouveaux contrôles.

Le premier essai de restauration avait échoué faute de `--dbname`, avant restauration ; reprise uniquement dans la base vide. Son export temporaire déchiffré a été retiré après comparaison avec l’archive chiffrée récupérable. Les archives chiffrées et clés séparées sont conservées hors restitution ; aucun achat/master/document supprimé.

## Tests réellement exécutés — pas de total artificiel

| Campagne | Résultat / environnement |
|---|---|
| Suite sélectionnée, 38 fichiers | **277 PASS, 0 FAIL, 0 SKIP** ; unitaires/PGlite/FFmpeg/doubles prestataires, TAP conservé |
| Formats runtime | **18 contrôles PASS** ; PostgreSQL non propriétaire, vrais WAV/MP3/ZIP, stockage LOCAL, crashs de processus |
| Crédit runtime | **11 contrôles PASS** ; PostgreSQL réel, concurrence, réservations, remboursements et prestataires **simulés** |
| ACL | **664 contrôles**, campagne distincte décrite ci-dessus |
| Navigateur local réel | Album 12 pistes, crédit 1 €, complément 8,90 €, pays DE refusé, confirmation QA, bibliothèque, quatre téléchargements natifs vérifiés par hash |
| Responsive local | 375/390/430/768/1440 px, 12 pistes présentes et aucun débordement horizontal ; pas une recette iPhone physique |
| Documents | 5 PDF / 9 pages rendues et inspectées ; cinq e-mails HTML capturés uniquement |
| Gates | lint : 0 erreur, 4 avertissements historiques hors lot ; typecheck, Prisma validate/generate, build Web, build worker DCN et build worker médias existant : PASS ; diff-check PASS |

Les 18/11/664 contrôles et anciennes sous-suites ne sont pas additionnés aux 277 tests. Le cast TypeScript du nouveau double de dépôt a été corrigé après un typecheck FAIL ; test ciblé et typecheck ensuite PASS. Le build Web final compile également tous les types.

Commandes principales :

```sh
node scripts/digital-consolidation-final-tests.mjs
NODE_OPTIONS=--conditions=react-server node --import tsx scripts/test-digital-formats-runtime.ts --audio
NODE_OPTIONS=--conditions=react-server node --import tsx scripts/test-digital-formats-runtime.ts --downloads
NODE_OPTIONS=--conditions=react-server node --import tsx scripts/test-digital-formats-runtime.ts --resilience
NODE_OPTIONS=--conditions=react-server node --import tsx scripts/test-digital-completion-runtime.ts
NODE_OPTIONS=--conditions=react-server node --import tsx scripts/digital-consolidation-browser-proof.ts
npm run lint
npm run typecheck
npx prisma validate
npx prisma generate
npm run build
npm run dcn:worker:build
npm run creations:media-worker:build
git diff --check
```

Les scripts de mutation QA ne sont pas à relancer contre la base historique : profils/allowlists et copies distinctes obligatoires. Installation/lock inchangés ; pas de nouvelle campagne générale d’audit ou `audit fix` dans ce lot. Le scan ciblé de restitution et Git est documenté dans les preuves ; aucun scan ne constitue une garantie absolue.

Mesures locales du job volumineux : Node RSS pic observé ≈296,5 Mio ; FFmpeg ≈15,7 Mio ; répertoire du job ≈20,3 Mio. Échantillonnage local, pas dimensionnement Production garanti. Aucun réglage mémoire Railway modifié.

## Acquis réutilisés et contrôles non exécutés

Stripe TEST, R2 et Safari Mac antérieurs conservés sans relance. PayPal SANDBOX antérieur conserve son paiement, ses deux remboursements et trois webhooks signés ; DECLINED/PENDING réels, timeout et livraisons HTTP désordonnées restent NOT_RUN. Les nouvelles fonctions sont prouvées localement seulement. Nouvelle recette externe : **NOT_RUN, non autorisée**. Safari iPhone : **NOT_RUN — validation facultative différée**.

La lecture de documentation publique officielle n’est pas une recette PSP : aucun accès Account, Checkout, paiement, R2 ou API PayPal dans ce lot. Les pages fiscales impots consultées en maintenance n’ont pas été traitées comme validation fraîche. La matrice reste fermée et ne code aucun taux à partir d’une supposition.

Commandes/Boutique/DistroKid/soutien/Google/Rights, authentification et facturation partagée conservés. Non-régression locale ciblée auth/billing/stockage/shop/support/CSP/Rights incluse dans la suite sélectionnée. Pas de smoke Production ni de paiement réel revendiqué.

## Dossier et suite sûre

Le ZIP comporte ce bilan, les rapports détaillés, le registre des décisions nouvelles, les rapports antérieurs utiles, les migrations, la matrice pays, les preuves JSON/TAP, les captures réelles, cinq PDF et cinq e-mails QA, un index HTML hors ligne et une procédure locale. Il exclut secrets, profils privés, bases, sauvegardes et audio complet. Son manifeste et l’intégrité des entrées sont vérifiés après compression.

Le fichier `release-state.json` du dossier fournit SHA/tree et état Git finaux sans référence circulaire dans le commit. Aucun push/merge/déploiement. Le prochain lot est une revue des **nouvelles** décisions de `DCN_CONSOLIDATION_DECISIONS.md`, puis une autorisation distincte des tests externes éventuellement impactés. Pas de nouvelle création d’EI ni de médiateur à demander.
