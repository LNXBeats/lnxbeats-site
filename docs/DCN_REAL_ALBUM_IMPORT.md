# DCN — Préparer et importer les véritables albums

Revue locale du 15 octobre 2026. Base vérifiée : `21a790fe1668ba9b113c439dbe320c792a1c6b88`, branche `feature/dcn-1-0`. Ce guide prépare la saisie ; **aucun véritable album, prix ou droit n’a été importé/validé pendant cette revue**. Aucun accès Production ni appel fournisseur.

## Ce qui fonctionne et niveau de preuve

| Besoin | Mise en œuvre existante | Preuve réutilisée ou contrôle de ce lot |
|---|---|---|
| Création album/single | `/admin/catalogue/nouveau`, type Album / Single / Projet ; création brouillon masqué | Code des formulaires/services relu. La création puis la saisie de 12 pistes en Admin ont été réellement exécutées en DCN-1.2 sur données synthétiques ; pas réexécutées ici. |
| Pistes, titres, ordre | `/admin/catalogue/{slug}` ; ajout des titres un par un, statut Publié / Annoncé / Non listé ; ordre modifiable | Code relu. Le lot de fichiers ne crée pas automatiquement les titres ; il s’associe explicitement à la tracklist existante. |
| Import individuel/groupé | `/admin/musique/{slug}`, sélection d’un ou plusieurs WAV, 50 fichiers sélectionnés maximum, deux traitements actifs maximum | Import navigateur de 12 pistes et reprise d’un fichier rejeté acquis en DCN-1.2 ; moteur actuel WAV/MP3 et reprise après crash acquis dans `output/dcn-consolidation/formats-runtime.json`. Aucun nouvel import réel dans ce lot. |
| Inédit sans plateforme | Distribution « Inédit / non distribué », aucun lien Spotify/Apple Music imposé | Sélection commerciale testée avec un double de dépôt : 12 pistes sans plateforme ni offre individuelle requise pour l’album. Ce n’est pas une autorisation juridique de vendre les œuvres. |
| Extrait par piste | Début en secondes choisi avant import ; fichier public autonome, durée physique ≤60 s | Contrôle audio strict du lot qualité et preuve précédente sur 12 extraits physiques. L’extrait n’est pas une URL publique du master complet. |
| Prix titre et album | Chaque offre possède son prix/version/activation ; prix album indépendant de la somme des pistes | Tests ciblés : album 12 pistes et single conservent leurs prix indépendants. Les montants des fixtures ne sont pas des tarifs de lancement. |
| Disponibilité commerciale | Projet publié et visible + piste publiée + médias valides + droits confirmés + offre active ; pays autorisé et gate paiement restent séparés | Code serveur `catalog.ts` et tests de refus des médias incomplets, droits non confirmés, projet masqué et prix absent. « Prêt TEST » ne signifie jamais « ouvert LIVE ». |
| Contrôle d’exploitation | Confirmation Admin explicite, événement append-only `OFFER_SAVED`, état des droits sur les médias ; aucun upload n’accorde de droit automatiquement | Contrôle technique et traçabilité, pas vérification juridique automatisée. Les contrats, co-auteurs, featurings, reprises, samples et éventuelles exclusivités doivent avoir une preuve valable. |
| WAV + MP3 | Source WAV privée versionnée → MP3 privé dérivé, 320 kbit/s par défaut ; snapshots des deux identités | 12 WAV/12 MP3 et préservation V1 après nouvel import V2 déjà démontrés localement. Les nouvelles règles de validation du lot qualité doivent être prises en compte avant publication. |
| Deux ZIP album | `ZIP WAV` et `ZIP MP3` distincts, générés par le worker sur les identités acquises | Deux archives de 12 entrées et téléchargements natifs vérifiés SHA-256 dans les preuves de consolidation ; pas de nouvelle recette distante. |

