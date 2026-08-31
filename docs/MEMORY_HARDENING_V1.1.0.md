# Memory Hardening V1.1.0 — Phase 1

## Périmètre et niveau de preuve

Cette phase est une correction **locale uniquement**. Elle ne déploie rien, ne
contacte aucun service externe et ne change ni schéma Prisma, ni migration, ni
dépendance. Les constats ci-dessous distinguent volontairement l'incident
Railway observé des améliorations testables en local.

La Phase 1 réduit des facteurs de pression mémoire identifiés. Elle ne permet
pas d'écrire « fuite mémoire corrigée », ni d'attribuer le crash Railway au
seul client S3/R2. Le runtime Production, sa charge, son cache Next/Image et ses
allocations natives n'ont pas été reproduits intégralement.

## Incident observé — 31/08/2026

Les preuves humaines disponibles établissent :

- une croissance de la mémoire du service Web Railway ;
- un plafond de ressource proche de 1 Go atteint ;
- un arrêt `Killed` observé ;
- **memory pressure confirmée** ;
- **resource limit reached confirmé**.

Elles n'établissent pas :

- un message OOM explicite ;
- la route ou l'allocation exacte responsable ;
- une cause applicative unique ;
- que le churn S3/R2, Next/Image ou les uploads ont causé à eux seuls l'arrêt.

La cause Railway exacte reste donc **non entièrement identifiée**.

Railway Hobby est désormais actif. La limite RAM du service Web a été portée
temporairement à **2 Go le 31/08/2026** afin de protéger la disponibilité. Ce
filet de sécurité n'est pas un dimensionnement définitif et ne prouve pas que
l'incident est résolu. Il ne devra être réévalué qu'après 24 à 48 heures
d'observation d'une future version corrigée. Aucune donnée de paiement ou de
facturation Railway n'est consignée ici.

## Corrections Phase 1

1. Le stockage objet devient un cache compatible avec la durée du process,
   indexé par configuration, au lieu de reconstruire `S3MediaStorage` et
   `S3Client` à chaque résolution.
2. La validation média du healthcheck parse et vérifie la configuration sans
   construire de client S3 et sans appel réseau.
3. Les photos de commande sont lues, transformées et persistées une par une ;
   les buffers de sortie ne restent plus dans le tableau de métadonnées.
4. Les transformations Sharp de ce pipeline utilisent un limiteur global au
   process, partagé entre bundles serveur Next, de concurrence `1` et une file
   bornée à `1` attente.
5. Une instrumentation mémoire serveur, événementielle et strictement opt-in
   expose uniquement des métriques process et trois compteurs actifs.

## Statut des findings

| Finding | Avant | Phase 1 | Statut |
| --- | --- | --- | --- |
| Churn client S3/R2 | Nouvelle instance à chaque résolution objet | Cache par configuration, une instance compatible réutilisée pendant le process | `RESOLVED_PHASE1` |
| Healthcheck et S3 | La validation appelait la factory active et construisait un client | Validation syntaxique/configuration uniquement ; zéro client attendu sur 500 appels | `RESOLVED_PHASE1` |
| Pic mémoire photos de commande | Multipart matérialisé, `Promise.all(arrayBuffer)`, sorties conservées | Lecture paresseuse après acquisition, Sharp séquentiel, persistance immédiate, file bornée | `MITIGATED_PHASE1` |
| Preuves photo SAV | Cinq buffers de 5 MiB possibles via un pipeline distinct | Contrat inchangé ; pas de Sharp ; matérialisation multipart toujours présente | `OBSERVE_PHASE2` |
| Next/Image | Optimisation Sharp native et variantes de cache possibles | Audit uniquement ; sources stables et espace de variantes borné par la configuration | `OBSERVE_PHASE2` |
| Listes Prisma croissantes | Plusieurs listes métier ne sont pas paginées | Aucun changement volontaire | `OUT_OF_SCOPE` |
| PDF bufferisé | PDFKit accumule les chunks puis fait `Buffer.concat` | Aucun changement volontaire ; mesure préalable requise | `OUT_OF_SCOPE` |

## Stockage S3/R2 — architecture et cycle de vie

### Avant

