# Memory Hardening V1.1.0 — Phase 2

## Objet et prudence d'interprétation

Ce document complète l'audit et les corrections de
[`MEMORY_HARDENING_V1.1.0.md`](./MEMORY_HARDENING_V1.1.0.md). Il décrit des
mesures **locales**, réalisées sans réseau, sans base de données et sans
service externe. Il ne constitue ni une observation Railway, ni une preuve de
résolution de l'incident Production.

Incident humainement observé le **31/08/2026** :

- pression mémoire confirmée ;
- limite de ressource atteinte confirmée ;
- arrêt `Killed` observé ;
- aucun message OOM explicite conservé dans les preuves disponibles ;
- cause exacte Railway non identifiée ;
- aucune route, bibliothèque ou allocation unique démontrée comme cause.

Railway Hobby est actif et la RAM du service Web a été portée temporairement à
**2 Go**. Cette marge protège la disponibilité ; elle n'est ni un
dimensionnement final, ni une preuve que la cause est corrigée. Ce document ne
contient aucune donnée personnelle, de facturation ou de paiement Railway.

## Niveaux de preuve

| Sujet | Niveau | Ce qui est établi |
| --- | --- | --- |
| Matrice Sharp applicative A–D | `MEASURED_LOCAL` | Process Node frais par cellule, macOS arm64, charge synthétique progressive |
| Répétitions Sharp proche de 40 Mpx | `MEASURED_LOCAL` | Deux répétitions A–D et deux répétitions des caches bornés E8/F16 |
| Multipart 1×5, 5×5, 10×10 MiB | `MEASURED_LOCAL` | Matérialisation `Request.formData()` sans Sharp |
| Concurrence multipart actuelle et admission précoce | `MEASURED_LOCAL` | Trois requêtes synthétiques dans un même process, sans DB ni réseau |
| Projection SAV 1×5 et 5×5 MiB | `MEASURED_LOCAL` | `formData()` puis `Promise.all(arrayBuffer())`, sans DB |
| Next/Image, AVIF 1920 et huit variantes | `MEASURED_LOCAL` | Process Next local frais, cache d'optimizer local, aucune charge réelle |
| Stabilité des URLs et audit des routes média | `INFERRED_FROM_CODE` | URLs par Asset UUID, headers et chemins de streaming inspectés |
| Props `sizes` ciblées | `MEASURED_LOCAL` | Viewports 390/768/1280, DPR 2, largeurs demandées et overflow contrôlés |
| Comportement Linux/libc/allocator Railway | `NOT_MEASURED` | Aucun Docker/cgroup Linux disponible localement |
| Hit rate et taille du cache Next/Image Production | `NOT_MEASURED` | Aucun accès Railway et aucun trafic Production |
| Impact des listes Prisma et PDF en Production | `NOT_MEASURED` | Audit code uniquement ; mesure différée |
| Cause de l'arrêt Railway du 31/08/2026 | `NOT_IDENTIFIED` | Ne doit pas être déduite des benchmarks locaux |

## Rapports locaux utilisés

Les rapports sont des fichiers temporaires en mode `0600`, non destinés au
commit :

- `/private/tmp/lnxbeats-memory-hardening-phase2-report.json` ;
- `/private/tmp/lnxbeats-memory-hardening-phase2-repeat1.json` ;
- `/private/tmp/lnxbeats-memory-hardening-phase2-repeat2.json` ;
- `/private/tmp/lnxbeats-memory-hardening-phase2-bounded2.json` ;
- `/private/tmp/lnxbeats-memory-hardening-phase2-bounded3.json` ;
- `/private/tmp/lnxbeats-memory-hardening-phase2-multipart-full.json` ;
- `/private/tmp/lnxbeats-memory-hardening-phase2-final-d.json`.

Tous déclarent Node `v24.18.0`, `darwin`, `arm64`, zéro requête réseau, zéro
appel DB, zéro port ouvert, zéro artefact temporaire restant et aucun appel à
`global.gc()`. Le rapport principal dure 468 666,148 ms ; les deux répétitions
A–D durent 75 147,048 et 75 130,882 ms ; les répétitions E8/F16 durent
37 698,786 et 37 699,923 ms ; la matrice multipart complète dure
75 829,189 ms.