Les cinq nouveaux tests de `tests/digital/real-album-admin.test.ts` emploient le vrai sélecteur métier et le vrai service `saveOffer` avec des **doubles de dépôt uniquement**. L’ouverture active est refusée avant toute écriture d’offre, de droits ou d’audit si une preuve manque : ancien encodeur, preuve tronquée, durée discordante, nouvelle piste invalide, projet brouillon ou masqué. Un prix brouillon inactif reste préparable sans média, et douze preuves de métadonnées strictes permettent la préparation de l’offre active. Ces objets sont des doubles de métadonnées, pas une validation physique d’audio. Ces tests ne sont ni une recette Admin navigateur fraîche, ni une mesure de charge, ni un paiement réel. Leur résultat s’ajoute au compte rendu du lot, pas aux anciens chiffres comme s’ils avaient été rejoués.

## Préparer un dossier par album

Créer un répertoire privé sur votre Mac, sans le placer dans Git ni dans les assets publics du site :

```text
Album — fichiers de travail privés/
  01 — Titre exact.wav
  02 — Titre exact.wav
  …
  pochette-originale.jpg
  fiche-de-preparation.txt
  droits-et-autorisations/   (preuves privées, pas de correspondance publiée)
```

La fiche de préparation contient : nom de l’album/single, ordre et titres exacts, choix d’extrait par piste, crédits, statut éditorial, distribution externe éventuelle, prix titre/album **à approuver**, disponibilité souhaitée et références des preuves de droits. Ne pas écrire de mot de passe ou de credential fournisseur dans ce dossier.

Source conseillée : véritable master PCM WAV sans perte, de préférence mono/stéréo pour une écoute musicale classique. Le contrôleur prend également en charge WAV IEEE float 32/64 bits et leurs en-têtes extensibles valides ; il ne confond pas un fichier float avec un PCM entier. La structure RIFF, les tailles déclarées, l’alignement et le nombre d’échantillons sont vérifiés, puis le fichier entier est strictement décodé par FFmpeg. Renommer un MP3 `.wav`, fournir un WAV tronqué ou reconvertir une source avec pertes ne crée pas une qualité sans perte. Le contrôle technique n’atteste ni la qualité artistique du mastering ni la propriété des droits.

Le WAV livré reste le master exact importé. Le MP3 dérivé et l’extrait sont normalisés en **stéréo 44,1 kHz** (MP3 complet 320 kbit/s par défaut, extrait 192 kbit/s), sans réécrire le WAV. Contrôler à l’écoute le rendu de la conversion, en particulier lorsqu’un master comporte plus de deux canaux ; le support technique d’un en-tête n’est pas une promesse de rendu artistique automatique.

### Bornes à vérifier avant sélection

- Source WAV : **512 Mio maximum par fichier**, **30 minutes maximum** ; limite du moteur, pas promesse de traitement de tous les fichiers à ces maxima simultanément.
- Lot navigateur : **50 fichiers maximum** ; association manuelle de chaque fichier à une piste ; deux tâches actives maximum. Pour un album de plus de 50 pistes, préparer plusieurs lots.
- Session multipart : une heure ; pièces de 8 Mio ; URL de partie de durée courte. Conserver le même fichier et les mêmes réglages pour une reprise. Un résultat ambigu ne doit pas être contourné en multipliant les imports.
- MP3 dérivé : privé, 320 kbit/s par défaut, options serveur 192/256/320 seulement, sortie plafonnée à 96 Mio. L’Admin n’oblige pas l’artiste à fournir un second master MP3.
- Extrait : autonome, MP3 public, ≤60 s et ≤3 Mio. Choisir un début strictement avant la fin du master ; les clips courts restent courts.
- ZIP : 100 entrées maximum et taille totale **strictement sous 4 Gio avec en-têtes** (ZIP32). Vérifier le poids cumulé des WAV avant de promettre l’archive WAV. Les téléchargements individuels restent distincts ; ZIP64 n’est pas livré.
- Worker : deux audio et un ZIP au maximum, réserve temporaire 1 Gio en plus de l’estimation de travail, limites applicatives de RSS/temps et reprise par lease. Les chiffres mesurés sur les fixtures ne dimensionnent pas à eux seuls le catalogue réel/Linux/R2.

