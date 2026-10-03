# Photos client et format de commande — revue locale

Date : 3 octobre 2026. Base relue après fetch : `2a9dca7330c6f936a049edb817e4d22f3ff280d7`.
Branche isolée : `fix/order-photo-recovery-admin-format`.

## Périmètre et cause

Le signalement Production fourni décrit quatre JPEG de moins de 10 Mio chacun,
envoyés ensemble, puis `Request body exceeded 10MB`. Il n'a pas été nécessaire
de rouvrir une commande ni un média client en Production.

Le code initial envoyait la sélection entière dans un seul `FormData`. Next.js
16.3.4 applique, par défaut, une limite de clone/buffering **par requête** de
10 485 760 octets dans son Proxy. Le contrôle multipart applicatif autorisait
101 Mio : cette limite arrivait trop tard pour empêcher la troncature en amont.
La lecture `formData()` pouvait donc aboutir à une erreur générique 400. De
plus, l'ancien client déposait cette erreur dans l'état global du formulaire,
également affiché à l'étape Compte.

Une reproduction locale du `getCloneableBody` réellement installé confirme
16 777 914 octets multipart en entrée, seulement 10 485 760 clonés, un warning
et un multipart invalide. Avec une seule photo de 10 Mio et la nouvelle borne,
10 486 038 octets sont intégralement clonés et le multipart est valide, sans
warning. Cette preuve de transport utilise des octets synthétiques ; le décodage
JPEG réel est démontré séparément par les tests HTTP du build compilé.

Références confrontées au code Next installé :