## Matrice Sharp applicative

### Méthode

La charge appelle le pipeline applicatif de normalisation des photos de
commande. Chaque cellule démarre dans un process Node neuf, configure Sharp,
effectue un warmup, puis cinq cycles sur la même fixture progressive. Le RSS,
`heapUsed`, `external`, `arrayBuffers`, les compteurs Sharp et les checkpoints
à 1, 5 et 15 secondes sont collectés toutes les 25 ms.

Les fixtures couvrent environ 0,25 ; 1 ; 4 ; 12 ; 24 et 39,5 millions de
pixels. La plus grande mesure 7 257 × 5 443 = 39 499 851 pixels. Les fichiers
synthétiques très compressibles permettent de mesurer surtout le coût du
décodage et de la transformation ; ils ne représentent pas la distribution de
photos réelles.

### Scénarios A–D

| Scénario | Cache Sharp | Concurrence demandée | Concurrence effective locale |
| --- | --- | ---: | ---: |
| A | défaut | défaut | 10 |
| B | OFF | défaut | 10 |
| C | défaut | 1 | 1 |
| D | OFF | 1 | 1 |

### Pic RSS, MiB

| Pixels | A | B | C | D |
| ---: | ---: | ---: | ---: | ---: |
| 249 841 | 97.4 | 93.8 | 95.2 | 91.4 |
| 999 364 | 117.6 | 105.2 | 111.6 | 98.8 |
| 3 999 188 | 181.1 | 133.5 | 171.8 | 123.8 |
| 12 000 000 | 341.1 | 201.3 | 324.6 | 185.2 |
| 23 998 408 | 617.2 | 310.2 | 561.6 | 296.7 |
| 39 499 851 | 895.1 | 474.8 | 863.1 | 424.1 |

### Durée des cinq cycles mesurés, ms

| Pixels | A | B | C | D |
| ---: | ---: | ---: | ---: | ---: |
| 249 841 | 29.606 | 29.054 | 29.204 | 28.642 |
| 999 364 | 100.377 | 100.107 | 98.191 | 98.213 |
| 3 999 188 | 375.799 | 373.731 | 373.269 | 371.657 |
| 12 000 000 | 1 100.533 | 1 156.528 | 1 104.703 | 1 092.048 |
| 23 998 408 | 2 193.189 | 2 184.170 | 2 218.269 | 2 182.208 |
| 39 499 851 | 3 616.441 | 3 594.902 | 3 609.739 | 3 584.634 |

À 39,5 Mpx, D réduit le pic de 895,1 à 424,1 MiB par rapport à A :
**−471,0 MiB, soit −52,6 %**. La durée passe de 3 616,441 à 3 584,634 ms :
aucun coût significatif n'est visible dans cette cellule séquentielle. Cela ne
mesure pas le débit sous trafic concurrent.

### Reproductibilité à 39,5 Mpx — pic RSS, MiB

| Rapport | A | B | C | D |
| --- | ---: | ---: | ---: | ---: |
| Matrice principale | 895.1 | 474.8 | 863.1 | 424.1 |
| Répétition 1 | 894.8 | 475.7 | 863.1 | 423.3 |
| Répétition 2 | 894.8 | 476.2 | 863.5 | 423.8 |

Les résultats proches de la limite sont reproductibles. Dans presque tous les
cas, le RSS à 15 secondes reste proche du pic. Une baisse isolée de C dans la
matrice principale n'est pas reproduite par les deux répétitions et ne doit pas
être utilisée comme preuve de libération durable.

### Caches bornés E8/F16

| Scénario | Cache mémoire | Fichiers | Items | Concurrence |
| --- | ---: | ---: | ---: | ---: |
| E8 | 8 MiB | 0 | 16 | 1 |
| F16 | 16 MiB | 4 | 32 | 1 |

| Rapport | Scénario | Pic RSS MiB | RSS idle 15 s MiB | Durée ms |
| --- | --- | ---: | ---: | ---: |
| bounded2 | E8 | 650.8 | 650.7 | 3 588.872 |
| bounded3 | E8 | 651.8 | 651.8 | 3 588.117 |
| bounded2 | F16 | 863.4 | 863.3 | 3 602.520 |
| bounded3 | F16 | 863.7 | 863.6 | 3 599.742 |

