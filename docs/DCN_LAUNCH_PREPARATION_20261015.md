# DCN — préparation finale du lancement

Travail local du 15 octobre 2026, depuis `21a790fe1668ba9b113c439dbe320c792a1c6b88` / tree `478d4ca7d71d01689a273aab53428e0817082868`, branche `feature/dcn-1-0`. **Version non déclarée prête Production.** Aucun tarif, nouveau territoire ou texte juridique LIVE approuvé par ce lot.

## Résultat et ce qui reste réellement à faire

| Domaine | Livré dans ce lot | Reste avant lancement |
|---|---|---|
| Développement technique | Complément sur paiements promotionnels/multi-titres et remboursements alloués ; concurrence PostgreSQL ; contrôle WAV/MP3 intégral ; nouvelle vente conditionnée à cette preuve ; revalidation additive d’un ancien WAV ; messages de refus explicites | Le candidat reste volontairement TEST-only. L’adaptation LIVE dépend du vendeur choisi et nécessite des contrôles ciblés autorisés ; un simple flag ne suffit pas. Automatisations fiscales/MoR non implémentées et territoires fermés. Voir limites ci-dessous |
| Fiscalité/juridique | Comparaison documentée vente directe / moteur fiscal / MoR et questions précises propres au nouveau téléchargement mondial | Choisir le modèle de vente, faire valider la qualification, les territoires, preuves client, documents, crédit album et conditions numériques. EI/BNC/franchise historique/CM2C déjà acquis, pas de nouvelle adhésion |
| Vrais albums | Guide simple des écrans Admin, import WAV individuel/groupé, extraits, offres titre/album, inédits, droits et formats/ZIP | Fournir les vrais masters/covers/métadonnées/autorisations et prix approuvés, importer puis contrôler le rendu. Aucune œuvre réelle importée par ce lot |
| Décisions commerciales | Panier séparé, compte actif vérifié, versions acquises immuables, pas d’octroi automatique de remaster et licence personnelle provisoire conservés | Prix réels, compléments gratuits si crédit ≥ prix album, promotions globales non allouables, équivalences entre éditions et réemploi après remboursement. Aucune décision prise à la place de LNX |

## 1. Compléter l’album

Le crédit repose sur les montants **effectivement payés, figés et non remboursés**, pas sur les tarifs actuels. Un panier multi-titres dont les lignes positives totalisent exactement le paiement devient éligible ; les promotions portées par ces lignes sont prises telles quelles. Les remboursements sont déduits selon leur allocation exacte à chaque ligne, jamais plusieurs fois du montant global.

Une résolution intégrale révoque les droits concernés. Une réduction de prix intégrale peut conserver le droit avec un crédit nul ; aucun enregistrement de crédit positif n’est inventé pour cette source. L’album exact déjà acquis est reconnu, alors que douze titres individuels ne créent pas implicitement un droit ZIP. Le prix et le contenu courants sont recalculés côté serveur ; les commandes déjà achetées restent figées.

Verrou utilisateur, index unique et réservations persistantes protègent la concurrence et le double emploi. Une réservation ambiguë n’est pas libérée et un crédit consommé n’est pas recyclé automatiquement. Le format d’empreinte v1 reste compatible. Les changements d’édition/master, situations ambiguës et sommes dues nulles restent fail-closed.

Preuves et matrice détaillées : [DCN_LAUNCH_COMPLETION.md](DCN_LAUNCH_COMPLETION.md). PostgreSQL local réel avec rôle non propriétaire ; les paiements/remboursements sont des fixtures et doubles financiers, **pas de nouveaux tests prestataires**.

## 2. Qualité audio et sécurité de publication

Le pipeline vérifie les structures RIFF/WAV et toutes les frames MP3, décode intégralement avec FFmpeg strict et rapproche durées/bitrate. Il refuse troncatures, payloads parasites, formats déguisés ou contradictoires. L’extrait public final reste physiquement ≤60 secondes. Masters WAV et MP3 complets sont privés ; seuls les extraits bornés peuvent être publics.

Une nouvelle vente exige la provenance `ffmpeg-libmp3lame-cbr-v2-strict` et des métadonnées cohérentes. Une vieille preuve v1 n’est ni renommée ni réécrite. Les téléchargements historiques utilisent leurs identités acquises et ne sont pas soumis rétroactivement à ce nouveau gate de vente. Un WAV v1 identique peut être revalidé en **nouvelle version** de la même piste après tous les contrôles, avec nouveaux assets et audit lié ; aucun contournement par modification des octets n’est nécessaire.

FFprobe n’était pas installé dans les chemins vérifiés. Aucun outil téléchargé : les preuves reposent sur FFmpeg réel déjà présent et les parseurs bornés, pas sur un FFprobe simulé. Les limites mémoire/disque/concurrence et la quarantaine sont conservées. Un échec de surveillance mémoire arrête le processus, sans réussite fictive.

Preuves : [DCN_LAUNCH_AUDIO.md](DCN_LAUNCH_AUDIO.md). Le contrôle technique ne certifie pas la qualité artistique, les droits d’auteur ou un rendu multicanal parfait ; une écoute des vrais masters et dérivés reste indispensable.

## 3. Modèle mondial B2C

Étude publique datée, coûts indicatifs et sources officielles : [DCN_WORLDWIDE_B2C_OPTIONS_20261015.md](DCN_WORLDWIDE_B2C_OPTIONS_20261015.md).

En vente directe, LNX reste vendeur et responsable même avec un moteur fiscal. Les champs résidence et facturation saisis par le même client ne deviennent pas deux sources indépendantes de localisation. Le registre géographique existant et ses documents sont conservés ; aucune règle `ALLOW` n’a été ajoutée.

