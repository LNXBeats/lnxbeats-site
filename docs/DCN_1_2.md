# DCN‑1.2 — interface proposée et parcours local d’un album complet

Date : 13 octobre 2026. Statut : **version locale testable ; revue visuelle et autorisations externes attendues. Pas prête pour Production.**

## Améliorations visibles livrées

- Fiche album recomposée : hero avec pochette/offre, puis pistes sur la largeur utile. Le récit, crédits et liens éditoriaux restent conservés ; aucune colonne vide face aux douze pistes.
- Une ligne cohérente par piste : titre, durée complète connue, commande d’extrait, prix QA et achat. Progression développée pour la piste utilisée ; chaque extrait reste accessible au clavier et au coordinateur audio existant.
- Panier numérique visible en desktop/mobile, compteur synchronisé, retour après connexion, annonces d’ajout et retrait des seules offres effectivement payées après contrôle serveur propriétaire.
- Ma musique : albums et titres individuels clairement distingués, pochette, date, nombre acquis, format/taille connus, ZIP et documents. Versions conservées dans les détails, pas effacées.
- Admin : sélection additive, association explicite, deux uploads actifs maximum, résultats individuels conservés, reprise ciblée et diagnostic de préparation. Avertissement de prix album purement indicatif, aucune remise imposée.
- Explications techniques reléguées dans des détails ; bandeau « Démonstration — aucun paiement réel · Prix fictifs » toujours évident.

Le visuel proposé n’est pas encore approuvé par Ludovic. Les prix 1,49 EUR/piste, 9,90 EUR/album et le cas temporaire 19,99 EUR sont **fictifs**, sans initialisation de tarifs réels.

## Blocages et limites restant à décider

| Sujet | État exact |
| --- | --- |
| Stripe TEST / PayPal SANDBOX / R2 distant | NOT_RUN : périmètres nommés et autorisation absents. Les références internes STRIPE du double ne prouvent pas une recette Stripe réelle. |
| Safari macOS et iPhone physiques | NOT_RUN. Navigateur Codex et viewports ne sont pas des appareils Safari. Hôte HTTPS privé/réseau exact à autoriser ; aucun tunnel ouvert. |
| Tarifs, panier séparé, compte vérifié, licence, futures éditions, albums partiellement possédés | Non validés commercialement ; protections provisoires maintenues, pas de prorata/remise automatique. |
| CGV, fourniture différée, preuve durable et fiscalité | Propositions QA, pas de qualification LIVE. Parcours différé/acceptation dédiée et traitement fiscal réel restent à finaliser selon décisions. |
| Exploitation | Cadence de réconciliation, réallocation de remboursement ambigu, reprise opérateur ZIP en revue, stockage durable/sauvegarde et stress Linux/ENOSPC restent des gates documentés. |
| Dépendances dev | Cinq HIGH liés au même advisory braces, dossier 1.1 réutilisé ; pas de correctif compatible déjà établi, pas de fix forcé ni de changement de package. Risque ouvert, pas une acceptation dev-only. |
| Accessibilité/QA non couvertes | Zoom navigateur effectif non obtenu par l’adaptateur (raccourcis sans changement mesurable) ; VoiceOver/physique non exécutés. Reflow 320/375 réel mesuré, mais pas renommé « zoom PASS ». |
| États financiers d’erreur en interface | États et contrôles unitaires présents ; aucun nouveau remboursement/litige fournisseur ni nouvel écran d’échec prestataire généré pour la capture. Ne pas confondre rejet d’import et refus de paiement. |

La matrice `DCN_1_2_LIMITS.md` contient **48 limites** avec impact, preuve, correction possible et dépendance. Le registre des 18 décisions et la demande externe complète sont joints, sans approbation implicite.

## Parcours Admin navigateur effectivement exécuté

Cible : PostgreSQL 17.11 sur `127.0.0.1:55473`, base `lnx_dcn_runtime_test`, runtime non propriétaire `dcn_runtime_a`. Web loopback `127.0.0.1:3140`, fichiers synthétiques sur disque local, emails capturés. Aucun credential prestataire dans le profil du lanceur.

