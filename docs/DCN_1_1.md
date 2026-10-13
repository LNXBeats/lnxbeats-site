# DCN‑1.1 — livraison locale du 13 octobre 2026

## Résultat et limites, avant les preuves

Le parcours **local QA** est livré : paiement confirmé par preuve serveur simulée → contrat/facture PDF immuables → réception explicite QA → bibliothèque et fichiers acquis exacts → notifications capturées → remboursement confirmé simulé/avoir/litige ciblé. PostgreSQL, FFmpeg, stockage disque, ZIP et HTTP sont réels. **Les paiements prestataires ne le sont pas.**

La démo persistante DCN‑1.0, ses anciens masters/acquisitions et les autres domaines ont été conservés. Une migration additive locale et un nouveau membre QA ont été ajoutés sans remettre à zéro les données. La démo navigateur est servie uniquement sur `127.0.0.1:3140` en développement ; le build optimisé a été validé séparément. Worker local et galerie restent disponibles.

Statut global : **PARTIAL avant commercialisation réelle**, pas prêt Production. Recettes Stripe TEST/PayPal SANDBOX/R2 et Safari physique non exécutées ; prix, licence, CGV, fiscalité et certains choix de fourniture restent à approuver. Le transport local est capture-only ; aucune délivrance client ni preuve juridique LIVE inventée. Les cas de remboursement externe non attribuable restent en revue, sans interface de réallocation manuelle complète.

## Base, commits et intégrité Git

- Worktree isolé : `/Users/lnxbeats/.codex/worktrees/dcn-1-0/lnxbeats-site-v1`.
- Branche conservée : `feature/dcn-1-0`, initialement propre.
- SHA initial vérifié : `2216fbfa88375a8dbc08063b908ee5d6dea1a583`.
- Tree initial : `ed41642ebd43a781e0c4829da951c0aab62fccaa`.
- Commit d’implémentation locale : **`eb3c56e92e065b017247a465359eca5c0cf684c3`** ; tree **`a5986af49a97dd1330223358ec8f759e0ab32e1d`**. 61 fichiers, 1 985 insertions / 106 suppressions.
- Correctif final d’états et de rôle : **`6b53ec9f79ca7b06f51bc4c359f5a0896b2a1641`**, tree **`f87dd9823ba604860daff2b0b1e0bdb24dca7455`** : 9 fichiers, 56 insertions / 13 suppressions. C’est le **code applicatif final testé**, incluant la fermeture normale de la seule session du harness HTTP.
- La restitution documentaire et le filtre de la galerie constituent le dernier commit ; ils ne modifient pas ce code applicatif testé. SHA/tree de la livraison complète : `git rev-parse HEAD` / `git rev-parse 'HEAD^{tree}'`, également enregistrés dans **`output/dcn-1-1/release.json`** par la galerie après commit.
- Remote `main` relu via **`git ls-remote origin refs/heads/main`** : `7e7b8861d6b114a02e06ea69a9a7baf39693d83a`, inchangé pendant cette mission. Aucune mutation du remote.
- Le `main` local ancien reste `47ba720a1d3bba072a365fd90be7961d0ab000c8`. Aucun déplacement ni réparation de références historiques ; absence préexistante d’`origin/main` locale non corrigée hors périmètre.
- Worktree historique Desktop et autres branches laissés intacts. Pas de push, merge, force, reset, déploiement ou mutation Railway/Production.

## Architecture réellement retenue

### Confirmation, documents et mails

Le paiement ne débloque pas seul la fourniture. La transaction de rapprochement réserve une seule facture/confirmation et leurs snapshots, les droits source et l’outbox. Le générateur PDF reprend après panne avec le **même** numéro et le **même** snapshot. Contrat et facture détaillent les titres/versions acquis, indépendamment du catalogue courant.

Les numéros sont dédiés **DCN‑QA**, sous séquences TEST distinctes des factures historiques. Aucun faux `Payment`/`Order` physique n’est créé pour satisfaire une FK de l’ancienne facturation. Les helpers fiables d’identité facturante, numérotation/empreinte et PDF sont réemployés ; l’option PDF numérique n’altère pas le rendu historique par défaut.