`activeMediaStorage()` et `mediaStorageForReference()` pouvaient appeler
`objectStorage()`, qui construisait un nouveau `S3MediaStorage`, donc un nouveau
`S3Client`. `validateMediaStorageConfiguration()` suivait aussi ce chemin pour
le simple healthcheck. Aucun `destroy()` applicatif systématique ne compensait
ce churn.

### Après

Le niveau obtenu est **`CONFIG_SCOPED_CACHE` + `PROCESS_SINGLETON`** :

- la clé de cache couvre fournisseur, endpoint, région, buckets public/privé,
  path-style et identité des credentials ;
- la clé est un condensat interne, jamais journalisé ni persisté ;
- les buckets public et privé partagent sans ambiguïté le même client, puis le
  bucket est choisi selon le scope de chaque opération ;
- une configuration distincte produit une instance distincte ;
- une configuration invalide échoue avant initialisation ;
- un bucket partagé entre les scopes public et privé est refusé par cette
  validation pure, avant toute construction de client ;
- un échec du constructeur n'est pas mis en cache ;
- tous les entrypoints serveur d'un même process partagent un cache porté par
  un symbole versionné `globalThis`; cela évite de dépendre de la déduplication
  des modules par Next et limite aussi les doublons liés au hot reload ;
- le reset et l'injection de factory sont gardés par `NODE_ENV=test` et ne sont
  pas exposés par une route applicative.

Le client long-lived n'est **jamais détruit après une requête**. Il vit jusqu'à
la fin naturelle du process Node et disparaît au restart/deploy. Son état ne va
ni en base, ni dans un fichier, ni dans Redis.

### Tests du cycle de vie

Les tests sans réseau injectent une factory S3 dédiée et réinitialisent le même
cache porté par `globalThis`. Ces deux seams refusent de fonctionner hors de
`NODE_ENV=test`. Le reset sert uniquement à isoler les cas de test : il ne
constitue ni une route, ni un mécanisme de destruction utilisable en runtime.
Les tests de réutilisation couvrent plusieurs résolutions depuis le même
process sans recréer de client.

### Scripts one-shot audités

- `scripts/media-migrate.ts` utilise le stockage actif mis en cache pour la
  durée du processus, puis le process se termine ;
- `scripts/test-audio-r2-staging.ts` détruit explicitement son client
  d'inventaire directement possédé dans un `finally`; le stockage actif reste
  attaché au process one-shot ;
- `scripts/test-media-r2-staging.ts` encapsule un client temporaire dans
  `S3MediaStorage` et nettoie ses objets, mais ne dispose pas d'un hook public
  de destruction du client ;
- `lib/production/media-import.ts` possède également un client one-shot sans
  hook explicite de destruction.

Les deux derniers cas finissent avec leur process et ne créent pas de churn
par requête Web. Ajouter un contrat explicite `dispose()` pour les seuls
clients one-shot directement possédés reste une amélioration de cycle de vie à
évaluer séparément ; il ne faut pas ajouter de `destroy()` au singleton Web.

Les timeouts, `AbortController`, multipart borné (parts de 8 MiB, concurrence
2) et compensations d'échec S3 restent inchangés.

## Healthcheck

La partie média de `GET /api/health` est désormais **`PURE_LOCAL`** : elle
valide driver, environnement, endpoint, région, buckets et présence des champs
requis, sans `S3Client`, socket, requête R2 ni accès DB. Le chemin local peut
construire un objet `LocalMediaStorage` léger, sans I/O.

Le contrat HTTP historique est conservé : forme utile du JSON, statuts 200/503,
sémantique de readiness et `Cache-Control: no-store`. Les autres sous-contrats
du healthcheck (paiements, notifications, boutique) ne sont pas modifiés.

Preuve d'acceptation confirmée par le benchmark local :

- 500 validations healthcheck ;
- 500 réponses 200 dans l'environnement factice valide ;
- 0 création de `S3Client` ;
- aucun appel réseau.

## Upload des photos de commande

Le contrat fonctionnel reste : 1 à 10 fichiers, 10 MiB maximum par fichier,
JPEG/PNG/WebP authentique, jusqu'à 40 Mpx, réencodage WebP privé et ordre
conservé.