1. Connexion Admin QA normale et création par l’Admin Catalogue de `dcn12-album-local`, brouillon privé, puis douze pistes nommées/ordonnées. Aucun album/piste/offre injecté en SQL à la place de la démonstration.
2. Sélection groupée de douze WAV, association explicite avec correction d’une association avant envoi ; début d’extrait de la première piste à 5 s. Les deux tâches concurrentes sont bornées.
3. Onze fichiers READY et un rejet `INVALID_SIGNATURE`. Sélection additive du douzième WAV valide : les onze succès et la ligne d’erreur restent dans le lot ; reprise du seul fichier. Douze masters/extraits prêts.
4. Offres individuelles à 1,49 EUR QA, album indépendant à 9,90 EUR QA. Droits et TEST explicitement confirmés en Admin ; publication/visibilité locales seulement après préparation.
5. Avertissement réellement vu à 19,99 EUR > somme 17,88 EUR des mêmes douze pistes ; prix principal remis à 9,90 EUR. Aucun calcul de promotion automatique.
6. Pochette publique autorisée réutilisée sans refaire son design ; aucune cover, date, crédit ou distribution inventée. Distribution `UNRELEASED` et aucun lien de sortie propre au projet : **inédit vendu localement sans distribution préalable**. Les profils artiste globaux ne constituent pas une sortie de cet album.
7. Écoute première/seconde/dernière piste, une seule lecture active. Durées chargées réellement 59,9 s et 8 s pour la source courte. `preload="none"`, pas de préchargement des masters ni de tous les aperçus.
8. Ajout au panier, continuation vers connexion, compte QA dédié vérifié, deux consentements non précochés, paiement **simulé local** confirmé côté serveur. Facture/confirmation générées par le worker ; aucun fichier accessible avant réception QA explicite après transfert du PDF privé.
9. Ma musique contient les douze droits ACTIVE. ZIP mis en file persistante PENDING pendant une pause contrôlée du seul worker local, puis READY après reprise du processus.
10. Téléchargements réellement enregistrés par le navigateur : ZIP **35 810 590 octets** et première piste WAV **12 672 078 octets**. Sommes SHA‑256 conformes aux sources acquises, douze entrées ZIP identiques aux masters, CRC et `unzip -t` réussis. Ce n’est pas un essai Safari physique.
11. Achat QA supplémentaire d’une seule piste du projet historique synthétique, sans modifier l’ancien album ni les anciennes acquisitions : bibliothèque mixte album/titre unitaire, pas « album complet » pour l’unité.

Les premiers cadrages d’import ne montraient pas les lignes visées. Pour compléter ces seules captures, une reprise ciblée de la piste 12 a été exécutée, pas un second import des douze pistes : rejet de signature, refus sûr d’un fichier identique au master existant (`DUPLICATE_MASTER_REVIEW_REQUIRED`), puis fichier synthétique distinct de huit secondes READY en V2. Les lignes d’erreur restent visibles et les droits de cette nouvelle version ont été reconfirmés séparément. Les images montrent ce cas ciblé, **pas onze succès transitoires d’un lot disparu**.

### Versions et composition acquises

Import individuel en Admin d’un WAV V2 réellement différent pour la piste 01, avec confirmation explicite de nouvelle version. L’ancien V1 n’est ni remplacé ni supprimé. Droits de V2 reconfirmés séparément.

Passage temporaire de la piste 12 à UNLISTED : le catalogue courant offre onze pistes, mais l’achat conserve ses **douze V1**, ordre, snapshots, contrat/documents, bytes/checksums et ZIP exacts. Preuves avant/après filtrées jointes. La gateway vérifie encore HEAD 200 sans consommation, Range 206, GET complet 200, refus 404 d’un autre membre même muni du cookie de ticket et refus anonyme 404.

État final de la fixture : douze pistes RELEASED vendables et une treizième `QA — Bonus annoncé`, ANNOUNCED sans master/offre. **Douze pistes incluses**, pas treize. Aucun bonus ou V2 automatiquement ajouté aux achats historiques.