Même un cache configuré à 8 MiB conserve ici un RSS nettement supérieur au
cache OFF. La limite de cache libvips ne constitue pas une borne équivalente
du RSS. La configuration OFF est donc retenue, sans attribuer mécaniquement
toute la différence à une « fuite ».

### Décision Sharp

**`SHARP_CONFIG_CHANGE_JUSTIFIED`** :

- cache applicatif Sharp : **OFF** ;
- concurrence interne libvips via `sharp.concurrency()` : **1** ;
- configuration appliquée une seule fois par process via un symbole
  `globalThis`, y compris entre bundles serveur Next ;
- imports applicatifs Sharp centralisés dans ce wrapper ;
- aucune dépendance et aucune migration ajoutée.

Cette concurrence libvips à 1 est distincte du limiteur métier de photos
commande (1 opération active, 1 attente). Elle réduit le parallélisme natif au
sein d'une transformation ; la matrice séquentielle ne démontre pas le débit
Railway et le choix devra être observé après une future promotion autorisée.

Le cross-check final, exécuté après l'ajout du wrapper applicatif avec la
configuration exactement retenue, donne **425,7 MiB** de pic,
**425,6 MiB** à 15 secondes et **3 587,829 ms** pour cinq cycles. Il reproduit
donc D sans divergence significative.

## Multipart et admission avant matérialisation

### Coût de `Request.formData()` sans Sharp

| Charge | Taille multipart | Pic RSS MiB | external MiB | arrayBuffers MiB | Parse ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 × 5 MiB | 5 243 174 octets | 96.8 | 24.3 | 25.4 | 10.801 |
| 5 × 5 MiB | 26 215 282 octets | 173.2 | 67.6 | 88.8 | 23.617 |
| 10 × 10 MiB | 104 859 217 octets | 398.8 | 204.1 | 300.3 | 53.069 |

Le poids multipart compressé n'est pas une borne du RSS : le parser et les
représentations `File`/`ArrayBuffer` créent plusieurs zones de mémoire native.

### Trois requêtes concurrentes de 10 × 10 MiB

| Modèle | Pic RSS MiB | Pic formData actifs | Appels formData | Octets lus par requête | Troisième requête |
| --- | ---: | ---: | --- | --- | --- |
| Admission après `formData()` | 778.4 | 2 | `1 / 1 / 1` | `104 859 217 / 104 859 217 / 104 859 217` | 503 après matérialisation |
| Admission avant `formData()` | 380.8 | 1 | `1 / 1 / 0` | `104 859 217 / 104 859 217 / 0` | 503 avant ouverture/lecture du body |

Dans les deux cas, le limiteur finit à `active=0`, `queued=0`, avec concurrence
1 et une attente maximale. Avec l'admission précoce, la troisième requête est
refusée par `IMAGE_PROCESSING_BUSY` sans appeler `formData()`, sans ouvrir la
source et sans lire un octet.

### Décision multipart

**`EARLY_SEMAPHORE_ACQUIRE`** :

1. vérifier origine et authentification ;
2. valider `Content-Type`, boundary et `Content-Length` borné ;
3. appliquer rate limit et preflight DB de propriété/capacité ;
4. acquérir le slot multipart global process ;
5. seulement ensuite appeler `request.formData()` ;
6. conserver la concurrence 1, la file 1 et le refus 503 de la troisième
   requête ;
7. libérer le slot en succès, erreur ou abort.

Le niveau reste **`PARTIALLY_BOUNDED`** : une requête active et une requête en
attente peuvent chacune être matérialisées successivement, et le parser
standard reste bufferisé. Cette phase n'implémente ni multipart streaming, ni
tempfile, ni upload direct.

## SAV Phase 5E

Le pipeline SAV est distinct, sans Sharp, avec au maximum cinq fichiers de
5 MiB. La projection locale `formData()` puis
`Promise.all(file.arrayBuffer())` donne :

| Charge SAV | Pic RSS MiB | external MiB | arrayBuffers MiB | RSS idle 15 s MiB |
| --- | ---: | ---: | ---: | ---: |
| 1 × 5 MiB | 107.3 | 34.3 | 35.4 | 107.3 |
| 5 × 5 MiB | 207.9 | 115.1 | 136.3 | 207.9 |

