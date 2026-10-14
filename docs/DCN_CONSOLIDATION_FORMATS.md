# DCN consolidation — formats et versions privées

## Livré localement

- Une nouvelle source **WAV** privée et versionnée produit un **MP3 complet privé** réel avec FFmpeg/libmp3lame, ainsi qu’un extrait public autonome de 60 secondes maximum.
- MP3 CBR **320 kbit/s** par défaut ; `DCN_MP3_BITRATE_KBPS` accepte seulement 192, 256 ou 320. Cela ne crée aucun supplément ni tarif réel.
- Les nouvelles sélections commerciales figent les identités WAV/MP3 et les formats dans leur snapshot. Les téléchargements propriétaires et les ZIP lisent ce snapshot, jamais le dernier master du catalogue.
- Chaque album acquis dispose de deux jobs et deux objets distincts : **ZIP WAV** et **ZIP MP3**. Les noms des entrées restent stables, ordonnés et assainis ; les sources sont vérifiées par SHA-256 pendant le streaming de l’archive.
- La bibliothèque propose WAV/MP3 individuellement et les deux ZIP. Les routes privées recalculent compte actif/vérifié, propriétaire, droits et réception contractuelle. Les objets complets ne sont jamais publics, ni leurs clés présentes dans les données client.
- L’Admin indique l’état MP3 et importe des sources WAV. Le prix, les droits et la publication restent indépendants de l’upload.

## Conservation et limites explicites

La migration `20261015010000_digital_formats` ne réécrit aucun master, snapshot, facture ni acquisition historique. Les anciens achats sans snapshot de formats restent au **format original**. Un octroi MP3 rétroactif nécessite une livraison additive auditable liée au master exact : il n’est pas simulé par une mutation du snapshot historique dans ce lot. Les sources historiques FLAC/MP3 ne sont pas renommées fictivement WAV.

Le probe réellement exécuté est le parseur et le décodage complet **FFmpeg borné**, pas FFprobe : aucun binaire FFprobe n’était disponible dans l’environnement local contrôlé. Codec, bitrate, durée et décodage réel sont testés. La qualification FFprobe explicite du dossier demeure à compléter si elle est maintenue comme exigence stricte ; aucun téléchargement/install externe n’a été effectué.

Les garde-fous existants restent : deux jobs audio, un ZIP, leases persistantes, reprise après arrêt, limites RSS Node/FFmpeg, threads limités, disque réservé et répertoires par job. Le MP3 complet est plafonné à 96 Mio et écrit/transféré en flux ; aucune lecture intégrale du master ou du MP3 en mémoire. Seul l’extrait public borné à 3 Mio peut être tamponné. Sources de 512 Mio et 30 minutes maximum ; ZIP32 limité, sinon téléchargement individuel.

Le nettoyage exécuté ne vise que les deux répertoires temporaires des nouveaux crash-tests, après dry-run nominatif et absence de lease active. Aucun média acquis, objet R2, document ou fichier historique n’a été supprimé.

## Migration et rollback

Colonnes MP3 nullable pour conserver les versions historiques ; format d’archive/ticket par défaut WAV pour compatibilité des anciennes lignes. Index `(lineId, format)` pour deux archives. Triggers ciblés empêchent la substitution des identités d’un master et des clés/checksums/métadonnées des assets liés ; les droits éditoriaux restent modifiables.

Le retrait de l’unicité `lineId` seul implique qu’un rollback vers un ancien binaire non conscient des deux ZIP ne doit pas laisser DCN actif. Rollback sûr : fermer le domaine numérique et conserver données/schéma/objets ; revenir seulement à un binaire compatible des formats ou fournir un adaptateur. Ne jamais supprimer les archives MP3 pour recréer l’ancien index unique.

## Contrôles réellement exécutés

Environnement : PostgreSQL **local jetable** `lnx_dcn_consolidation_test`, rôle applicatif non propriétaire, FFmpeg installé, stockage LOCAL ; zéro appel Stripe/PayPal/R2. Les commandes et acquisitions de format utilisées sont des fixtures explicites, pas des confirmations de paiements prestataires.

```sh
NODE_OPTIONS=--conditions=react-server node --import tsx --test tests/digital/formats.test.ts tests/digital/audio-formats.test.ts tests/digital/presentation.test.ts tests/digital/fulfillment.test.ts tests/digital/admin.test.ts
NODE_OPTIONS=--conditions=react-server node --import tsx scripts/test-digital-formats-runtime.ts --audio
NODE_OPTIONS=--conditions=react-server node --import tsx scripts/test-digital-formats-runtime.ts --downloads
NODE_OPTIONS=--conditions=react-server node --import tsx scripts/test-digital-formats-runtime.ts --resilience
```

- Suite ciblée exécutée après intégration courante : **39 PASS, 0 FAIL, 0 SKIP** (inclut le test de préservation contractuelle ajouté en parallèle).
- Preuve PostgreSQL/FFmpeg/stockage : **18 contrôles PASS**, dans `output/dcn-consolidation/formats-runtime.json` ; queue des deux formats concurrente/idempotente, renouvellement de ticket après exhaustion et lecture de bibliothèque historique au format original sans mutation également exécutés.
- 12 WAV et 12 MP3 privés vérifiés ; 12 extraits physiques ; deux ZIP, 12 entrées chacun, hashes vérifiés ; téléchargements propriétaire WAV/MP3/ZIP, autre utilisateur refusé et révocation recalculée.
- Crashs réels des processus audio et ZIP, reprise après expiration des leases, pas de doublon de version/archive ; nouvel import version 2 sans altération des WAV/MP3 acquis version 1.
- Une erreur initiale `INVALID_KEY` a démontré que la politique privée refusait les nouveaux namespaces. Correction minimale : autoriser seulement les clés UUID de MP3 dérivé et les namespaces ZIP WAV/MP3 en privé ; tests interdisent leur accès public et les chemins arbitraires.
- Une première vérification négative a précédé l’application du trigger Asset dans la copie QA ; le checksum du **nouveau fichier synthétique** a été immédiatement restauré depuis ses octets inchangés. Les probes négatifs utilisent désormais des transactions toujours rollbackées. Aucun historique source n’a été touché.
- ESLint des fichiers formats modifiés et `git diff --check` : PASS.

Les preuves prestataires/physiques antérieures restent conservées mais ne valident pas les nouveaux MP3 et deux ZIP à distance. Aucune nouvelle recette externe, capture navigateur physique ou activation commerciale n’est revendiquée ici. Les captures locales consolidées sont produites par le lot d’intégration.