Après la reprise ciblée finale de la piste 12 en V2, une dernière lecture seule confirme encore les douze versions acquises V1, snapshots, montant, contrat, documents et archive inchangés. L'ancien fichier de la piste 12 (256 078 octets) et le ZIP (35 810 590 octets) conservent exactement leurs SHA‑256. La nouvelle version courante est distincte. Les preuves `final-preservation.json` et `code-equivalence.json` sont jointes : vingt-huit sources métier, sécurité, workers et téléchargements restent byte-identiques entre le premier commit 1.2 et le code testé final ; le correctif de formulaire login est documenté séparément.

## Corrections locales de robustesse et sécurité

- Une réduction intégrale de prix peut conserver des droits ACTIVE sur une commande REFUNDED : elle compte désormais dans l’anti-rachat. Les droits REVOKED/SUSPENDED et états ambigus restent exclus.
- Bibliothèque paginée par vingt achats ; Admin par trente, totaux et navigation visibles, tri stable date+ID. Plus de troncature silencieuse après cent achats. Offset, pas recherche/curseur illimité.
- Changement rapide d’extrait : une pause volontaire du coordinateur pouvait rejeter `play()` et afficher une fausse indisponibilité. Seul `AbortError` volontaire avec audio réellement pausé et sans erreur média est ignoré. Les erreurs réseau/codec/permissions et `onError` restent visibles. Recette après correction : une lecture maximum, zéro fausse erreur.
- Le nettoyage des sélections numériques payées tolère un stockage navigateur indisponible ; il ne touche pas aux droits, aux paiements ou au panier physique.
- Incident local détecté : soumission native du login avant hydratation, mot de passe QA dans une URL de développement. Le formulaire utilise maintenant POST et un bouton fermé côté SSR jusqu’à hydratation, via snapshot React prévu pour cela. Aucune suppression de contrôle CSRF/Auth.
- Avec deux autorisations humaines explicites, rotation des **quatre comptes QA locaux** partageant cet accès, six sessions révoquées, ancien mot de passe refusé, nouveau vérifié localement, fichier privé 0600. Empreinte des acquisitions/snapshots/droits inchangée. Aucun compte réel/Production concerné ; aucun log brut/credential/cookie n’entre dans l’export. Les anciens dumps privés peuvent contenir les anciens accès : ne pas les restaurer comme accès actifs sans containment ciblé.

Passerelle de simulation : capacité explicite du lanceur, DB/port/rôle/origin exacts, acheteur synthétique dédié, TEST, disque local et mail capture. Références `dcn12-local-…` exclusivement ; aucune entrée navigateur ne fournit de preuve financière. Identité fraîche et unique tentative locale vérifiées en transaction. LIVE, credentials externes, autre origine/rôle, tentative étrangère/multiple/UNKNOWN/revue sont refusés. `DCN_NEW_PAYMENTS_ENABLED=false` et autorisation externe false restent en place.

## ACL et ressources

L’autorisation humaine Catalogue a été appliquée à la cible locale seulement : INSERT sur projects/tracks/project_assets ; UPDATE limité aux champs éditoriaux annoncés. Démonstration Admin positive avec vrai runtime, puis lecture des privilèges effectifs : droits nécessaires accordés, UPDATE hors liste/DELETE/TRUNCATE/ownership/DDL public refusés. Pas de GRANT global ni nom de rôle Production codé dans un provisionneur.

Bornes inchangées : 512 Mio/master, trente minutes/source ; extraits physiques MP3 <3 Mio et ≤60 s ; deux audio/un ZIP via slots PostgreSQL, fencing/heartbeat ; FFmpeg un thread, mémoire native surveillée, réserve disque 1 Gio ; ZIP STORE cent pistes maximum, <4 Gio, pas ZIP64. Lot navigateur cinquante fichiers maximum, deux tâches actives, sessions d’upload une heure/pièces 8 Mio. Toutes les durées/leases et restrictions précises figurent dans la matrice. Le petit album de cette revue n’est pas une preuve de charge maximale/R2/Linux/soak.

## Tests nouveaux et preuves réutilisées

Les compteurs ci-dessous sont séparés : **ne pas les additionner**, certaines non-régressions Auth se recouvrent. Les campagnes intermédiaires de développement ne sont pas recomptées comme preuves nouvelles.