Le contrat fonctionnel et les protections DB-first/no-store restent inchangés.
Le SAV n'est pas raccordé artificiellement au pipeline Sharp. Une admission
transport dédiée ou un parser streamé reste un candidat seulement si la charge
réelle ou les métriques après promotion le justifient.

## Next/Image

### Mesure locale du cache d'opérations

Avec la configuration Next/Image par défaut, un process frais passe de
**148,5 MiB** à **378,9 MiB** après la première variante AVIF 1920, puis à
**1 221,8 MiB** après huit variantes. Après 15 secondes d'idle, le RSS reste à
**1 221,2 MiB**.

Le cross-check final avec le cache d'opérations image désactivé part de
**143,4 MiB**, atteint **379,1 MiB** après la première variante AVIF 1920,
culmine à **407,8 MiB** sur les huit variantes, termine la séquence à
**382,3 MiB** et reste à **381,9 MiB** après 15 secondes. Le cache de résultats
filesystem reste présent et occupe **36 KiB**. Ces mesures locales justifient
le changement de politique de cache, mais ne reproduisent ni le hit rate, ni
la cardinalité, ni l'allocator Linux de Railway.

### Décision cache et concurrence

**`CACHE_POLICY_FIX`** :

- `experimental.imgOptOperationCache=false` ;
- le cache de résultats filesystem de Next reste actif ;
- aucun `imgOptConcurrency` n'est fixé dans cette phase ;
- aucune désactivation globale de `next/image` ;
- aucun passage généralisé à `unoptimized`.

La concurrence du Sharp applicatif et celle de l'optimizer Next sont deux
contrats distincts. Faute de mesure Linux, cette phase ne force pas une valeur
de concurrence interne Next.

### Tailles ciblées

L'audit trouve des URLs publiques stables par Asset UUID, une qualité unique
75 et des sources WebP immuables. Le problème ciblé est le choix de variantes
surdimensionnées en l'absence de `sizes` : un produit de 1 600 px pouvait
publier uniquement des candidats 1 920/3 840 px.

Corrections retenues :

- grille Boutique : largeur responsive 1/2/3 colonnes, maximum 430 px ;
- fiche produit : slot mobile plafonné à 600 px et desktop à 640 px ;
- aperçu Admin catalogue : `sizes="240px"` ;
- miniature panier : géométrie intrinsèque 64 × 64, candidats 64/128.

Le hero LCP et les `ProjectArtwork` déjà munis de `sizes` ne sont pas
réarchitecturés. Le harness navigateur local synthétique, à DPR 2, confirme :

| Viewport | Grille demandée | Détail demandé | Panier demandé | Overflow horizontal |
| ---: | ---: | ---: | ---: | ---: |
| 390 px | 750 px | 750 px | 128 px | 0 px |
| 768 px | 750 px | 1 200 px | 128 px | 0 px |
| 1 280 px | 750 px | 1 200 px | 128 px | 0 px |

Les captures locales sont conservées sous
`/private/tmp/lnxbeats-memory-hardening-phase2-visual-{390,768,1280}.png`.
Cette preuve est un harness visuel synthétique sans DB : elle valide le choix
de ressource, la géométrie et l'absence d'overflow, pas le LCP Production.

## Routes média et streaming

Décision finale locale : **`STREAM_STABLE`**.

- les previews audio conservent ETag avant lecture, HEAD par metadata, GET
  streamé et Range/206 ;
- les streams S3/local et leurs bornes existantes ne sont pas remplacés ;
- les routes image catalogue/boutique restent bufferisées avec une borne de
  12 MiB avant Next/Image ;
- Next/Image rebufférise nécessairement sa source sur un cache miss avant
  Sharp ;
- aucun CDN, `unoptimized` global ou refactor streaming spéculatif n'est
  introduit.

Les tests S3 factices couvrent : lecture normale sur deux sources successives,
annulation client avec destruction de la source par requête, propagation d'une
erreur source, puis 100 cycles complets avec 100 événements `before`, 100
événements `after`, un seul client de stockage et tous les compteurs finaux à
zéro. Le RSS réel de cette boucle n'est pas profilé ; cette preuve porte sur le
cycle de vie, les références et les compteurs, sans contact R2.