Les PDF privés revalident le **rôle courant en base**, pas un ancien rôle Actor/Session ; UUID invalide et rôle Admin forgé/rétrogradé sont refusés dans les tests. Les libellés bibliothèque/confirmation ne disent pas « payé » pour un état pending, ni « accès retiré » lorsque la réduction conserve des droits. Une réduction intégrale avant réception laisse cette réception obligatoire, sans fermer définitivement les droits encore actifs ; une résolution ne les restaure pas.

Le propriétaire reçoit d’abord le PDF privé du contrat. `HEAD`, un email en queue/capturé et une URL de retour ne valent pas réception. Le serveur journalise sa fin de dispatch ; l’utilisateur reconnaît ensuite explicitement la réception, avec hash/document/propriétaire revalidés. Ce **parcours QA proposé** n’est pas une validation juridique du support durable ni une preuve de lecture ou stockage sur l’appareil. Les textes montrés et snapshotés des deux consentements anticipés sont communs, distincts et non précochés.

Après réception reconnue, les fichiers deviennent accessibles et l’email `ACCESS_READY` est réservé, sans circularité avec le mail de confirmation. Les anciens achats 1.0 dépourvus de `contractSnapshot` restent accessibles : aucun nouveau consentement ou justificatif historique n’est fabriqué par l’upgrade.

Quatre templates HTML/texte : `CONTRACT_AVAILABLE`, `ACCESS_READY`, `REFUND_CONFIRMED`, `INCIDENT`. Destinataire fictif, liens vers le compte authentifié, pas de master/token dans le mail. Outbox persistante, business key unique, lease, cinq tentatives bornées dans 23 h. Fichier capture déterministe créé exclusivement : crash/retry réutilise sa même preuve. **Capturé ≠ envoyé ≠ délivré ≠ lu.** L’interface et les traces ne prétendent pas à un email exactement une fois ni à une délivrance Resend réelle.

### Finance et reprise

Les événements DCN signés sont journalisés dans une inbox durable **avant** leur acquittement comme pris en charge. Payload minimal et body hash, clé prestataire/événement unique, collision conservée en revue. Après crash, un lease expiré est repris ; les événements anciens/rejoués déclenchent une lecture fraîche, pas un simple tri temporel.

Sessions Stripe asynchrones et capture PayPal pending ne sont pas `PAID`. Marchand, TEST, référence, montant entier et EUR doivent concorder. Réconciliation persistante et protection inter-prestataires DCN‑1.0 sont conservées. Une seconde **capture distincte** est un incident durable, pas un webhook doublon ; aucune seconde facture normale n’est émise. Un autre achat couvrant les mêmes pistes ne disparaît pas silencieusement.

Les remboursements Admin réservent atomiquement le montant d’origine encore disponible et les lignes, avec clé stable et confirmation explicite. `REQUESTED/PENDING/SUCCEEDED/FAILED/REQUIRES_REVIEW` sont distincts. Une réponse inconnue est relue sans nouvelle restitution aveugle. Un avoir n’est réservé qu’après succès vérifié. La réduction conserve les droits ; une résolution retire seulement la source ciblée. Un remboursement externe partiel d’album non attribuable garde sa preuve financière et passe en revue, sans choisir arbitrairement des pistes.

Un litige ouvert suspend l’achat concerné, pas toute la bibliothèque. Une issue favorable ne réactive pas un droit remboursé/révoqué ; une issue négative/reversal vise sa source. Les cas concurrents remboursement/litige restent clos ou en revue. Les adaptateurs TEST de remboursement/lecture/litige sont écrits avec les clients Stripe/PayPal du dépôt ; leurs payloads réels restent à recetter.