| Commande / contrôle | Résultat / environnement / version |
| --- | --- |
| `NODE_OPTIONS=--conditions=react-server node --import tsx --test tests/digital/*.test.ts tests/digital-local-review.test.ts` | 59 PASS, 0 FAIL, 0 SKIP ; 348,439625 ms ; code `3ec945053ea4425659a2fba849d34ea3d9e3a6ba`, fichiers DCN inchangés jusqu’au code final. |
| 21 fichiers de non-régression ciblés (commande complète dans preuve JSON) | 132 PASS, 0 FAIL, 0 SKIP ; 596,747041 ms rapportés ; Boutique/DistroKid/Soutien/Commander/Créations/Rights/privé/Auth/facturation/coordinations. Domaines et fichiers concernés inchangés par le login ciblé ; Auth revérifiée séparément. |
| `NODE_OPTIONS=--conditions=react-server node --import tsx --test tests/auth/*.test.ts` | 54 PASS, 0 FAIL, 0 SKIP ; 651,056584 ms au code `e05e74a951f6103b7cd20b4a7b379e6d17932607`. Après adaptation lint du seul garde SSR, son test dédié repassé (1 PASS, 119,7035 ms) ; les 53 autres tests/handlers sont inchangés. |
| `npm run lint` / `npm run typecheck` / `git diff --check` | PASS sur code final ; aucune suppression de règle. Le premier garde useEffect refusé par lint a été remplacé par le snapshot SSR React, pas par une exception eslint. Écritures de cache/build autorisées localement après refus EPERM du sandbox. |
| `npm run build` | PASS code final `d2cca1857a4576f4d96a4a98b861b5ee9bb96249`, profil local expurgé ; Next webpack, TS, pages et traces terminées. Compilation 7,3 s, TS 2,6 s, pages 246 ms ; pas chronométrage de charge. |
| `npm run dcn:worker:build` | PASS ; graphe TS dédié, aucune génération Next inutile pour le worker. Worker métier inchangé depuis 1.1. |
| `scripts/digital-1-2-runtime-proof.ts --baseline` puis `--verify` | PASS ; vraie DB/FFmpeg/disque/ZIP/HTTP et vérification propriétaire, finance simulée seulement. Sessions/tickets/rate/audits/usages QA nécessaires, pas de mutation financière par la preuve. |
| Privilèges Catalogue effectifs, rôle runtime | PASS ; transaction READ ONLY, douze observations positives/négatives, pas propriétaire. |
| Login SSR HTTP puis navigateur normal | HTML local 200, POST, bouton désactivé avant JS ; bouton activé après hydratation et connexion normale avec nouvel accès QA. Aucun identifiant soumis en GET après correctif. |
| Responsive/navigateur | Admin, album et bibliothèque sans débordement mesuré à 320/375/390/1124/1440 ; clavier lecture/annonce/focus et coordinateur contrôlés. Images réellement 1440/390, anciens avant 1124/390 correctement étiquetés. |

Preuves réutilisées, **pas réexécutées ni ajoutées aux compteurs nouveaux** : installation `npm ci` standard, Prisma, canonique 1.1 (1 530 PASS/0 FAIL/1 SKIP), 22 groupes runtime/restauration/upgrade/canaris 1.1 et build worker historique. Modèles/migrations/package/lock et algorithmes de workers/finance concernés inchangés. SKIP préexistant : « Admin V2 generates and follows draft slugs without moving published URLs ». Pas de nouvelle migration 1.2 ni nouveau SKIP.

Audit 1.1 de même installation : runtime zéro vulnérabilité détectée ; cinq HIGH outillage du même avis GHSA-vfj7-8cjw-p6xm/CVE-2026-93687, `eslint-config-next16.3.8 → plugin → fast-glob3.3.1 → micromatch4.0.8 → braces3.0.3`. Motifs non fiables à isoler en CI ; pas d’upgrade forcé/fork ni nouvelle campagne pour gonfler un compteur. Aucun package/lockfile modifié. Cette réutilisation n’est pas un nouvel audit de Production ni une preuve d’absence de défaut applicatif.

## Captures et dossier transportable

Captures originales réelles, dimensions/navigateur/scénario/SHA dans `preuves/release.json`, avant/après dans `index.html`. Les images de travail sans pochette chargée ou montrant une mauvaise zone de scroll ne servent pas de preuve finale. Les captures transitoires d’import datent du même rendu applicatif que `ed0b01…` ; les derniers correctifs de login/annulation ne changent pas leur disposition. Ne pas prétendre qu’elles ont été reprises après chaque commit documentaire.