`STREAM_STABLE` signifie « ne pas modifier sans signal », pas « mémoire
Production prouvée stable ».

## Prisma et PDF

### Requêtes Prisma

Les candidats déjà audités restent non mesurés : historiques complets de
ShopOrders membre/Admin, commandes membre, droits, retours SAV et certaines
alertes readiness. Plusieurs écrans historiques sont déjà bornés à 100/200,
mais les listes non paginées doivent être mesurées avant croissance de
cardinalité.

Statut : **`NOT_MEASURED / DEFERRED_MEASURE_FIRST`**. Aucune pagination n'est
ajoutée dans ce hardening média.

### PDF

`lib/billing/pdf.ts` et `lib/rights/pdf.ts` accumulent les chunks PDFKit puis
font `Buffer.concat(chunks)`. La génération est actuellement unitaire et les
entrées sont bornées, mais aucun profil RSS/external/arrayBuffers représentatif
n'existe.

Statut : **`NOT_MEASURED / DEFERRED_MEASURE_FIRST`**. Ne pas remplacer PDFKit
ou modifier factures, avoirs et contrats sans benchmark ciblé.

## Décisions finales locales consolidées

| Domaine | Décision | Motif local | Limite |
| --- | --- | --- | --- |
| Sharp applicatif | `SHARP_CONFIG_CHANGE_JUSTIFIED` | D ≈424 MiB contre A ≈895 MiB à 39,5 Mpx | Débit Linux non mesuré |
| Cache Sharp applicatif | `OFF` | B/D nettement sous A/C ; E8/F16 restent élevés | RSS natif ≠ taille de cache configurée |
| Concurrence interne libvips | `1` | D réduit le pic natif ; distinct du limiteur métier 1 actif / 1 attente | Débit concurrent réel non mesuré |
| Multipart photos commande | `EARLY_SEMAPHORE_ACQUIRE` | 778,4 → 380,8 MiB ; troisième body non lu | `formData()` reste bufferisé |
| Next/Image | `CACHE_POLICY_FIX` | 1 221,8 MiB par défaut contre 407,8 MiB au pic cache opérations OFF sur huit variantes | Railway Linux et hit rate non mesurés |
| Responsive images | `TARGETED_SIZES` | Évite les variantes 1 920/3 840 pour petits rendus | Sélection navigateur à vérifier |
| Audio/streams | `STREAM_STABLE` | Contrats HEAD/Range/stream déjà appropriés | Pas une preuve Railway |
| SAV | `OBSERVE_AFTER_MEASURED_BASELINE` | 207,9 MiB au maximum contractuel local | Pas encore streamé |
| Prisma/PDF | `DEFERRED_MEASURE_FIRST` | Aucun signal quantifié | Hors correctif média immédiat |

Lignes décisionnelles finales de cette phase locale :

- `SHARP RESULT = SHARP_CONFIG_CHANGE_JUSTIFIED`
- `SHARP CACHE = OFF`
- `SHARP CONCURRENCY = 1`
- `MULTIPART = EARLY_SEMAPHORE_ACQUIRE`
- `NEXT_IMAGE = CACHE_POLICY_FIX`
- `S3_GET_STREAM = STREAM_STABLE`
- `MEMORY_BLOCKER_BEFORE_PRODUCTION = NO`
- `FUTURE DEPLOYMENT RECOMMENDATION = SAFE_FOR_CONTROLLED_PRODUCTION_OBSERVATION`

## Limites obligatoires

1. Mesures macOS arm64, pas Linux Railway.
2. Aucun Docker/cgroup n'était disponible ; aucune limite 1/2 Go n'a été
   reproduite.
3. RSS retenu par l'allocator natif ne prouve pas une fuite applicative.
4. Les processus frais et les fixtures synthétiques ne reproduisent pas un
   serveur Next long-lived sous trafic mixte.
5. Aucun R2, PostgreSQL, Stripe, PayPal, Resend ou Railway n'a été contacté.
6. Aucun crawler, cache hit rate Production, trafic utilisateur ou concurrence
   réelle n'est inclus.
7. Le cutoff local à 1,6 GiB empêche d'observer volontairement des scénarios
   au-delà de cette enveloppe.
