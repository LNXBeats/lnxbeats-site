# DCN préparation Admin des albums et singles DRAFT

L’Admin permet de préparer et d’écouter une édition avant de la publier. Garder le projet masqué, les offres inactives et les prix vides jusqu’aux décisions réelles de LNX Beats. Le parcours reste local et TEST ; il ne vaut pas ouverture commerciale ni validation Production.

## Préparer puis prévisualiser

1. Créer ou reprendre l’album ou le single dans le Catalogue. Compléter les titres, leur ordre, la cover, les descriptions et les crédits. Les liens de plateformes restent facultatifs pour un inédit.
2. Ouvrir `/admin/musique/{slug}` et ajouter les masters WAV au lot. Associer explicitement chaque fichier à sa piste. Toutes les lignes en attente doivent être valides avant le lancement groupé ; deux fichiers vers la même piste bloquent aussi leur envoi individuel. Une ligne retirée du lot ne supprime jamais un master déjà importé ; une session encore récupérable doit être reprise plutôt qu’abandonnée silencieusement.
3. Choisir le début de chaque extrait en secondes, jusqu’à trois décimales. Le début doit être positif ou nul et inférieur à 1 800 secondes ; le moteur vérifie ensuite qu’il précède bien la fin réelle du WAV. L’extrait dérivé reste physiquement limité à 60 secondes.
4. Attendre WAV validé, MP3 privé et extrait prêts. Ouvrir « Prévisualiser avant publication » ou l’ancre `#edition-preview`. La prévisualisation montre la cover et les métadonnées enregistrées, l’ordre des pistes, leurs versions, leurs prix et disponibilités, ainsi que les lecteurs d’extraits. Elle fonctionne en brouillon, sur une piste annoncée et avant approbation des droits.
5. Écouter chaque extrait et vérifier son début. Les routes de prévisualisation exigent un Admin actif à e-mail vérifié dans le périmètre TEST. Elles ne servent aucun WAV ni MP3 complet et répondent sans cache partagé. L’accès public reste soumis à publication et droits validés.
6. Effectuer la revue des droits pour les versions exactes et leurs preuves privées. Fixer séparément le prix de chaque offre souhaitée et celui de l’album ; aucun montant ni remise n’est proposé automatiquement. Prévisualiser de nouveau avant toute publication locale explicitement autorisée.

Les fichiers vendus restent WAV original et MP3 privé par piste, avec ZIP WAV et ZIP MP3 distincts pour l’album. La prévisualisation Admin ne crée ni acquisition ni livraison. Les bornes existantes de taille et de ZIP restent celles du [guide d’import](DCN_REAL_ALBUM_IMPORT.md).

## Corriger le début après un import strict

Réimporter le même WAV sur la même piste en confirmant « Créer une nouvelle version » et en choisissant un début réellement différent. Le moteur redécode intégralement la source, contrôle son identité et sa version attendue, puis crée de nouveaux WAV, MP3 et extrait avec un événement `ADDITIVE_EXCERPT_REVISION`. Les trois médias repartent avec droits en attente ; l’ancienne approbation n’est pas copiée.

Cette exception ne permet pas de déplacer le même WAV vers une autre piste, de réimporter à l’identique un extrait inchangé ou de contourner une version devenue obsolète. Plusieurs copies historiques de cette source sont admises uniquement si elles forment une histoire cohérente de la même piste ; la vérification est bornée à 100 versions. Toute identité ambiguë reste en revue. La revalidation additive particulière d’un ancien master v1 demeure distincte. Les masters, droits, documents et contenus déjà acquis ne sont pas réécrits.

## Administrer une équivalence explicite pour le complément

La section « Équivalences explicites entre versions » de `/admin/musique/{slug}` permet à un Admin actif à e-mail vérifié d’enregistrer une décision locale TEST. Une équivalence sert uniquement à examiner le crédit d’un ancien achat vers le complément proposé. Elle n’attribue aucun fichier, ne remplace pas le master acquis et n’approuve pas les droits de vente de la version cible.

1. Choisir explicitement la piste canonique. Sélectionner le master source déjà acquis, puis le master cible proposé, dans ce sens précis. Les versions et leurs identifiants complets doivent correspondre à la paire relue.
2. Attendre le chargement de la dernière décision de cette paire. Cette lecture ciblée est indépendante de la fenêtre des 50 dernières décisions ; une paire ancienne ne devient pas implicitement « sans décision ». La liste des versions reste bornée à 100 éléments et sa troncature est signalée.
3. Choisir « Approuver », renseigner la référence opaque `private-evidence:…`, le SHA‑256 de la justification privée et un motif administratif sur une ligne. Attester la relecture avant d’enregistrer. Les justificatifs restent dans l’archive privée ; la liste Admin ne renvoie ni leur référence ni leur empreinte.
4. Pour révoquer, sélectionner la même paire dans le même sens, choisir « Révoquer », expliquer le motif et confirmer la relecture. La révocation ajoute une décision au journal ; elle ne supprime pas l’ancienne approbation. Les nouvelles preuves de crédit doivent alors échouer pour cette paire.