Le préflight, checkout réel, clients financiers, réconciliation distante et vérification réseau des webhooks nécessitent l’autorisation QA dédiée. La présence de clés ou d’une signature valide n’accorde pas cette autorisation. Le flag de nouveaux achats est **indépendant** et actuellement `false`. DCN LIVE demeure impossible dans ce candidat, y compris par CHECK SQL et contrôles de contexte ; aucun flag global Boutique/Commander/Soutien n’est utilisé pour fermer DCN.

### Médias, ZIP et téléchargement

Masters et composition acquis sont figés. Le ZIP est un job durable, construit dans un processus séparé puis stocké privé, jamais dans la route Next ni le webhook. Snapshot, tailles, SHA‑256 des sources, CRC/noms sûrs et checksum d’archive sont vérifiés avant `READY`. Ni fichier partiel ni version catalogue courante ne remplace le contenu acheté.

Slots PostgreSQL globaux atomiques : **2 audio / 1 ZIP**. Token de lease et expiration revalidés au commit ; un worker obsolète ne peut publier. Chaque média/ZIP lourd est exécuté dans un nouveau processus enfant, sans accumulation du heap au fil des jobs. Les PDF et captures mail sont traités par le superviseur local. La réconciliation financière distante est un CLI explicite, non un service distant activé automatiquement.

Bornes locales : 512 Mio/master, 30 min/audio, extrait MP3 physiquement ≤60 s et <3 Mio, stderr borné, timeout FFmpeg/ZIP, 1 thread FFmpeg, allocation native individuelle 64 Mio, surveillance RSS FFmpeg 256 Mio, garde RSS Node par job 512 Mio, réserve temporaire 1 Gio et préflight disque. Ce sont des **gardes applicatifs mesurés**, pas un quota OS/cgroup ni une nouvelle capacité Railway.

La conversion Node→Web utilise une queue en **octets**, pas en nombre de chunks. Aucun album complet n’est bufferisé dans Next. La gateway privée revalide compte actif/vérifié, propriétaire et droit applicable sur chaque GET/HEAD/Range. Cookies HttpOnly/SameSite, ticket 30 min/32 utilisations pour les gros fichiers ; HEAD ne consomme pas un téléchargement. Réponses privées `no-store`, `nosniff`, `noindex`, filename UTF‑8 sûr et range unique borné. Aucun lien master présigné de possession n’est distribué.

Les audits distinguent autorisé/démarré/source transférée/interrompu. La recette a révélé la course fin de stream/annulation Next : un seul événement terminal est désormais émis. La preuve reste une **fin de stream serveur**, jamais la preuve qu’un client a conservé le fichier. Un fichier déjà reçu ne peut être rappelé ; un transfert déjà engagé n’est pas promis instantanément révocable.

Nettoyage : base locale jetable `lnx_dcn11_*`, run ID, upload IDs explicites, TTL, dry-run/listing exact, refus d’un traitement actif ou d’un master référencé. Seuls un upload abandonné QA et des copies temporaires de workers crashés ont été retirés dans les tests ; originals/acquisitions/documents/audits restent conservés. Aucun sweep global ni suppression distante R2.

## Migrations, backup et ACL locaux

La migration 1.0 `20261013010000_digital_music_commerce` reste inchangée. Nouvelle migration **additive locale** `20261013020000_digital_fulfillment` : huit tables (documents, fulfillment, notifications, refunds, disputes, inbox, slots, archives), quelques colonnes et contraintes DCN, séquences QA. Ni migration historique réécrite ni rollback destructif.

Deux chemins réellement testés :

- Base locale vide `lnx_dcn11_schema_20261013_1650` : **50 migrations Prisma deploy PASS**.
- Backup synthétique antérieur 1.0 → `pg_restore` réel dans une base distincte → SQL 1.1 → fingerprints de **96 tables originales** inchangés, nouveaux champs historiques NULL préservés ; canaris masters/acquisitions/états/facturation inchangés.