8. `heapUsed` seul ne mesure ni Sharp/libvips, ni les `ArrayBuffer`, ni toute la
   mémoire du container.
9. Le cache filesystem Next et le RSS du process sont des métriques distinctes.
10. Les mesures ne permettent pas d'attribuer l'incident Railway à Sharp,
    multipart ou Next/Image pris isolément.
11. Aucun heap snapshot, profiler natif libvips/allocator ou flamegraph n'a été
    capturé ; l'analyse repose sur RSS, `heapUsed`, `external`, `arrayBuffers`
    et les compteurs applicatifs.
12. Les cycles sont volontairement courts et bornés ; ils ne prouvent pas le
    comportement d'un process après plusieurs heures ou jours.

## Gates de validation finale

Les gates ont été rejoués sur une installation locale propre issue du
`package-lock.json`. Aucun service métier externe n'a été contacté :

| Gate | Résultat |
| --- | --- |
| Tests média ciblés | PASS — 57/57 |
| Tests upload/commande | PASS — 44/44 |
| Tests Boutique/SAV | PASS — 185/185 |
| Tests complets requis par la mission | PASS — 878/878, 0 échec, 0 ignoré |
| lint | PASS |
| typecheck | PASS |
| Prisma format / validate / generate | PASS — schéma inchangé |
| build Production | PASS — Next.js 16.3.0, 15/15 pages statiques |
| `git diff --check` | PASS |
| secret scan | PASS — delta et bundle client sans valeur secrète |

`npm audit` et `npm audit --omit=dev` retournent également zéro vulnérabilité ;
`npm ls --all` réussit sur l'arbre installé proprement. Les rapports de
benchmark ayant produit leurs enveloppes attendues ne remplacent aucun de ces
gates.

## Observation après une future promotion autorisée

Aucune promotion ni modification Railway n'est réalisée par cette phase.
Conserver temporairement la limite 2 Go et observer :

| Point | Métriques minimales |
| --- | --- |
| T0 | RSS/container memory, CPU, restarts, `/api/health`, erreurs upload/image |
| T+15 min | même série, premières requêtes image cache froid/chaud |
| T+1 h | pente mémoire, cache hit/miss image, 429/503 upload |
| T+6 h | plateau RSS, CPU, restarts, erreurs métier |
| T+12 h | plateau et comparaison trafic/cache |
| T+24 h | décision de poursuivre l'observation ou d'ouvrir un lot ciblé |
| T+48 h | décision de dimensionnement ; ne pas réduire 2 Go sans marge durable |

Critères de succès : aucun restart, aucun retour vers la limite, plateau durable
avec marge, CPU acceptable, healthcheck stable, aucune régression upload,
aucune croissance non bornée de `external`/`arrayBuffers` et pas d'explosion de
variantes Next/Image.

`MEMORY_DIAGNOSTICS_ENABLED` reste OFF par défaut. Une activation hors local
nécessite une décision humaine séparée. Les logs autorisés restent structurés,
allowlistés et sans email, user/session ID, numéro de commande, fichier,
object key, bucket, URL signée, authorization header ou secret.

## Déclencheurs d'un lot complémentaire

Ouvrir un nouveau lot mesuré si l'un des signaux suivants apparaît :

- RSS encore monotone ou nouveau restart après le déploiement contrôlé ;
- pression corrélée aux cache miss ou variantes Next/Image ;
- fréquence notable des 503 d'admission upload ;
- usage SAV proche de cinq fichiers et pics `arrayBuffers` corrélés ;
- besoin démontré de multipart streaming/tempfile ;
- latence ou mémoire de listes Prisma croissant avec la cardinalité ;
- génération PDF mesurée comme dominante ;
- rétention de streams/sockets object storage démontrée par métriques.

## Séquence de promotion future

1. stabiliser le worktree et compléter tous les gates ci-dessus ;
2. revue humaine des changements et des mesures ;
3. commit/push/consolidation uniquement après autorisation ;
4. preflight et backup Production selon le runbook V1.1.0 ;
5. déploiement contrôlé séparément autorisé ;
6. observation T0 à T+48 h ;
7. décision humaine sur la limite 2 Go et les éventuels lots complémentaires.

Aucune de ces étapes distantes n'est exécutée par ce document.