## Procédure simple dans l’Admin local

1. **Créer ou reprendre l’identité.** Dans `/admin/catalogue`, réutiliser le projet existant s’il correspond bien à l’édition ; sinon « Créer un album / single ». Garder le nouveau projet **brouillon et masqué**, sans l’ajouter au jukebox par inadvertance. Compléter cover, descriptions, crédits et type réel sans modifier les anciennes fiches inutilement.
2. **Préparer la tracklist.** Dans `/admin/catalogue/{slug}`, ajouter les pistes avec leur titre et leur ordre. Commencer « Annoncée » ou « Non listée » tant que l’édition n’est pas prête. La durée réelle importée est vérifiée par le moteur audio ; ne pas utiliser la durée fictive d’une maquette.
3. **Ouvrir le DCN.** Dans `/admin/musique`, cliquer « Gérer » sur le bon projet. Il est également possible d’ouvrir `/admin/musique/{slug}`. La fiche contient les offres, le lot d’import, les extraits et le diagnostic de préparation.
4. **Importer.** Dans « Ajouter un ou plusieurs masters WAV au lot », sélectionner les fichiers. Associer explicitement chaque ligne à la bonne piste et choisir le début de l’extrait. Ne jamais associer deux fichiers du même lot à la même piste. Lancer une ligne seule ou « Envoyer / reprendre le lot associé ».
5. **Attendre le vrai état prêt.** La fin de l’envoi n’est pas la fin du contrôle : attendre validation, conversion MP3 et extrait. Une ligne en erreur/suspendue ne détruit pas les succès. Choisir le fichier corrigé et reprendre seulement la ligne concernée. Un fichier identique déjà importé demande une revue plutôt qu’un doublon aveugle.
6. **Écouter et contrôler.** Vérifier les titres/ordre, la version privée, le MP3 prêt, le début et la durée de chaque extrait. Lire réellement chaque extrait. Une annonce ou une piste non listée n’est pas incluse dans l’album vendu ; confirmer le nombre exact de pistes de cette édition avant activation.
7. **Renseigner droits et offres, sans inventer de tarifs.** Chaque piste et l’album disposent d’offres indépendantes. Renseigner les vrais prix uniquement après validation commerciale explicite, puis la distribution réelle. Confirmer les droits seulement après revue de leurs preuves. Le diagnostic de prix album supérieur à la somme des titres est un avertissement, pas une remise automatique imposée.
8. **Prévisualiser.** Une fois les médias/droits prêts et la publication locale explicitement choisie, vérifier `/album/{slug}`. Contrôler les extraits, l’édition, les disponibilités et les prix. Une piste inédite peut être commercialisable sans plateforme externe, si toutes les autres conditions passent.
9. **Valider la livraison sur QA autorisée.** Le parcours vérifie compte actif/email, panier numérique, territoire, confirmation serveur, document contractuel puis fourniture. Dans « Ma musique », contrôler WAV + MP3 individuels et deux ZIP, ouvrir les fichiers réellement téléchargés et comparer les checksums de l’édition. Ne pas fabriquer d’achat réel pour une recette et ne pas relancer les anciennes campagnes fournisseurs sans autorisation.
10. **Ne pas ouvrir LIVE dans ce lot.** Les formulaires et gates actuels sont explicitement TEST. Les territoires, documents nouveaux et prix réels restent soumis aux validations du dossier de lancement ; un projet éditorial publié ne suffit pas à ouvrir le paiement numérique.

## Remplacement, retrait et droits historiques

