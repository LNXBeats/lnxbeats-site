# Premium V2 — état réel et garde-fous

## Cartographie initiale (03/10/2026)

Base vérifiée après fetch : `ee7fb063a306348378fb43faf5be420b38047791`, tree
`d473daff4f19a52f153584a95520d5582b945f19`. Worktree historique laissé intact.
Branche isolée : `feature/premium-site-overhaul-v2`.

| Sujet | État | Décision / preuve |
| --- | --- | --- |
| Photos / Format | DONE | Release exacte Web/worker SUCCESS ; recette iPhone humaine acquise ; ne pas reconstruire. |
| Créations / pipeline média | DONE | Code et services dédiés présents ; ne pas reconstruire. |
| Cockpit Admin V2, masquage/archives, références privées | DONE | Surfaces et guards existants ; préserver intégralement. |
| Historique Prisma | DONE | 39 migrations réelles, checksums concordants, aucune Rights V4. |
| Mémoire Web Linux | PARTIAL | Courbe 24 h : moyenne 1,292 Go, max 1,502 Go ; après release 0,187 Go. Cause de la croissance non démontrée. |
| Patch mémoire staged | PARTIAL | Préservé. Source staged pointe sur ancien SHA 2a9dca7 ; application groupée interdite. Décision dédiée nécessaire. |
| Fiche commande premium | TODO | Données/guards présents, mais actions et livrables après beaucoup d'informations secondaires sur mobile. |
| Public, navigation, players | PARTIAL | Accueil réel inspecté ; identité et visuel Ludovic/chien conservés ; campagne responsive à compléter. |
| SEO technique | PARTIAL | Canonical, sitemap, JSON-LD existants ; vérifier les réponses réelles, ne pas reconstruire. |
| Google Search Console / Analytics | BLOCKED | Session authentifiée non disponible à ce stade ; indépendant du code. |
| Dons | BLOCKED | Aucun module existant repéré ; activation suspendue à la qualification juridique/fiscale/provider, sans bloquer les autres phases. |
| Release V2 | TODO | Aucun gate de la release Photos ne remplace les preuves d'un futur candidat modifié. |

## Isolation et mesures initiales

Preview existante vérifiée : base `postgres-n5dc.railway.internal`, buckets dédiés
v33-preview-private/public, paiements/emails/notifications désactivés. Aucun contenu
Preview ne doit être importé en Production.

Sonde ponctuelle Linux en lecture seule : next-server RSS 242328 KiB,
RssAnon 153220 KiB ; npm RSS 67452 KiB ; aucun processus FFmpeg.
Le processus ponctuel de diagnostic a sa propre mémoire et ne doit pas être
confondu avec le Web. cgroup.current 208613376 octets, anon 196182016,
file 389120 ; compteurs OOM à zéro. Les RSS additionnées ne représentent pas
une mesure dédupliquée du conteneur.

Ce relevé ne fournit PAS heapUsed/external du serveur Next et ne suffit pas
à diagnostiquer une fuite. Ne pas créditer une réduction au redémarrage seul.

## Contraintes de présentation

Les huit images du pack ont été inspectées. Leurs références de commandes,
prix, dates, délais et clients ne sont pas des fixtures ni des faits métier.
Ne pas inventer un délai, un format audio ou un prix depuis ces images.
Les alertes financières, contractuelles et notifications ouvertes restent visibles.
Les photos privées et leurs routes authentifiées restent inchangées.

## Gates avant promotion

QA synthétique, tests complets, dépendances, nouveau backup chiffré et restore
réel, migration sur copie si nécessaire, smoke Admin authentifié, état staged
explicite. Aucun nouveau paiement, remboursement ou email QA réel.

## Bilan consolidé des preuves

### Git et périmètre du candidat

Commit applicatif : `680dba86e08d1b89a15b75e6955554993b0ae1cb`.
Tree applicatif : `638d8e64b198bceccfcbc84811e67ec1070a9d4b`.
Quatre fichiers applicatifs/tests, 185 insertions et 31 suppressions :
`app/admin/admin.css`, `app/admin/commandes/[orderNumber]/page.tsx`,
`lib/admin/order-detail-presentation.ts`, `tests/admin/order-detail-presentation.test.ts`.
La documentation de ce rapport est un changement séparé, sans effet runtime.
Push normal de la feature uniquement. Main et develop n'ont pas été poussés.
Le commit abandonné bf2e669 n'a pas été repris ; aucun Rights V4 ni migration ajoutée.