Dernier run retenu : `ba4ec7d9-ba8f-4607-9c45-0deda17cf3f4`, cible `lnx_dcn11_ba4ec7d9ba8f4607`. Backup QA vérifié : SHA‑256 **`02293a7b1af59c7ea4817b3b57a339913bbf58291ff20ee362d3731bc732bc94`**, copie `/private/tmp/lnx-dcn-11-runtime-37Rvw8/dcn-1-0-local.dump`. Données fictives uniquement ; droits de fichier privés. **Pas de sauvegarde ni restauration Production** dans cette mission.

Le provisionneur DCN versionné/idempotent a été testé avec deux rôles runtime réels, non propriétaires et non superusers, `dcn_runtime_a`/`dcn_runtime_b`, sans rôle rotatif en dur dans le provisionnement. Tests positifs et refus effectifs par colonne/table : pas de DELETE/TRUNCATE/DDL, pas de privilège sur la séquence des factures historiques, événements append-only ; reprovisionnement et rotation. Les ACL non DCN sont restées inchangées.

Le diff Prisma global sort 2 sur **23 écarts non DCN préexistants** (noms d’index/relations historiques, dont un index Notifications). Leur comparaison avant/après est identique ; **aucun nouveau drift Digital**. Ils n’ont pas été « réparés » hors périmètre. La démo persistante créée historiquement par SQL brut n’a pas de registre Prisma complet : ne pas lancer aveuglément `migrate deploy` dessus.

## Tests retenus — niveaux de preuve séparés

Les compteurs se recouvrent : **ne pas additionner** les tests DCN, la canonique, les runs intermédiaires et les groupes runtime.

| Niveau / commande | Résultat réel | Environnement / preuve |
| --- | --- | --- |
| `npm ci` standard | PASS — 603 packages, lockfile inchangé | Worktree local, aucune option `--ignore-scripts` ni upgrade forcé |
| Canonique `NODE_OPTIONS=--conditions=react-server node --import tsx --test --test-reporter=spec --test-reporter-destination=/private/tmp/lnx-dcn11-canonical-final.log tests/**/*.test.ts` | **1 530 PASS / 0 FAIL / 1 SKIP**, 1 531 tests | Code final d’implémentation ; **38 tests DCN inclus**, pas ajoutés au total |
| `npm run dcn:1.1:test:runtime` | **22 groupes PASS** | PostgreSQL 17.11, rôles réels, FFmpeg/processus/disk/ZIP réels ; finance doubles uniquement ; `.private/dcn-1-1-runtime-results.json` |
| `npm run dcn:1.1:test:http` | PASS, aussi après build optimisé | Login QA normal, HEAD 200/Range 206/GET 200, WAV entier 19 315 902 octets/SHA‑256, anonyme 404, pas d’audits contradictoires |
| Prisma format/validate/generate | PASS | Modèle et génération locale ; nouvelles tables/constraints validées |
| `npm run lint`, `npm run typecheck` | PASS, 0 erreur/warning lint | Après installation standard et dernier code |
| `npm run build` | PASS | Next 16.3.8 webpack, TS, pages, optimisation et traces terminées |
| `npm run dcn:worker:build` | PASS | Graphe TS dédié DCN, pas de génération statique Next pour le worker |
| `npm run creations:media-worker:build` | PASS | Worker historique/préflight TS, Prisma, FFmpeg H.264/AAC ; pas de DB/R2 distant |
| `npm ls --all --json` | PASS, aucun `problems` | `/private/tmp/lnx-dcn11-dependency-tree.json` |
| `git diff --check`, scan du delta et `.next/static` | PASS | Motifs reconnaissables, aucun hit ; revue server-only/endpoint/secret ; pas garantie universelle d’absence de défaut |
| Navigateurs | PASS pour interfaces/player/consentements QA et login normal | Navigateur **Codex intégré**, captures desktop 1124×960, mobile 390×844 ; mesures DOM jusqu’à 1440 ; pas Safari/iPhone |
| Stripe TEST / PayPal SANDBOX authentiques | **NOT_RUN / autorisation et config manquantes** | Aucun compte/paiement/capture/refund/webhook fournisseur réellement interrogé |
| R2 distant | **NOT_RUN** | Local disk uniquement, aucun bucket consulté/modifié |
| Safari macOS / iPhone physique | **NOT_RUN** | Procédure et cible HTTPS privée à autoriser ; pas émulation déclarée physique |