Un MoR peut prendre en charge les taxes indirectes des opérations couvertes, mais change le vendeur contractuel, les justificatifs, les flux de remboursement et les commissions. La documentation Managed Payments inclut la France et l’audio ; cela ne vaut ni admission du compte ni activation. Les autres solutions ont leurs propres restrictions de livraison et de catalogue. Aucun compte, abonnement, contact prestataire, inscription fiscale ou appel de calcul distant réalisé.

La décision suivante porte sur **vente directe accompagnée territorialement** ou **MoR sur un périmètre numérique défini**. Il n’est pas nécessaire de refaire les démarches EI/CM2C. La franchise historique n’est pas transformée en exonération mondiale ; les nouveaux documents contractuels restent des brouillons de ce parcours, les anciens documents approuvés demeurent intacts.

## 4. Préparation des vrais albums

[DCN_REAL_ALBUM_IMPORT.md](DCN_REAL_ALBUM_IMPORT.md) précise les routes Admin, limites et étapes. Le lot de fichiers est associé explicitement à une tracklist : ce n’est pas un import automatique de métadonnées CSV. Un single ou inédit sans plateforme externe est admis techniquement. Les prix titre et album restent indépendants ; l’Admin atteste les droits avec audit, il ne reconnaît pas automatiquement les ayants droit.

WAV privé original + MP3 privé dérivé, ZIP WAV + ZIP MP3 distincts et snapshots historiques sont réutilisés. Ne pas supprimer/requalifier les vieux masters pour activer une offre. Après ajout ou remplacement, revoir seulement les nouvelles disponibilités ; aucune nouvelle édition n’est offerte automatiquement aux anciens acheteurs.

## Contrôles et preuves

Le fichier `output/dcn-launch/final-checks.json` et les journaux voisins consignent les commandes et résultats finaux ; `targeted-tests.json` donne le nombre exact de tests et la liste des fichiers, sans additionner les sous-campagnes des agents ni les 277 tests antérieurs. La sélection couvre les modules modifiés et leurs consommateurs : complément, normalisation du panier, audio/versions, publication Admin, documents/droits, bibliothèque, finance dépendante, présentation et frontières locales.

Résultat final : **135 tests PASS / 21 fichiers, 0 FAIL, 0 SKIP ; lint global, typecheck, build Web, build worker DCN dédié et diff-check PASS.** Le premier typecheck a révélé uniquement un typage trop étroit de `randomUUID()` dans la nouvelle fixture ; correction de cette annotation, cinq tests concernés revérifiés puis reprise des gates. Ces cinq tests ne sont pas ajoutés aux 135 comme de nouveaux scénarios. Les premiers résultats et l’erreur corrigée sont conservés dans les preuves.

Le lint global conserve **quatre avertissements préexistants**, sans erreur, dans d’anciens outils QA (`safari-physical`, `stripe-download-proof`, ancien contrôleur PayPal et préparation R2). Les fichiers nouveaux/modifiés de ce lot passent le lint ciblé sans avertissement. Ces avertissements ne sont pas des alertes de dépendances et n’ont pas motivé de retouche hors périmètre. Les journaux générés ont seulement été normalisés en espaces/fins de ligne pour leur conservation dans Git.

`output/dcn-launch/completion-complex-runtime.json` conserve les sept contrôles PostgreSQL réels, dont deux transactions concurrentes et les empreintes historiques avant/après. Seules de nouvelles identités et opérations synthétiques ont été créées dans la copie QA locale ; aucun document/master/acquisition préexistant n’a changé. Ces données sont conservées pour audit, sans nettoyage destructif.

Les preuves Stripe TEST, PayPal SANDBOX, R2 et Safari Mac déjà acquises restent conservées. **Aucune recette prestataire ni campagne physique n’a été relancée** et ces preuves antérieures ne sont pas présentées comme une qualification externe du nouveau code audio/crédit. Safari iPhone : `NOT_RUN — validation facultative différée`.

Schéma Prisma, migrations, dépendances et lockfile inchangés : pas de nouvelle migration, nouvelle installation, nouvel audit général ou restauration. Les preuves locales de restauration/upgrade et les 664 contrôles ACL du lot précédent restent applicables au schéma inchangé ; les sept contrôles frais confirment l’usage du rôle `dcn_runtime_a` non propriétaire. Aucune nouvelle sauvegarde Production ou modification de privilèges effectuée.

## Lancement local et protections

Depuis le worktree DCN, réutiliser les profils privés locaux déjà préparés, sans en copier les valeurs :

```sh
npm run dcn:local:built -- consolidation
# Dans un autre terminal, seulement pour traiter les nouveaux jobs QA :
npm run dcn:local:worker -- consolidation
```

Application : `http://127.0.0.1:3140` ; PostgreSQL local existant `127.0.0.1:55473`. Les profils restent en TEST avec nouveaux paiements désactivés, sans credentials fournisseurs ; ne pas lancer d’ancienne fixture de checkout sur un master v1 pour contourner le nouveau contrôle. Les acquisitions historiques restent consultables. Aucun tunnel, HTTPS LAN ou confiance TLS installé par ce lot.

État Git final et empreinte du livrable consignés dans la restitution et le message de livraison. **Aucun push, merge, déploiement, appel financier/API de compte prestataire, mutation Production/Railway/OVH, nouvel email réel ou paiement LIVE.** La recherche de tarifs/règles est limitée aux documents publics officiels. Aucun secret, master complet, base ou fichier `.env` dans la restitution.