### Matrice finale

| Sujet | État final | Preuve / réserve |
| --- | --- | --- |
| Photos / Format, Créations, cockpit, masquage / archives | DONE | Fonctionnalités conservées, aucune reconstruction. |
| Détail Admin premium | DONE | Candidat testé localement puis déployé en Preview ; actions et livrables remontés, résumé et navigation compacte. |
| Obligations ouvertes | DONE | Fixture locale REFUSED + paiement synthétique réussi : alerte visible, volet finance ouvert, masquage interdit. |
| Public / mobile / players | DONE pour les parcours observés | Pages existantes conservées ; lecture audio et vidéo réelle, responsive vérifié ; aucune nouvelle certification iPhone physique. |
| SEO technique www | DONE pour les contrôles décrits | 29 URL sitemap HTTP 200, XML et JSON-LD valides, canonicals www, noindex privé/404, aliases 308. |
| Google Search Console | DONE pour l'audit en lecture | Propriété domaine accessible ; sitemap réussi, 29 pages découvertes. L'indexation complète reste une décision Google. |
| Analytics | BLOCKED | Aucun tag de mesure confirmé dans le code/HTML, aucune propriété exploitable identifiée ; ne pas inventer un identifiant ni installer un suivi sans configuration/consentement cohérents. |
| Dons | BLOCKED, désactivé | Pas de décision fiscale/juridique/provider validée ; aucun flux financier ajouté ou activé. Indépendant des autres lots. |
| Backup / restore / migrations | DONE | Nouvelle archive chiffrée, restauration réelle complète, 39 migrations/checksums concordants, zéro migration nouvelle. |
| Mémoire Web | PARTIAL | Mesure Linux bornée réelle ; le pic historique Production n'est pas reproduit, cause exacte et amélioration avant/après non démontrées. |
| Patch mémoire staged | PARTIAL | Décision explicite de préserver sans appliquer : ancien SHA figé dangereux pour une release groupée. Pas présenté comme résolu/supprimé. |
| Promotion Production Premium V2 | BLOCKED | Gate mémoire non concluante ; pas de correction spéculative ni de promotion présentée comme entièrement validée. |

### Admin : conservation des règles et des données

Les composants d'actions et de livraison existants sont déplacés, pas remplacés.
Le nouveau helper ne fait que déterminer l'ouverture des sections et les alertes ;
il n'autorise aucune transition, remboursement ou opération de visibilité.
Les informations financières incertaines restent ouvertes par prudence.
Consentement incomplet : preuve manquante affichée sans clic supplémentaire.
Mots à inclure, éléments à éviter, prononciation et notes enregistrées sont rendus
comme texte React échappé ; aucune donnée inventée ni nouvelle sauvegarde métier.
Les routes privées Voir/Télécharger, les contrôles Auth, rattachement et guards restent identiques.

### Mémoire Linux — observations, pas extrapolation

Production, lecture seule à 15:33:56Z : next-server RSS 236,6 Mio ; après les
consultations et le trafic normal, à 16:40:34Z : 451,4 Mio, dont RssAnon 368,2 Mio.
cgroup à ce second relevé : 496,2 Mio, anon 405,7 Mio, file 75,4 Mio ; OOM = 0.
Les deux relevés ne contrôlent pas le trafic concurrent : aucune causalité ne peut
être attribuée à une route particulière. Ni heap Production ni snapshot sensible capturé.

Sonde séparée dans le conteneur Preview, même build ee7fb063, écoute loopback
uniquement, connexion DB forcée READ ONLY. Fenêtre 16:05:23Z–16:36:23Z :
30 minutes de sonde puis arrêt du processus de test à 31 minutes.
900 GET (800 HTTP 200, 100 redirections compte), zéro échec ; 20 requêtes
d'images supplémentaires, zéro échec. Pas de requêtes Admin authentifiées dans
ce scénario mémoire ; cette limite est importante.

