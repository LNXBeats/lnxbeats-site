# Livraison privée des commandes

## Portée V0.7.5

La livraison prolonge le paiement confirmé sans devenir une seconde source de vérité. PostgreSQL conserve l’état métier, les relations entre commande et fichiers, l’historique et la notification. R2 ne contient que les objets privés.

Le workflow actif réutilise les statuts historiques :

`PAYMENT_CONFIRMED → RECEIVED → REVIEWING → ACCEPTED → IN_PROGRESS → FIRST_VERSION_READY → FINALIZING → DELIVERED`

Les variantes `SUBMITTED` et `REVISION_REQUESTED` restent prises en charge par la matrice fermée existante. L’Admin ne fournit jamais un statut libre : chaque transition est résolue côté serveur et partage le verrou de commande utilisé par les paiements.

Toute progression de production exige une `Payment` confirmée (`SUCCEEDED` ou `PARTIALLY_REFUNDED`). Une commande impayée ne peut ni recevoir un livrable ni progresser dans la production. `DELIVERED` ne peut pas revenir vers un ancien état.

## Audit de l’existant

Avant V0.7.5, l’application disposait déjà de :

- la machine d’état et des `OrderEvent` atomiques ;
- un upload Admin MP3/WAV de 200 Mo vers R2 privé ;
- un lien `OrderAsset` de rôle `DELIVERY` ;
- une publication séparée par le passage à `DELIVERED` ;
- un téléchargement authentifié avec ownership, `HEAD`, `Range` et `private, no-store` ;
- une notification idempotente `CUSTOMER_DELIVERY_READY` ;
- une durée de disponibilité de six mois.

Le modèle était cependant limité par un index à un seul master, l’interface n’affichait qu’un fichier et les téléchargements R2 étaient relayés par l’application. V0.7.5 étend ce socle au lieu de créer un second domaine `Delivery`.

## Dépôt et publication

Une commande accepte au maximum huit livrables, chacun limité à 200 Mo. Les formats autorisés sont :

- MP3 (`audio/mpeg`) ;
- WAV (`audio/wav`) ;
- FLAC (`audio/flac`) ;
- ZIP (`application/zip`) ;
- PDF (`application/pdf`) ;
- JPEG (`image/jpeg`) ;
- PNG (`image/png`).

`application/octet-stream`, HTML, SVG et les formats exécutables sont refusés. Le navigateur effectue uniquement une vérification ergonomique. Le serveur impose la taille, normalise le nom original, compare extension/MIME/signature, décode entièrement l’audio avec FFmpeg et décode les images avec Sharp. Les clés R2 sont générées côté serveur sous `orders/<uuid>/deliveries/<uuid>.<extension>` ; un chemin client n’est jamais accepté.

Le corps multipart HTTP est compté et écrit dans un fichier temporaire privé (`0600`) sans charger le master complet en mémoire. FFmpeg valide ensuite ce fichier par son chemin. L’envoi R2 rouvre une source indépendante : le décodage ne consomme donc jamais le flux destiné au stockage.

Les `Readable` Node utilisent l’uploader multipart officiel AWS avec des parts de 8 Mio et une concurrence de deux, soit environ 16 Mio de parts en vol. Chaque part est rejouable par le SDK en cas d’erreur transitoire ; aucun `fs.ReadStream` brut n’est remis à un `PutObject` non rejouable. Pour Cloudflare R2, le client désactive explicitement `Expect: 100-continue`, que le fournisseur ne prend pas en charge, tout en conservant le multipart S3 compatible. Les calculs de checksum automatiques optionnels du SDK restent limités à `WHEN_REQUIRED` afin de ne pas ajouter de header R2 non demandé. Un fichier plus petit qu’une part reste borné. La limite serveur et UI demeure exactement 200 Mio, sans buffer de 200 Mio dans le processus.