SKIP préexistant conservé : « Admin V2 generates and follows draft slugs without moving published URLs ». Aucun nouveau SKIP ajouté. Les alias `dcn:test:runtime` et `dcn:test:regression` utilisent maintenant la recette 1.1 ; les scripts historiques 1.0 restent conservés, leurs 28 anciens groupes ne sont pas recomptés comme nouvellement exécutés.

Les 22 groupes couvrent backup/upgrade/ACL, 12 médias, confirmation préalable, panne PDF/reprise, outbox concurrente, crash ZIP/reprise, HEAD/Range/IDOR, plafond de restitution concurrent, timeout et reprise GET, résolution ciblée, remboursement externe partiel, litige/race, inbox/restart/replay, doubles captures, slots/fencing, crash audio réel, upload abandonné/nettoyage et canaris des autres domaines. Les preuves financières sont **simulées**, même lorsque la DB et les écritures comptables QA sont réelles.

Un avertissement `pg` sur des requêtes concurrentes d’un client du harness subsiste, sans échec ; aucun upgrade pg automatique. Les premiers essais ont révélé des comparateurs de fingerprint incluant des nouvelles colonnes NULL, un namespace de fixture refusé et un harness regroupant trop de copies dans un processus : tests et isolation ont été corrigés, pas les garde-fous affaiblis. Les runs jetables ont été conservés, sans nettoyage global.

## Mesures réellement obtenues

Benchmark : **12 WAV**, 180–191 s/piste, **589 000 824 octets (561,7 Mio)**. Extraits découpés et décodés, chacun ≤60 s. Le run complet mesuré après préparation/restore dure **18 824 ms**, pas une observation Production ou un soak prolongé.

| Mesure | Valeur / portée |
| --- | --- |
| RSS maximum d’un processus worker Node échantillonné | 398 688 256 octets ≈380,2 Mio ; cap applicatif local 512 Mio |
| FFmpeg RSS maximum échantillonné | 17 809 408 octets ≈17,0 Mio ; WAV synthétiques seulement |
| Copie temporaire propre au job ZIP observée | 589 002 604 octets ≈561,7 Mio ; intégrité vérifiée avec `unzip -t` |
| RSS du harness global | 502 726 656 octets ≈479,4 Mio ; **pas le Web ni un worker individuel** |
| `external` / `arrayBuffers` du harness | 106 525 254 / 86 287 411 octets |
| RSS agrégé des enfants / pic simultané observé des slots / disque temporaire agrégé | **NOT_MEASURED** ; borne de slots démontrée séparément par concurrence atomique réelle |
| Web optimisé local, WAV HTTP de 18,4 Mio | Avant 343 228 416 / pic 396 836 864 / après 348 258 304 octets, 17 samples via `ps` ; observation courte seulement |
| Web heap/external/arrayBuffers / mémoire Railway / soak | **NOT_MEASURED / NOT_RUN** |

L’architecture streamée et ce contrôle court ne prouvent pas l’absence de toute fuite. Le plafond single-file 512 Mio, disque réellement plein/ENOSPC, corruption complexe de codecs, crash au milieu du décodage natif FFmpeg, extraction Finder/Windows/Safari, reprise lente/expiration et soak long restent à compléter. Un crash OS audio après copie de source et un crash OS ZIP en cours d’écriture ont bien été exécutés puis repris. Aucun changement de plan, limite ou configuration mémoire Railway.

## Les cinq HIGH : examen explicite, pas « dev-only donc OK »

Audit du **13/10/2026**, base d’avis npm : `npm audit --omit=dev --json` = **0 vulnérabilité runtime**, HIGH/CRITICAL 0. Ce n’est **pas** un audit complet du site Production.