Les dernières captures de reprise ciblée Admin et de lecture desktop utilisent le code `d2cca185…`. Les captures ZIP transitoires au cadrage imparfait sont exclues du dossier ; leurs états PENDING puis READY et le vrai téléchargement restent démontrés par les preuves runtime, pas par une image trompeuse.

Trois PDF exportés et six emails HTML/texte **entièrement synthétiques** : facture, avoir d’un euro simulé, confirmation douze pistes ; noms/coordonnées/identifiants fictifs, marquage QA sans valeur comptable/fiscale. Rendu PDF effectivement inspecté ; référence d’avoir ajustée pour ne pas déborder. Les anciens PDF privés ne sont pas copiés, pas de données personnelles du vendeur/client dans les exemples. Les compétences PDF et Stripe ont servi à vérifier ces modèles et la séparation des preuves, pas à contacter un compte.

ZIP : `LNX_DCN_1_2_RESTITUTION.zip`, huit rapports dont les trois originaux 1.1 byte-identiques, index statique hors serveur, captures, exemples, preuves JSON filtrées, README/lancement et manifeste SHA‑256. Pas de code complet installable, masters, dumps, .env, cookies, secrets, profils privés ou logs. Vérification réelle ZIP/listing/empreintes ; statut d’ouverture visuelle hors ligne consigné séparément dans la restitution.

L’interface ne dispose pas d’un outil d’attachement binaire ZIP natif. Le fichier local exact à sélectionner pour transmission est fourni dans la réponse finale ; il contient les fichiers eux-mêmes, pas seulement des liens localhost.

## Git, lancement et prochaine décision

Base initiale `eef4c3c37ddf1392203dfd9900d6b286621d085a`, tree `00eeed98a1d314b8d355f39005b827d9e8c0e422`. Branche existante `feature/dcn-1-0`, autres worktrees conservés. Commits applicatifs locaux : `ed0b01a` interface/Album Admin ; `3ec9450` confirmations/annulation audio/preuves ; `de78e3b` sécurité login ; `e05e74a` containment QA autorisé ; `d2cca18` garde SSR compatible. **Code final testé : d2cca1857a4576f4d96a4a98b861b5ee9bb96249**, tree `7387aca0061bea6637266a24cad5fd37d57b7d90`. Le commit final suivant est documentaire/export uniquement ; SHA/tree exacts de livraison dans `preuves/release.json` et la réponse finale.

Main local vérifié inchangé : `47ba720a1d3bba072a365fd90be7961d0ab000c8`. Aucun fetch/push/merge/deploy ou appel Railway/Production dans ce lot. Ne pas présenter ce main local comme une lecture fraîche de Production.

Depuis le worktree existant, si arrêtés, terminaux distincts : `npm run dcn:local:web` et `npm run dcn:local:worker`. Ne pas relancer le bootstrap historique, restaurer par-dessus la base persistante ou modifier les comptes hors recette. Profil 0600 privé actuel ; aucun secret à transmettre par chat. Pages de revue : `/album/dcn12-album-local`, `/admin/musique/dcn12-album-local`, `/musique/panier`, `/compte/musique`. Elles sont servies seulement sur `http://127.0.0.1:3140` ; ce n’est pas une URL iPhone.

Prochaine décision : revue du visuel local, puis **une autorisation externe groupée** nommant sandbox Stripe, application/marchand/acheteur PayPal, compte/buckets/préfixe R2 et hôte HTTPS privé Safari, avec les plafonds complets du document joint. Aucun secret demandé dans la réponse. Les validations commerciales/juridiques demeurent distinctes de ces recettes.

`MAIN_PUSH=NO`, `MAIN_MERGE=NO`, `DEPLOYMENT=NO`, `RAILWAY_MUTATION=NO`, `PRODUCTION_MUTATION=NO`, `LIVE_PAYMENT=NO`, `LIVE_REFUND=NO`, `REAL_CLIENT_EMAIL=NO`, `PUBLIC_TUNNEL=NO`, `READY_FOR_PRODUCTION=NO`.