Le périmètre technique est limité aux deux versions d’un même identifiant canonique de piste. Deux autres identifiants restent refusés, même si les titres ou les fichiers sont semblables. Aucun rapprochement par nom, équivalence inverse ou chaîne transitive n’est déduit. Un nouvel import exige sa propre revue de droits ; aucune approbation d’équivalence ne la copie automatiquement. Les acquisitions, factures et documents historiques restent inchangés.

Une décision concurrente périmée est refusée. Après un résultat inconnu, conserver les champs et réessayer le même enregistrement avec sa clé existante, ou recharger les états avant une nouvelle décision ; ne pas multiplier les clés pour contourner le conflit.

## Contrôles locaux de ce sous lot

```sh
NODE_OPTIONS=--conditions=react-server node --import tsx --test tests/digital/admin.test.ts tests/digital/audio-revalidation.test.ts tests/digital/real-album-admin.test.ts tests/digital/admin-media-scope.test.ts
NODE_OPTIONS=--conditions=react-server node --import tsx --test tests/digital/audio-formats.test.ts tests/digital/audio-validation.test.ts
NODE_OPTIONS=--conditions=react-server node --import tsx scripts/test-digital-admin-preparation-runtime.ts
npx eslint scripts/test-digital-admin-preparation-runtime.ts tests/digital/admin-media-scope.test.ts components/digital-admin.tsx lib/digital/admin.ts 'app/admin/musique/[slug]/page.tsx' 'app/api/admin/digital/previews/[id]/route.ts' 'app/api/admin/digital/covers/[id]/route.ts' lib/digital/master-import-policy.ts lib/digital/media-worker.ts tests/digital/admin.test.ts tests/digital/audio-revalidation.test.ts
npx tsc --noEmit --incremental false
git diff --check
```

25 tests Admin, offres, politique de version et portée du worker PASS, avec doubles de dépôt et de métadonnées. 8 tests audio physiques locaux PASS avec FFmpeg et fichiers synthétiques, dont WAV, MP3, deux ZIP et extrait de 60 secondes maximum. Le premier essai audio a été bloqué par le contrôle RSS `ps` du sandbox ; la relance locale autorisée est passée. Lint, typecheck et contrôle du diff PASS.

La recette intégrée utilise exclusivement de nouveaux identifiants synthétiques sur `lnx_dcn_france_commercial_test_20261015`. Ses dix contrôles PASS couvrent deux ingestions physiques du même WAV de 65,321 secondes, aux débuts 0 et 12,345 secondes, les nouvelles identités et l’audit, les droits en attente, la conservation exacte de la première version et le refus des doublons inchangés, d’autre piste ou de version obsolète. Chaque appel du worker porte un `uploadId` précis ; un autre import en attente est resté intact jusqu’à son propre contrôle ciblé. Les masters copiés ont été comparés avant et après sans changement.

Les vrais handlers de routes ont également été appelés avec Request/Response, authentification, PostgreSQL et stockage local réels : GET, HEAD et Range Admin autorisés, octets comparés aux SHA-256, anonyme refusé 401, membre refusé 403, WAV/MP3 complets refusés 404, cover et extrait publics refusés sur le brouillon. Il s’agit d’une intégration de routes en processus, pas d’une preuve HTTP navigateur. La capture de l’interface relève de la recette locale consolidée. La preuve détaillée est `output/dcn-france-commercial/admin-preparation-runtime-9d063091-fe2e-432a-bdae-53dd46988e2f.json` ; les credentials restent dans un fichier privé distinct, jamais dans ce rapport.

### Contrôles des équivalences administrables

```sh
NODE_OPTIONS=--conditions=react-server node --import tsx --test tests/digital/master-equivalences-admin.test.ts
NODE_OPTIONS=--conditions=react-server node --import tsx scripts/test-digital-master-equivalences-admin-runtime.ts
npx eslint components/digital-master-equivalences.tsx app/api/admin/digital/master-equivalences/route.ts tests/digital/master-equivalences-admin.test.ts scripts/test-digital-master-equivalences-admin-runtime.ts 'app/admin/musique/[slug]/page.tsx'
```

Deux tests ciblés de structure UI/route PASS et six contrôles intégrés de vrais handlers, sessions, PostgreSQL et profil local PASS : anonyme et fausse session refusés 401, membre refusé 403, origine étrangère refusée 403, corps extra refusé 400 ; identifiant canonique étranger refusé sans événement ; approbation explicite idempotente et projection sans justificatif ; lecture ciblée de la paire ; décision périmée refusée puis révocation bloquant sa preuve ; masters, médias et droits acquis inchangés. La fixture synthétique termine en `REVOKED`, sans nouveau droit ni paiement. La preuve est `output/dcn-france-commercial/master-equivalences-admin-runtime-68bd89f9-2dcb-416a-b502-a13f19c1eb5f.json`.

Aucun vrai album, prix, droit, achat, prestataire, e-mail réel ou acquisition historique n’a été modifié par ce sous-lot. Les pièces et décisions du vrai catalogue restent à fournir. Pas prêt Production.