`npm audit --json` = **5 HIGH / 0 CRITICAL**, une même cause propagée dans l’arbre : [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), CVE‑2026‑93687, épuisement de pile lors de motifs d’accolades imbriquées non fiables. Version braces publiée consultée : 3.0.3 ; pas de version corrigée publiée identifiée. Le mainteneur conteste le scénario, ce qui n’équivaut pas à un correctif démontré.

| Paquet signalé | Version / chemin | Exposition et décision |
| --- | --- | --- |
| `eslint-config-next` | 16.3.8, dépendance dev directe | Lint/build/CI : configuration et motifs de fichiers non fiables à exclure. Pas de downgrade cassant automatique. |
| `@next/eslint-plugin-next` | 16.3.8 ← eslint-config-next | Propagation via fast-glob ; même surface d’outillage, pas cinq failles distinctes. |
| `fast-glob` | 3.3.1 ← plugin Next | Des motifs imbriqués contrôlés par une entrée non fiable pourraient atteindre micromatch ; usage de `eslint .` sur dépôt contrôlé seulement. |
| `micromatch` | 4.0.8 ← fast-glob | Transmet/compile les motifs vers braces ; pas de glob fourni par une requête DCN. |
| `braces` | 3.0.3 ← micromatch | Racine de l’avis ; pas de patch officiel publié constaté. Maintenir suivi et isolation des jobs CI non fiables. |

Pas de `npm audit fix --force`, fork non officiel, suppression d’alerte, upgrade majeur ni modification du lockfile. L’arbre runtime audité n’embarque pas ces cinq paquets ; recherche des noms dans les bundles serveur locaux sans hit, sans prétendre que ce grep est une preuve universelle. Les dangers d’un PR/configuration de build non fiables restent réels : **risque ouvert à traiter avant LIVE**, pas une acceptation par le seul label dev.

L’installation standard émet également deux avis de maintenance (`jpeg-exif`, `crypto-js`) et six avertissements `allow-scripts`. Aucun droit/scripts globaux n’a été élargi ; les générations Prisma et préflights workers/FFmpeg réellement exécutés ont réussi. La reproductibilité sur le futur runtime Linux reste une gate séparée.

## Écrans et exemples visibles

Index unique local : **http://127.0.0.1:3141/**. Fichier hors Git : `output/dcn-1-1/index.html`. Il affiche les JPEG réels, les exemples QA et le SHA de la livraison. Les anciens assemblages pleine page du bridge présentant une surimpression de header ne servent pas de preuve visuelle finale ; les captures finales utilisent les viewports réels et le bon défilement.

Captures finales dans `/Users/lnxbeats/.codex/visualizations/2026/08/09/019fe533-ab67-7791-9ed5-4a0c521aef42/dcn-1-1` : album et tracklist, panier, checkout/consentements, confirmation, bibliothèque et téléchargements, Admin import/contrôles, achat/documents/refund et registre, état financier à vérifier. **Desktop réellement enregistré 1124×960 / mobile 390×844**, données QA exclusivement. Le bridge tronquait les fichiers issus du viewport virtuel 1440 à 1124 pixels : ces images ne sont pas présentées comme preuves finales. La galerie conserve seulement les captures complètes aux dimensions vérifiées. Code applicatif identique au commit final testé cité plus haut.

Mesures checkout à **375/390/430/768/1440 px** : largeur document égale au viewport, aucun débordement horizontal, actions ≥46,78 px, deux consentements non cochés. Le titre commence sous le header, dont la hauteur est prise en compte par le shell DCN ; aucune modification du header/V4 global. Admin détail : pas de débordement aux mêmes cinq tailles. `ui-measurements.json` conserve ces relevés DOM ; ils ne constituent pas une preuve Safari physique.

Liens de la démo :