Avant la Phase 1, `request.formData()` matérialisait le multipart, puis
`Promise.all(file.arrayBuffer())` matérialisait simultanément tous les buffers.
Le service transformait et persistait déjà les fichiers dans une boucle, mais
le tableau `pending` conservait chaque buffer WebP normalisé jusqu'à la fin.
Des requêtes distinctes pouvaient en outre exécuter Sharp en parallèle.

Après la Phase 1 :

- les `File` sont transformés en sources paresseuses ;
- le slot global est acquis avant `arrayBuffer()`, le décodage et Sharp ;
- une seule transformation Sharp est active dans le process, y compris entre
  graphes de modules/entrypoints Next grâce à un symbole versionné
  `Symbol.for(...)` sur `globalThis` ;
- une seule opération peut attendre ; une troisième demande concurrente
  échoue proprement en 503 au lieu d'allonger une file illimitée ;
- chaque sortie est persistée avant la lecture de la source suivante ;
- seuls les métadonnées et la référence persistée restent en mémoire ;
- l'annulation retire son waiter ; les états finaux attendus sont
  `active=0`, `queued=0` et `activeImageTransforms=0` ;
- si une étape échoue, les objets déjà persistés sont compensés avec
  `Promise.allSettled`, puis la transaction métier reste cohérente ; un échec
  de suppression produit un diagnostic structurel sans clé objet, nom de
  fichier, utilisateur ni commande, tout en préservant l'erreur primaire.

Le niveau est **`PARTIALLY_BOUNDED`**, pas `FULLY_BOUNDED` :
`request.formData()` peut déjà conserver le multipart et ses `File` en mémoire.
Une Phase 2 pourra mesurer puis étudier multipart streaming, fichier temporaire
streamé ou upload direct contrôlé. Cette limitation ne doit pas être masquée
par la seule borne Sharp.

## Preuves photo SAV Phase 5E

Le pipeline SAV est distinct de celui des anciennes photos de commande :

- maximum 5 fichiers ;
- maximum applicatif 5 MiB par fichier ;
- JPEG, PNG ou WebP ;
- extension, MIME et signature magique concordants ;
- stockage privé, fichiers en mode 0600 et renommage atomique ;
- lecture DB-first avec contrôle propriétaire/Admin, `no-store`, `noindex` ;
- nettoyage des fichiers écrits si la transaction échoue.

Il n'utilise pas Sharp et n'a pas été raccordé artificiellement au limiteur des
photos de commande. Le Server Action emploie encore `Promise.all(arrayBuffer)` :
jusqu'à 25 MiB compressés selon le contrat peuvent être simultanément
matérialisés, et la validation des 5 MiB intervient après lecture. Une limite de
transport pré-allocation distincte n'est pas prouvée par cet audit. Ce point
reste à observer/mesurer en Phase 2 ; le contrat Phase 5E n'est pas modifié.

## Diagnostics mémoire

Niveau : **`EVENT_BASED`**. Il n'existe ni timer périodique, ni historique de
snapshots, ni tableau de mesures conservé, ni endpoint/UI Admin.

- variable unique : `MEMORY_DIAGNOSTICS_ENABLED` ;
- absence ou toute valeur autre que la chaîne exacte `true` : OFF ;
- activation réservée à un environnement local contrôlé pendant cette phase ;
- métriques en MiB : `rssMiB`, `heapTotalMiB`, `heapUsedMiB`, `externalMiB`,
  `arrayBuffersMiB` ;
- compteurs : `activeUploads`, `activeImageTransforms`,
  `activeS3Operations` ;