- [Proxy client body limit](https://nextjs.org/docs/app/api-reference/config/next-config-js/proxyClientMaxBodySize)
- [Route Handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route)

## Limites et sécurité

| Contrôle | Candidat |
| --- | --- |
| Fichier original individuel | 10 485 760 octets, inclus |
| Enveloppe multipart hors fichiers | 65 536 octets maximum |
| Requête totale / Proxy | 10 551 296 octets maximum |
| Fichiers par requête | Exactement un |
| Références par commande | Dix maximum, revalidées côté serveur |
| Concurrence navigateur | Une photo en cours |

Le serveur compte les octets effectivement reçus (même si `Content-Length`
ment), contrôle la longueur annoncée et les champs multipart, puis conserve
la validation réelle JPEG/PNG/WebP, les dimensions/pixels, le réencodage WebP
et la suppression des métadonnées. Pas de relèvement Server Actions ni de
contournement de Proxy, Auth, propriétaire, consentement ou état éditable.

L'ajout reste append-only. Sous le verrou existant de commande, un checksum du
WebP normalisé est comparé aux références privées **de cette seule commande**.
Deux sources produisant le même WebP ne créent qu'une référence. Une reprise
identique reste possible lorsque les dix places sont déjà occupées. Aucun
hash ou objet de stockage n'est exposé au client. Les positions suivent
`max(position) + 1`, même après un retrait.

Les seules transactions photos spécifient ReadCommitted pour relire un état
frais après attente du verrou. Les autres transactions et règles financières
restent inchangées. En cas de COMMIT ambigu, les clés fraîchement créées sont
relues sous le même verrou avant nettoyage. Une clé persistée n'est jamais
supprimée. Si la DB ne permet pas de lever le doute, le nettoyage échoue fermé
(objet conservé, diagnostic fixe sans identité) ; aucun nettoyage massif ajouté.

## Reprise et photos facultatives

La file indique attente, envoi, traitement, confirmation ou échec. XHR affiche
les octets envoyés/attendus lorsque le navigateur fournit une longueur calculable,
et distingue fin d'envoi et réponse serveur, sans pourcentage fictif. Les succès sont retirés
de la file et leurs gros objets `File` libérés ; seuls leurs noms légers sont
gardés brièvement (dix maximum). Un retry individuel ne renvoie pas les succès.

Après échec réseau, un GET relit l'inventaire. Le fichier dont la confirmation
est ambiguë reste retentable : la déduplication serveur résout cette ambiguïté.
Le premier brouillon créé est immédiatement épinglé dans l'URL avant effacement
de la mémoire du parcours de connexion. Un reload reprend donc son inventaire.
Les fichiers locaux non envoyés ne sont pas persistés entre rechargements ;
l'interface demande explicitement de resélectionner seulement les manquants.

Les erreurs photos sont séparées des erreurs Compte. L'utilisateur peut
réessayer ou choisir **Continuer sans les photos non enregistrées** : cette
action relit l'inventaire et ne fait aucun DELETE. Zéro photo reste autorisé.
Retirer Illustration ne supprime pas les références et ne les rend pas
interdites. Navigation et double soumission sont bloquées pendant l'envoi.

## Format réellement choisi

Commander propose le **format de l'illustration**, pas un choix MP3/WAV ni un
format audio/vidéo de la création. Le WAV est une caractéristique de l'offre.
« Je laisse LNX Beats choisir » désigne la direction musicale, pas le format.

| Formulaire | Validation existante | Persistance / projection | Affichage |
| --- | --- | --- | --- |
| `coverIncluded` | Booléen | `Order.coverIncluded`, sérialisation, projection Admin existantes | Illustration demandée / non demandée |
| `illustrationFormat` | SQUARE, VERTICAL, LANDSCAPE, PORTRAIT, CUSTOM | Colonne enum nullable déjà existante ; aucune migration | Carré 1:1, Vertical 9:16, Paysage 16:9, Portrait 4:5, Autre |
| `illustrationFormatCustom` | Texte borné à 240 caractères ; requis pour un nouveau CUSTOM | Colonne existante, trim et sauvegarde déjà prévus | Précision complète dans récap, liste et haut de fiche |
| `musicalDirection` | Direction existante | Champ existant, inchangé | Reste distinct du format |

Le helper commun rend les choix enregistrés, sans valeur par défaut inventée.
Format absent : « Non précisé à la commande ». Inconnu : « Non reconnu dans
cette commande ». CUSTOM incomplet historique : précision non renseignée.
Une illustration non commandée n'est jamais réactivée ; un ancien choix éventuel
reste dans un détail historique explicitement non applicable. Les données
anciennes, statuts et options ne sont pas réécrits. La liste utilise sa projection
existante : aucune requête par commande / aucun N+1 ajouté.

## Tests et limites de preuve

`scripts/test-order-photo-http.ts` vérifie ses garde-fous avant toute mutation :
PostgreSQL local isolé, cible `-test`, origine localhost dédiée, stockage sous
`/private/tmp`, aucun secret fournisseur, mails et paiements désactivés. Il refuse
les fichiers dotenv du dépôt. Fixtures créées à la volée, jamais importées en
Production ni commitées. Les JPEG volumineux restent réellement décodables ;
des segments COM JPEG valides complètent leur taille exacte.

Le build Next compilé a passé 12 groupes HTTP : quatre JPEG de 4 Mio (16 Mio au
total) ; 9,9 Mio ; 10 Mio exacts avec 10 486 039 octets transportés ; refus du
fichier de 10 Mio + 1 ; erreurs partielles ; retry ; concurrence/quota ; formats
et finalisation ; auth/IDOR ; média privé ; aucune ligne Payment/Invoice/provider
créée. Un test de réponse ignorée après 201 simule l'ambiguïté, pas un crash TCP.
La concurrence est démontrée dans un Next local et par verrous/tests déterministes,
pas dans plusieurs réplicas Railway.

Validation globale : 1 285 PASS, 0 FAIL, 1 SKIP préexistant (1 286 tests).
`npm ci`, ESLint, TypeScript, build Production, Prisma validate/generate,
`npm ls --all` et diff-check réussissent. Les 39 migrations **existantes** ont
été appliquées à une PostgreSQL 18.6 locale neuve ; aucun SQL ni schéma ajouté.

Recette Chromium isolée : **58 contrôles principaux + 28 contrôles du build
final réussis**, 29 captures aux largeurs 390, 430 et 1440 px. Quatre envois
réels de 4 Mio, concurrence observée de un, navigation bloquée pendant l'envoi,
reprise du brouillon et précision CUSTOM conservée. L'échec 501 est injecté ;
la réponse perdue est simulée par interception CDP après un vrai POST/201 et
sa persistance, puis les mêmes identifiants sont retrouvés après retry.
Ces injections ne sont pas présentées comme une panne réseau externe.

Le smoke final confirme une progression monotone issue de 79 événements XHR
réels, un état « traitement » jusqu'à livraison du 201 et aucune duplication
lors du seul POST photo de contrôle. Les cibles Enregistrer, Supprimer,
Réessayer et Continuer sans les photos mesurent au moins 44 px à 390/430 px.
Aucun overflow horizontal ni erreur JavaScript observé. Un récapitulatif
incomplet conserve maintenant son erreur inline après retour à l'étape visée,
sans requête de finalisation. Les cinq formats, les champs historiques absents
et l'absence d'Illustration sont couverts par les tests HTTP/SSR et les vues QA.

Preuves locales (non commitées, données exclusivement synthétiques) :

- Racine : `/private/tmp/lnx-photos-format-qa.WhG3yw`.
- HTTP compilé : `run-a974a71c/http-report.json` (12 groupes).
- Navigateur : `browser-finish-1791029986506/browser-report.json` (58 contrôles).
- Smoke final : `browser-final-smoke-1791030614510/final-smoke-report.json` (28 contrôles).
- Captures et empreintes : `captures/manifest.json` ; archive `LNX_PHOTOS_ADMIN_FORMAT_REVIEW.zip`.
- Suite canonique finale : `logs/canonical-final.log`.

Une mesure ponctuelle locale de RSS Next est d'environ 578 Mio ; ce n'est ni
un pic mesuré ni une preuve de réduction RAM Railway. Le lot borne les envois
mais ne prétend pas optimiser le runtime Linux ou certifier une charge réelle.

Safari réel et iPhone physique ne sont pas prétendus validés. La
commande réelle LNX-2026-000017 n'a pas été consultée ni modifiée par ce lot :
audit Production spécifique NOT_RUN ; état accepté/payé/photo rapporté par le
client, sans nouvelle vérification distante.

## Audit dépendances préexistant

Le lockfile et les versions n'ont pas changé. `npm audit` retourne 9 alertes
(8 high, 1 critical), et `--omit=dev` 3 (2 high, 1 critical). Ce contrôle n'est
donc **pas PASS**. Aucun `npm audit fix` ni upgrade hors périmètre n'est lancé.

L'alerte critique [GHSA-vcvr-r3jv-pc5j](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j)
vise `next/og` ImageResponse recevant des entrées attaquantes. Le seul usage
applicatif trouvé est `app/icon.tsx`, avec contenu et styles constants, sans
entrée externe/SVG. Le chemin d'exploitation décrit n'a pas été trouvé dans
ce code ; cela ne transforme pas l'audit npm en PASS. Une mise à jour contrôlée
des dépendances reste à traiter séparément avant une future décision de release.

## Arrêt avant Production

Fichiers du lot (liste exhaustive, chemins relatifs au dépôt) :

```text
app/admin/admin.css
app/admin/commandes/[orderNumber]/page.tsx
app/admin/commandes/page.tsx
app/api/orders/[orderNumber]/photos/route.ts
app/globals.css
components/admin-order-production-summary.tsx
components/music-order-form.tsx
data/order-photo-upload.ts
docs/ORDER_PHOTOS_AND_ADMIN_FORMAT_REVIEW.md
lib/orders/photo-upload-client.ts
lib/orders/photo-upload-request.ts
lib/orders/production-summary.ts
lib/orders/service.ts
lib/orders/upload.ts
next.config.ts
package.json
scripts/test-order-photo-http.ts
tests/admin/order-format.test.ts
tests/checkout/commander-v084.test.ts
tests/orders/photo-upload-client.test.ts
tests/orders/upload.test.ts
```

Un seul commit local cohérent. Aucun push (main, develop ou feature), aucun
déploiement, aucune migration distante, aucun accès DB/R2 Production, aucun
paiement/remboursement/email ni mutation de commande réelle. Le worktree
historique, les autres travaux et les médias clients sont conservés.