- Album : http://127.0.0.1:3140/album/dcn-local-test
- Panier : http://127.0.0.1:3140/musique/panier
- Checkout fermé aux prestataires non configurés : http://127.0.0.1:3140/musique/checkout
- Bibliothèque privée : http://127.0.0.1:3140/compte/musique
- Achat QA / confirmation : http://127.0.0.1:3140/musique/confirmation/1fe5a514-64d9-42e4-80b1-0fc75eb32502
- Admin : http://127.0.0.1:3140/admin/musique
- Détail : http://127.0.0.1:3140/admin/musique/achats/1fe5a514-64d9-42e4-80b1-0fc75eb32502

Les identifiants QA sont conservés uniquement dans le fichier privé local, pas dans ce rapport. La session Admin préparée facilite la revue ; la bibliothèque nécessite le compte acquéreur QA. Le navigateur intégré a initié des téléchargements mais son bridge les a interrompus : **pas de PASS de stockage dans l’appareil**. La recette HTTP complète, distincte, passe ; le téléchargement Safari physique reste à faire.

Exemples hors Git dans `output/pdf` : `dcn-qa-facture.pdf`, `dcn-qa-avoir.pdf`, `dcn-qa-confirmation.pdf`, et HTML/texte `dcn-qa-email-contract_available`, `dcn-qa-email-access_ready`, `dcn-qa-email-refund_confirmed`. PDF rendus avec Poppler et visuellement contrôlés : une page A4 chacun, lisibles, sans montant/produit physique fictif. Leur cas QA de 12 pistes à 9,99 EUR est distinct du cas de démo à 5,99 EUR : **aucun prix définitif**. L’email d’avoir reprend le montant réellement confirmé par le double, pas le total de la commande.

## Lancer / conserver / restaurer localement

Profil, clés Auth QA, racines médias et base persistante ont été préservés. Ne pas relancer le bootstrap 1.0 comme nettoyage ni supprimer les anciens masters. Pour cette copie déjà préparée :

```sh
cd /Users/lnxbeats/.codex/worktrees/dcn-1-0/lnxbeats-site-v1
npm run dcn:local:web
```

Dans deux autres terminaux, même dossier : `npm run dcn:local:worker` et `npm run dcn:local:gallery`. Le build optimisé et `dcn:local:built` ont passé le smoke HTTP, mais le profil actuel ne satisfait pas l’exception HTTP de cookies sécurisés en mode optimisé : une vraie revue navigateur optimisée nécessite une cible HTTPS privée approuvée. Aucun bypass Auth n’a été ajouté ; le mode développement habituel reste le mode de revue locale. L’Auth QA et tous les services sont sur loopback ; aucun secret prestataire n’est transmis au lanceur. Ne pas lancer une seconde instance sur les mêmes ports.

Si le cluster PostgreSQL dédié est arrêté, identifier d’abord l’instance et vérifier son état, puis démarrer **la seule** racine existante `/private/tmp/lnx-dcn-postgres.UwLq6m/data` avec `pg_ctl`. Ne pas initialiser/effacer un nouveau cluster sur cette racine. Port 55473 ; base `lnx_dcn_runtime_test`. Les espaces `/private/tmp` ne sont pas une sauvegarde longue durée : une conservation hors tmp devra être décidée sans copier de credentials.

La recette `npm run dcn:1.1:test:runtime` automatise la copie du backup QA pré-upgrade vérifié, création d’une base nommée par run ID, `pg_restore --exit-on-error --no-owner --no-acl`, application SQL DCN‑1.1, canaris et ACL. Elle n’écrase pas la source/démo et garde la cible pour preuve. Les détails sont dans `.private/dcn-preview-upgrade-proof.json` / `.private/dcn-1-1-runtime-results.json`, qui ne doivent jamais être ajoutés à Git. Aucun restore distant ni reset de données réelles.

## Périmètre du delta et réemploi partagé

Dans `git show --stat eb3c56e` et `git show --stat 6b53ec9`, les inventaires exacts sont disponibles. Principalement :