| Étape | RSS Mio | heapUsed Mio | external Mio | arrayBuffers Mio |
| --- | ---: | ---: | ---: | ---: |
| démarrage | 43,0 | 3,9 | 1,5 | 0,1 |
| 1 minute | 164,8 | 48,0 | 4,0 | 0,1 |
| 5 minutes | 272,2 | 89,7 | 15,4 | 2,8 |
| 10 minutes | 290,3 | 90,5 | 14,7 | 2,0 |
| 15 minutes | 291,8 | 94,0 | 15,0 | 2,3 |
| 20 minutes | 274,3 | 89,2 | 13,7 | 1,1 |
| 25 minutes | 271,8 | 87,4 | 13,7 | 1,1 |

PDFKit, crypto-js, jpeg-exif, ffmpeg-static et sharp apparaissent dans le cache
des modules après les requêtes ; aucun processus FFmpeg n'a été observé.
Leur chargement ne démontre pas qu'ils causent le pic de 1,5 Go.
Les compteurs de pools du preload n'instrumentent pas les bundles Prisma Next :
les zéros de la sortie brute signifient NON INSTRUMENTÉ, pas « zéro pool ».
Arrêt automatique et disparition des processus vérifiés ; le seul dossier
temporaire appartenant à la sonde a été supprimé après collecte de ses preuves.
Une première connexion SSH interrompue a été abandonnée/nettoyée et n'est pas
comptabilisée comme une mesure complète.

Conclusion : plateau puis baisse dans ce scénario ; pas de preuve d'une fuite JS
continue, ni d'un bénéfice à changer Prisma, caches, limites ou fréquence de restart.
Il manque une observation du processus Web réel couvrant les chemins authentifiés
et l'activité images avec heap/external/cgroup corrélés. Le lot ne revendique donc
aucun gain mémoire avant/après et ne promeut aucune optimisation arbitraire.

### SEO et Google

HTML HTTP complet analysé (pas seulement le head). Pages principales HTTP 200,
title/description/canonical/OG/Twitter présents et cohérents sur l'échantillon.
JSON-LD parseable : WebSite/Person, MusicRecording, Product/Offer, BreadcrumbList,
CreativeWork/VideoObject sur les deux créations publiques.
Sitemap : 29 URL (7 pages, 18 projets, 2 produits, 2 créations), toutes HTTP 200.
Aucune URL Railway/privée dans le sitemap ; feed Merchant exclu. XML sitemap/feed valide.
Les deux aliases Railway conservent chemin/query avec 308 vers www.
URL inexistante 404 + noindex ; /admin et /compte redirigent anonymement vers connexion.
L'apex sans www reste inaccessible depuis le client HTTP utilisé (TLS/réseau) :
ce n'est pas présenté comme une redirection PASS et aucune modification DNS/TLS faite.

Search Console, session humaine existante : propriété sc-domain:lnxbeats.fr.
Sitemap soumis www : « Opération effectuée », dernière lecture 29/09/2026,
29 pages découvertes, 0 vidéo dans ce rapport sitemap (distinct du JSON-LD réel).
Couverture, mise à jour 21/09/2026 : 23 URL non indexées, dont 2 noindex,
2 redirections et 19 détectées mais non indexées. Données Google anciennes :
ne pas confondre découverte, crawl et indexation. Aucune soumission/modification effectuée.

### QA, tests et sécurité

Standard npm ci PASS ; canonique : 1294 tests, 1293 PASS, 0 FAIL,
1 SKIP préexistant (+6 tests de présentation par rapport à la base).
Lint, TypeScript, build Production, Prisma format/validate/generate,
npm ls --all et git diff --check PASS. Format Prisma : aucun changement.
Audit npm Production : 0. Audit complet : les mêmes 5 HIGH dev-only,
comparées structurellement au rapport de la release Photos ; aucune major forcée.
Scan du diff : aucune clé/token/URL signée, aucun .env, binaire ou fixture trackée.
Suites Auth/Admin/Orders/Payments/Billing/Shop/Notifications/Security/Rights/SEO
incluses dans la canonique. Aucun nouveau paiement ou email réel.

Captures synthétiques locales : 360/375/390/430/768/1024 et contrôle DOM 1440/1920.
Pas d'overflow observé ; navigation interne supérieure à 44 px.
Limite de capture : les screenshots du navigateur à très grande largeur sont
recadrés par la surface d'affichage ; ne pas les qualifier de capture plein écran 1920.
Public principal capturé à 390 px, visuels Ludovic/chien et DistroKid conservés.
Lecture réelle Discographie, audio Créations puis vidéo : lecture fonctionnelle,
audio mis en pause lors du passage vidéo ; sélection seule sans autoplay.
La recette physique iPhone Photos acquise reste PASS ; aucun nouvel essai physique
de cette nouvelle mise en page n'est prétendu.