- Remplacer un master passe par l’import d’une **nouvelle version** avec confirmation explicite. Les identités, fichiers, ordre et documents acquis restent figés ; ne pas réécrire un ancien snapshot pour distribuer le dernier remaster.
- Le réglage du début d’extrait ou la correction d’association après import passe également par une nouvelle version : les associations prêtes ne sont pas éditées silencieusement.
- Une nouvelle composition d’album ou un changement de prix doit être relu avant la vente suivante ; l’ancienne acquisition conserve son contenu/prix exacts. Les crédits « Compléter l’album » sont recalculés côté serveur et ne remplacent pas une validation du panier devenu obsolète.
- Pour arrêter **les nouvelles ventes** sans déclarer un problème de droit, désactiver l’offre en laissant sa confirmation de droits réelle inchangée. Décocher la confirmation des droits n’est pas un simple bouton marketing : le code met les médias concernés en attente et une première livraison encore non commencée peut exiger une revue. Une vraie contestation de droits doit rester traitable et auditée ; préservation d’une identité de fichier n’interdit pas la suspension légitime d’un accès.
- Les achats historiques sans snapshot WAV/MP3 restent au **format original acquis**. Aucun octroi MP3 rétroactif, aucune réécriture de facture ni suppression de master n’est réalisé automatiquement. Une migration de distribution historique éventuelle serait une livraison additive auditée, sur le master exact, à autoriser séparément.
- Les anciens masters V1 sans la nouvelle preuve stricte restent téléchargeables par leurs acquéreurs selon les droits déjà accordés ; ils ne deviennent pas de nouvelles offres vendables par simple changement de libellé. Pour les nouvelles ventes, importer une nouvelle version validée par le pipeline strict. Ne jamais changer l’encodeur, le statut ou les métadonnées en SQL pour fabriquer rétroactivement une preuve, ni modifier l’identité acquise.
- Ne pas utiliser la suppression Catalogue pour retirer une ancienne piste vendue : les relations protégées peuvent refuser cette opération. Préférer l’état éditorial/disponibilité adéquat, sans effacer les preuves.

## Limites opérationnelles réellement restantes

1. L’import groupé porte sur les **fichiers**, pas sur un CSV de métadonnées/tracklist. La création des titres est manuelle dans le Catalogue ; elle est disponible aujourd’hui, aucune nouvelle fonction majeure n’est nécessaire pour importer un album de 12 titres.
2. Le contrôle des droits est une attestation Admin avec audit et états de média, **pas un moteur de reconnaissance des ayants droit**. La liste d’autorisations vérifiées reste à fournir par l’artiste pour son véritable catalogue.
3. Le diagnostic « Prête à la vente TEST » est une aide de préparation, jamais un contournement du sélecteur serveur, de la validation audio physique, des territoires, des documents ou des flags de paiement.
4. Les nouveaux MP3/deux ZIP/compléments complexes et règles fiscales ont des preuves locales ciblées. Les anciennes recettes Stripe/PayPal/R2/Safari Mac sont conservées mais ne constituent pas automatiquement une certification externe des adaptations nouvelles. Safari iPhone demeure `NOT_RUN — validation facultative différée`.
5. La reprise d’un ZIP en `REQUIRES_REVIEW`, les alertes d’exploitation, le dimensionnement du volume réel, la sauvegarde des médias et le transport email réel sont à qualifier pour le lancement selon le périmètre effectivement retenu ; ne pas confondre e-mail capturé QA et remise réelle.

## Ce qui doit être fourni pour les vrais albums

- Masters privés définitifs, cover et métadonnées de chaque édition ; début d’extrait souhaité ou contrôle d’écoute.
- Dossier de droits réel (auteurs/compositeurs/producteur/interprètes, samples/reprises, éventuelles exclusivités de distribution), sans nouveau consentement juridique inventé par le code.
- Prix de lancement titre/album et disponibilités réellement approuvés ; choix de traitement des compléments gratuits/négatifs et situations non allouables restant en revue s’ils ne sont pas validés.
- Validation juridique/fiscale du **nouveau** téléchargement B2C pour les territoires retenus et documents correspondants. L’EI, la franchise historiquement utilisée et CM2C déjà documentés ne sont pas à redemander ni à recréer ; ils ne valent pas approbation automatique de tous les pays.

**Verdict : procédure de préparation disponible localement ; import des véritables masters et ouverture commerciale non effectués, projet non déclaré prêt Production.**