- `lib/digital/{commerce,domain,http,providers,library,media-worker,runtime-privileges,zip}` : extensions ciblées de 1.0.
- Nouveaux modules DCN `{documents,fulfillment-policy,notifications,finance,finance-policy,finance-providers,inbox,archive-worker,audio,work-slots,cleanup,download-policy,stream-integrity,test-preflight}`.
- Routes DCN propriétaires/Admin/webhooks et pages bibliothèque/confirmation/Admin achat ; composants documents, remboursement, consentements et CSS module.
- Schéma/migration additive DCN, scripts runtime/HTTP/préflight, superviseur/worker-once/local-review, tests DCN et graphe worker dédié.
- Partagés : export du helper vendeur ; option PDF numérique conservant les defaults ; queue locale média en octets ; policy clés d’archives privées ; deux lectures optionnelles capture/dispute du client PayPal, sans modification de ses commandes financières historiques.

Aucun fichier Google/CMP/Ads, configuration Next mémoire/Railway, prix/stock/Boutique, checkout Commander, soutien, DistroKid ou Rights V4 modifié. Aucun master/capture client utilisé. Les régressions utiles sont incluses dans la canonique et les canaris ; ce n’est pas une nouvelle QA visuelle générale du site Production.

## Étapes restantes et autorisation groupée

Lire **DCN_1_1_DECISIONS.md** : tarifs/licence, album partiellement acquis, futures versions, droits œuvre/master, preuve durable, CGV et TVA/pays ; tout reste distingué entre protection technique, proposé et validé.

Lire **DCN_1_1_EXTERNAL_RECIPES.md** : une seule demande groupée à fournir avant tout appel, avec noms des sandbox/application/buckets/hôte HTTPS et périmètre exact. Valeurs uniquement dans un mécanisme privé sécurisé. Préflight sans réseau déjà prêt. Aucun tunnel public ni accès R2/Stripe/PayPal n’a été improvisé.

Travaux/recettes encore nécessaires avant LIVE : validation commerciale/juridique/fiscale, formalisation des CGV et parcours différé, transport/delivery documentaire validés, réallocation Admin des remboursements externes ambigus, pagination des registres/bibliothèque (bornes actuelles explicites à revoir), cadence opérationnelle de réconciliation indépendante des jobs lourds, recettes prestataires authentiques, R2/Safari, Linux/soak/disk-full et traitement du risque d’outillage HIGH. Pas de promesse « prêt Production » pour un module fermé.

Une future promotion exigerait une **nouvelle autorisation** : fetch/réconciliation avec main réel, revue des migrations Production, sauvegarde/restore/upgrade/ACL sur cible autorisée, tests impactés, validation des gates LIVE et déploiement exact Web/worker. **Aucune de ces mutations distantes n’a été exécutée ici.**

## Appels externes effectivement effectués

Uniquement lectures de documentation publique (Stripe via CLI docs, PayPal, R2, Légifrance, avis GitHub), registre npm (`ci`, audit, versions/arbre) et `git ls-remote` en lecture. Les demandes de documentation ne sont pas des recettes API compte/paiement. Aucun connecteur Railway/Google/Stripe/PayPal de compte, aucun OAuth prestataire, checkout/capture/refund distant, R2 distant ou email réel. Navigateur et HTTP de recette : loopback seulement.

## Verdict

Socle et commerce QA local : **PASS avec réserves explicites**. Migrations/ACL/versionnement/flux financiers simulés/workers/private HTTP/PDF/captures : **PASS dans les environnements ci-dessus**. Prestataires réels et stockage distant : **NOT_RUN/BLOCKED par l’autorisation et configuration manquantes**. Safari physique, CGV/fiscalité/choix commerciaux et préparation opérationnelle LIVE : **PARTIAL/à valider**.

`MAIN_PUSH = NO` · `MAIN_MERGE = NO` · `DEPLOYMENT = NO` · `RAILWAY_MUTATION = NO` · `PRODUCTION_MUTATION = NO` · `LIVE_PAYMENT = NO` · `LIVE_REFUND = NO` · `REAL_CLIENT_EMAIL = NO` · `READY_FOR_PRODUCTION = NO`.