L’upload écrit d’abord l’objet privé puis crée l’`Asset` et l’`OrderAsset` dans une transaction verrouillée. Une erreur R2 avant création du multipart ne déclenche aucune suppression ; après obtention d’un `UploadId`, elle déclenche un abort explicite. Si la réponse de finalisation est ambiguë et que le multipart n’existe déjà plus, la clé finale opaque est supprimée par compensation. Les diagnostics distinguent ainsi `none`, `multipart_aborted`, `multipart_incomplete`, `final_object_deleted` et `final_object_possible`. Une erreur PostgreSQL après l’écriture déclenche la suppression compensatoire de l’objet final. Le fichier temporaire n’est supprimé qu’après la fin de l’orchestration. Le fichier reste invisible au MEMBER tant que la commande n’est pas `DELIVERED`.

Les échecs d’upload produisent un diagnostic serveur structuré et minimisé : étape, classe/code applicatif, numéro de commande validé, taille, MIME autorisé, code/statut fournisseur assainis et résultat du nettoyage. Les messages bruts, clés objet, endpoints, credentials, cookies et contenus de fichier ne sont jamais journalisés.

Avant publication, l’Admin peut retirer un fichier. Le lien et l’asset sont retirés sous verrou puis l’objet privé est supprimé ; un échec de suppression laisse seulement un objet privé orphelin à réconcilier et ne rend jamais le fichier accessible. Après publication, aucune suppression silencieuse n’est autorisée.

Le clic de publication vérifie dans une même transaction :

1. la transition `FINALIZING → DELIVERED` ;
2. un paiement confirmé ;
3. un à huit livrables privés aux types autorisés ;
4. la mise à jour de l’Order et de ses dates ;
5. un `OrderEvent` client ;
6. une seule notification outbox `CUSTOMER_DELIVERY_READY`.

Une répétition ou deux clics concurrents retournent l’état déjà livré sans créer un second événement ni une seconde notification.

## Accès et stockage

Les objets sont toujours dans le bucket privé configuré par l’infrastructure média existante. Aucune nouvelle variable n’est requise.

La route applicative vérifie successivement la session, l’état actif, le rôle, l’ownership de l’Order, son état `DELIVERED`, la fenêtre de téléchargement et la relation exacte `OrderAsset`. Un autre MEMBER, un visiteur, un UUID d’une autre Order ou une clé arbitraire obtient un refus sans révéler l’existence du fichier. L’ADMIN conserve un accès de contrôle.

Pour R2, un `GET` autorisé reçoit une redirection vers une URL signée HTTPS valable dix minutes. Cette URL n’est ni persistée, ni journalisée, ni envoyée par e-mail. `HEAD` reste traité par l’application. Le backend local de test et le repli contrôlé conservent le streaming `Range`. Toutes les réponses applicatives utilisent `Cache-Control: private, no-store` et `X-Content-Type-Options: nosniff`.

## Notification

La publication ne contacte pas directement Resend. Elle crée l’outbox dans la transaction métier. Le dispatcher séparé respecte les flags client et les retries existants. Une panne ou une désactivation de l’e-mail n’annule jamais la livraison et n’empêche jamais le téléchargement.

## Évolutions hors V0.7.5

Une nouvelle version après livraison nécessitera une entité ou un numéro de version explicite, une nouvelle période de disponibilité et une politique de conservation. V0.7.5 rend la livraison publiée immuable et n’invente pas de remplacement postérieur.

Une analyse antivirus asynchrone et une reprise navigateur inter-requêtes pourront être ajoutées avant une montée importante de volume. Le multipart R2 serveur est déjà borné et rejouable par part ; il ne transforme toutefois pas une requête navigateur interrompue en upload résumable. Les fichiers actuels sont bornés, non exécutables et servis en téléchargement privé avec `nosniff`.

## QA locale

`npm run test:delivery` couvre notamment un WAV réel fragmenté d’environ 60 Mio, le décodage puis la réouverture de la source, les formats/signatures, les limites, les fermetures prématurées, la compensation, l’IDOR, les headers et l’URL signée. `npm run test:media` couvre le multipart S3/R2 de 60 Mio, l’abandon des parts et la suppression compensatoire sans appel externe. `npm run test:delivery:runtime` exige une base Prisma Dev jetable exacte `lnx-studio-v075-test` sur le port TCP attribué 51254 et des notifications client/propriétaire désactivées. Il ne contacte ni R2, ni Stripe, ni Resend : ses assets sont des métadonnées fictives et son nettoyage cible uniquement ses UUID déterministes.