- événements : avant/après upload et avant/après chaque opération publique de
  stockage (`put`, `head`, `get`, `delete`, création d'URL signée) ;
- les appels SDK internes, chaque part multipart, les compensations/cleanups et
  l'appel de signature incrémentent silencieusement le compteur S3 sans émettre
  un événement par sous-opération ; les transformations internes suivent la
  même règle afin d'éviter un log par image ;
- durée et outcome sont ajoutés à la fin de l'opération ;
- une erreur du lecteur mémoire ou du logger n'affecte jamais l'opération
  métier ;
- aucune erreur AWS complète n'est sérialisée.

Exemple entièrement factice, sans PII, objet, bucket, URL ni credential :

```json
{"event":"memory.upload.after","rssMiB":256.4,"heapTotalMiB":96,"heapUsedMiB":71.2,"externalMiB":42.8,"arrayBuffersMiB":18.5,"activeUploads":0,"activeImageTransforms":0,"activeS3Operations":0,"outcome":"completed","durationMs":842.117}
```

Le schéma fermé n'accepte aucun contexte libre. Il ne peut donc pas joindre
email, numéro de commande, user/session ID, nom de fichier, object key, bucket,
signed URL, authorization header ou secret. Après succès comme après erreur,
les trois compteurs doivent revenir à zéro.

Les tests multipart et d'échec verrouillent cette granularité : exactement un
snapshot `memory.storage.before` et un snapshot `memory.storage.after` par
opération publique, avec `activeS3Operations=0` à la fin, même si plusieurs
requêtes SDK ont été nécessaires en interne.

Pour un `GET`, la paire mesure actuellement l'obtention de la réponse provider
et du stream, pas la consommation complète ultérieure du body par l'appelant.
Cette portée est documentée afin de ne pas présenter le compteur comme une
mesure de durée de téléchargement. Un suivi jusqu'à fermeture/cancel du stream
reste une amélioration Phase 2 si les lectures longues deviennent un signal.

## Mesures locales reproductibles

Commande exécutée localement, sans réseau ni DB :

```text
NODE_OPTIONS=--conditions=react-server node --import tsx scripts/test-memory-hardening.ts
```

Rapport exact : `/private/tmp/lnxbeats-memory-hardening-report.json`, résultat
`pass`, Node v24.18.0 arm64, profil par défaut, durée 7 656,690 ms. Ce fichier
local en mode 0600 n'est pas destiné au commit et n'est pas une preuve Railway.

| Étape | RSS MiB | heapUsed MiB | external MiB | arrayBuffers MiB |
| --- | ---: | ---: | ---: | ---: |
| startup | 128,0 | 23,7 | 7,9 | 4,3 |
| warmup | 393,5 | 24,2 | 8,3 | 4,3 |
| peak | 1 469,0 | 55,5 | 9,0 | 4,8 |
| post | 1 468,9 | 37,3 | 9,0 | 4,4 |
| post-idle (1,5 s) | 1 468,9 | 37,4 | 9,0 | 4,4 |

Résultats complémentaires :

- healthcheck : 500/500 statuts 200 et contrats valides, zéro création de
  client ; latence totale 12,968 ms, p50 0,018 ms, p95 0,035 ms, maximum
  1,402 ms ;
- comparaison dans le même process, 1 000 résolutions : modèle historique non
  caché = 1 000 storages/clients, 22,751 ms et delta RSS retenu +41,1 MiB ;
  modèle caché = 1 storage/client, 3,382 ms et delta RSS retenu +1,6 MiB ;
- 100 opérations de stockage mock ont conservé le même client ;
- uploads : 8 cycles, 16 images réussies, 572 896 octets normalisés ; durée
  totale 5 877,539 ms, p50 730,571 ms, p95/max 762,860 ms ;
- fixture progressive proche de la limite : 11 900 × 3 361 = 39 995 900
  pixels, ratio 0,999898 de la limite ; concurrence Sharp maximale 1 ;
- RSS en fin de cycle : 648,4 ; 714,9 ; 831,1 ; 949,8 ; 1 065,3 ;
  1 180,7 ; 1 350,9 ; 1 468,9 MiB, soit +820,5 MiB (+126,5 %) ;
- état final : semaphore `active=0`, `queued=0` et les trois compteurs à zéro ;
- diagnostics : 216 événements, zéro violation de schéma ; pics compteurs
  upload/Sharp/S3 = 1/1/2 ;
- garde-fous : zéro requête réseau, zéro DB, zéro port ouvert, zéro appel
  `global.gc()`, zéro artefact temporaire restant.

Limites de toute mesure locale : durée courte, pas de trafic réel, pas de R2,
pas de heap snapshot, RSS dépendant de l'allocator et pas de reproduction
complète du cache Next/Image Production. La mémoire du filesystem/cache et le
RSS du process sont deux métriques différentes. Le RSS local élevé après la
fixture Sharp ne baisse presque pas pendant 1,5 seconde. Classification de
tendance : **`SUSPICIOUS_GROWTH`** — les huit fins de cycle augmentent de
façon monotone et reproductible sur cette fenêtre. L'allocator natif peut
conserver des pages sans fuite applicative, donc ce signal n'en prouve pas une,
mais il interdit de présenter la Phase 1 comme une preuve que l'incident
Railway est résolu. Une observation prolongée supplémentaire n'a pas été
lancée afin de ne pas pousser la machine locale au-delà d'une consommation
raisonnable.

## Audit Next/Image et routes média

Version auditée : Next.js 16.3.0 et Sharp 0.35.3.

### Sources et cardinalité

- les covers Catalogue sont exposées sous `/media/catalog/<asset UUID>` ;
- les visuels Boutique sont exposés sous `/media/boutique/<asset UUID>` ;
- aucun timestamp, token, signature, query variable ou cache-buster n'est
  injecté dans ces sources `next/image` ;
- un remplacement de cover crée un nouvel Asset UUID, donc une nouvelle URL
  stable au lieu de muter le contenu sous une URL immutable ;
- le manifeste canonique Git contient 10 covers sur 14 médias ; la cardinalité
  réelle de la DB Production n'a pas été lue dans cette phase ;
- les images statiques Hero/icônes ont également des chemins stables.

### Espace de variantes

`next.config.ts` configure uniquement les formats `image/avif` et
`image/webp`. Avec Next.js 16.3.0, l'absence d'override conserve :

- quality autorisée : 75 ;
- `deviceSizes` : 640, 750, 828, 1080, 1200, 1920, 2048, 3840 ;
- `imageSizes` : 32, 48, 64, 96, 128, 256, 384 ;
- TTL minimum de cache interne : 14 400 secondes.

Les principaux composants fournissent des props `sizes` bornées (`100vw`,
largeurs mobiles puis 48/33/22vw, et 430px pour le Jukebox). Aucune variété de
quality pilotée par la requête n'a été trouvée. Deux formats et plusieurs
largeurs restent susceptibles de produire plusieurs variantes par Asset, mais
aucune cardinalité explosive n'est démontrée par le code. Les images Boutique
des listes, du détail et du panier, ainsi que quelques previews Admin, ne
fournissent pas encore de prop `sizes` explicite : Next peut alors raisonner
comme pour une largeur viewport et servir une variante plus large que leur
colonne réelle. C'est un candidat d'optimisation ciblée, pas une preuve de la
cause de l'incident.

### Routes sources

Les routes cover/produit lisent actuellement la source complète en mémoire,
avec une borne de 12 MiB, puis la rendent à Next/Image. Elles renvoient
`Content-Type: image/webp`, `Content-Length`, `Cache-Control: public,
max-age=31536000, immutable`, `Last-Modified` et un `ETag` si checksum connu.
Le conditionnel ETag répond 304. La couche Next/Image peut ensuite employer
Sharp/libvips et sa mémoire native ; `heapUsed` seul ne suffit pas pour la
mesurer.

Le cache local `.next/cache/images` était vide avant le benchmark/build de
cette branche. Cela ne renseigne ni la taille ni le hit rate Production. Aucun
log de route ne relie Next/Image à l'incident Railway.

**Verdict Next/Image : `OBSERVE`.** Les URLs sont stables, la qualité unique et
les headers source favorables. Il n'existe pas de preuve justifiant une
désactivation, `unoptimized`, un CDN ou un refactor en Phase 1. Passer à
`PHASE2_OPTIMIZATION_RECOMMENDED` seulement si l'observation montre des cache
miss/variantes nombreux, une croissance forte du cache, des pics Sharp
corrélés ou une charge crawler/image élevée.

## Findings Prisma pour Phase 2

Aucune pagination n'est modifiée ici. Les candidats prioritaires, avant hausse
de cardinalité, sont :

- `listAdminShopOrders()` : toutes les ShopOrders sans `take`/cursor ;
- `listMemberOrders()` et `listMemberShopOrders()` : historique complet et
  relations incluses ;
- `listRightsRequestsForActor()` : dossiers et relations complets, notamment
  pour l'Admin ;
- `listMemberShopReturns()` : historique SAV complet ;
- `shopReadinessDashboard()` et les sélections de maintenance : alertes/cas
  ouverts sans pagination explicite.

Les listes Admin commandes/membres/catalogue/droits sont déjà bornées à 200,
les notifications à 100 et leurs événements imbriqués à 8. Le catalogue public
reste aujourd'hui de faible cardinalité connue, mais devra être paginé avant
croissance importante. Priorité Phase 2 : mesure de taille/latence, puis cursor
pagination déterministe ; aucune optimisation spéculative dans cette phase.

## PDF buffering pour Phase 2

`lib/billing/pdf.ts` et `lib/rights/pdf.ts` construisent un `PDFDocument`,
accumulent tous ses chunks dans un tableau puis retournent
`Buffer.concat(chunks)`. Le document complet existe donc en mémoire avant
réponse ou persistance. Les routes de facture génèrent un document à la fois et
les entrées métier sont bornées, mais aucun profil de pic RSS représentatif
n'est disponible.

Statut : `OUT_OF_SCOPE`. Mesurer d'abord taille des PDF, concurrence réelle,
RSS/external/arrayBuffers et temps de génération. Ne pas remplacer PDFKit ni
réécrire les factures/avoirs/contrats sans preuve.

## Observation future après promotion autorisée

Commencer en **Mode A** : diagnostics applicatifs OFF, métriques Railway et
healthcheck HTTP seulement. Un **Mode B**, opt-in temporaire via
`MEMORY_DIAGNOSTICS_ENABLED=true`, est techniquement préparé sans PII mais ne
pourra être activé en Production qu'après décision et autorisation humaines
séparées. Aucune activation ni surveillance distante n'est créée par cette
Phase 1.

| Point | Contrôles |
| --- | --- |
| T0 | RAM, CPU, restart count, HTTP health |
| T+15 min | RAM, CPU, restart count, HTTP health |
| T+1 h | RAM, CPU, restart count, HTTP health |
| T+6 h | RAM, CPU, restart count, HTTP health |
| T+12 h | RAM, CPU, restart count, HTTP health |
| T+24 h | RAM, CPU, restart count, HTTP health ; décider si un audit Phase 2 est requis |
| T+48 h | RAM, CPU, restart count, HTTP health ; décision de dimensionnement |

Critères de succès, sans seuil RAM unique prématuré : aucun restart, absence de
croissance monotone vers 2 Go, plateau durable avec marge, CPU normal, aucune
hausse anormale de `external`/`arrayBuffers` et aucune régression upload.
N'envisager un retour sous 2 Go qu'après ces données ; ne pas réduire
immédiatement la limite.

## Déclencheurs d'une Phase 2

Une Phase 2 devient justifiée si l'un des signaux suivants apparaît :

- mémoire encore croissante après futur déploiement ;
- `external` ou `arrayBuffers` augmentent sans retour au plateau ;
- nouveau restart ou nouvelle limite atteinte ;
- pics corrélés aux uploads malgré le limiteur ;
- matérialisation `formData()` encore problématique ;
- cache miss/variantes Next/Image élevés, cache fortement croissant ou charge
  crawler/image corrélée ;
- agent/sockets/middleware SDK S3 persistent malgré la réutilisation ;
- listes Prisma ou génération PDF deviennent mesurablement dominantes.

Les pistes correspondantes sont : multipart streaming/tempfile, observation
Next/Image ciblée, audit sockets/SDK sans custom agent prématuré, pagination
cursor et streaming PDF après mesure.

## Séquence avant toute future promotion

1. revue humaine du rapport et des mesures ;
2. consolidation locale autorisée ;
3. push de branche autorisé ;
4. fast-forward de `develop` si validé ;
5. décision du périmètre V1.1.0 ;
6. preflight Production ;
7. backup ;
8. migrations uniquement si la V1.1.0 générale en exige — Memory Hardening
   lui-même n'en ajoute aucune ;
9. déploiement contrôlé séparément autorisé ;
10. observation T0 à T+48 h.

Aucune étape de cette séquence n'est exécutée par la Phase 1.