### Backup et migrations

Snapshot Production : 03/10/2026 18:19:33 Europe/Paris.
PostgreSQL 18.6, taille DB logique 21 526 207 octets.
Archive age : 918 855 octets ; clé récupérable séparément dans le Trousseau.
SHA-256 : `7172e307d3a6d7ce40ca7fc9600bad63789dc2abeb456972b6859e8e54d8e8d7`.
Dossier privé : `/Users/lnxbeats/LNX_BACKUPS/premium-v2-preproduction/20261003T161931Z`.
Restore PostgreSQL 18 isolé sans --create : PASS, zéro erreur, ACL/ownership conservés.
78 tables, 373 index, 1161 contraintes, 12 triggers, 7 séquences ; compteurs de
toutes les tables, schémas, extensions et 39 migrations concordants.
Locale Linux en_US.utf8 versus macOS en_US.UTF-8 : aucune collation métier
explicite ni index non-default ; UTF8 conservé, différence de nom documentée.
Migrate status local à jour, zéro nouvelle migration ; aucune Rights V4.
Cluster de restore et plaintext supprimés, archives historiques conservées.
README_RECOVERY, SHA256SUMS et validation privée conservés avec l'archive.

### Preview, Production et staged

Preview Web : déploiement `1b0a1c88-a445-4cc4-9f8f-06da5d149272`, SUCCESS,
SHA applicatif 680dba86. Source Preview seule passée à feature/premium-site-overhaul-v2.
Pré-déploiement : 39 migrations, No pending migrations to apply.
Authentification normale du compte QA existant, liste et fiches de fixtures
avec/sans référence privée : PASS ; panneaux et navigation interne fonctionnels.
Aucune fixture ajoutée à la DB Preview par ce lot, seulement une session normale.
Le cas financier bloqué a été créé exclusivement dans PostgreSQL local QA.

Production inchangée : Web f8ea1984-192c-413a-9724-8802888c3a83,
worker 18e0612a-d40c-4a56-a2c7-cc12d6287bac, SHA ee7fb063, SUCCESS.
PostgreSQL, notifications, shop-maintenance SUCCESS, non reconfigurés/non redéployés.
Admin Production consulté avec session existante, fiche 000017 accessible,
1 référence privée et actions Voir/Télécharger présentes. Aucune action métier,
aucun téléchargement automatisé de la photo, aucune donnée Production modifiée.
Le flux de logs runtime renvoyé pour la fenêtre finale est vide : ce n'est pas
une preuve exhaustive d'absence d'erreur ; les GET et états des services sont les preuves directes.

Patch 6e55d95b-e01d-4b13-b1a0-80a5e013118e : STAGED conservé.
Le résumé environnement compte 4 opérations ; l'UI détaille 6 différences :
source repo/branche/SHA et trois variables diagnostics. La « resource.update »
est une mise à jour de ressource service, pas une preuve d'augmentation RAM.
La limite active reste 2 000 000 000 octets. Source staged épinglée sur 2a9dca7.
Valeurs des trois variables masquées dans l'UI ; aucun contournement pour les révéler.
Comparaison des configurations et métadonnées staged initiales/finales identique.
Décision : ne pas appliquer ce patch dangereux avec une autre release ; ne pas
le supprimer sans sauvegarde complète de ses valeurs. Résolution technique encore PARTIAL.

### Réserves et décision

Le candidat Admin est testable en Preview mais la mission globale ne peut pas
être annoncée entièrement terminée : diagnostic mémoire exact / amélioration
mesurée et résolution complète du staged restent non démontrés.
Pas de push main ni déploiement Production de ce lot. Pas de rollback nécessaire.
Référence de rollback future : ee7fb063, schéma identique (aucune migration).
Avant une future promotion : clore le diagnostic sans inventer de gain, trancher
explicitement le staged, revalider refs et fraîcheur de la sauvegarde ; conserver
le pre-deploy runtime existant. Ne pas refaire les fonctionnalités DONE.
