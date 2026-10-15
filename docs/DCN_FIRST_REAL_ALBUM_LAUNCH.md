# DCN — Préparer le premier véritable album, sans ouvrir les ventes

Revue locale du **15 octobre 2026**, base `3a015d3`, branche `feature/dcn-1-0`. Ce guide prépare un premier album de **12 pistes** ; douze est le nombre du dossier de travail, pas une règle imposée à tous les albums. Aucun master réel, tarif, achat ou justificatif historique n'a été importé ou modifié pour rédiger ce document.

**Périmètre commercial déjà décidé :** particuliers, France métropolitaine et Corse, vente directe avec Stripe/PayPal ; licence d'écoute, téléchargement et conservation privés ; exploitations publiques ou commerciales soumises à autorisation spécifique séparée ; droits des collaborations vérifiés avant vente ; demandes commerciales de remboursement pour changement d'avis examinées individuellement, sans remboursement commercial automatique après fourniture immédiate légalement encadrée. Les droits impératifs restent préservés. Ce sont des choix `USER_CONFIRMED`, pas une approbation juridique des nouveaux textes.

L'EI LNX Beats, son identité/SIRET, son régime historique et CM2C sont des acquis réutilisés. Aucune nouvelle adhésion, nouvelle société ou solution Merchant of Record n'est à préparer. La qualification fiscale et la rédaction propres à la nouvelle vente numérique restent à valider ; ni une franchise historique ni le code interne `FR-MET` ne constituent cette validation.

## 1. Préparer une édition privée identifiable

Choisir le **véritable album et son édition** : nom, titre exact de chacune des 12 pistes, ordre, cover, crédits et état inédit/distribué. Ne pas recréer un projet existant si son identité correspond déjà à l'édition. Un inédit n'a pas besoin d'un lien Spotify ou Apple Music pour être techniquement vendable.

Créer un dossier privé hors Git et hors médias publics :

```text
Premier album — édition à préparer/
  masters-prives/01 — Titre exact.wav ... 12 — Titre exact.wav
  cover-originale.jpg
  fiche-edition.txt
  droits-prives/manifest-verifie.txt
```

La fiche d'édition rassemble : titres et ordre, début souhaité de chaque extrait, durée/poids/SHA-256 des WAV originaux, crédits, prix proposés séparément pour chaque titre et pour l'album, disponibilité souhaitée, références des droits et personne ayant fait la revue. Aucun mot de passe, credential ou correspondance confidentielle ne doit être placé dans Git ou une capture.

Les prix sont **librement fixés par LNX Beats**, pas choisis librement par l'acheteur. Aucune somme des anciennes maquettes ou fixtures ne vaut tarif de lancement. Préparer un prix de piste et un prix d'album indépendants ; aucune règle n'oblige le prix album à être la somme des pistes et aucune remise automatique n'est créée. Tant que le prix n'est pas validé, garder l'offre inactive avec prix vide plutôt que publier un montant de démonstration.

| Piste | Titre et WAV original | Début extrait | Prix proposé, à valider | Preuve privée et droits examinés |
| --- | --- | --- | --- | --- |
| 01 | À compléter | À compléter | Non fixé | À vérifier |
| 02 | À compléter | À compléter | Non fixé | À vérifier |
| 03 | À compléter | À compléter | Non fixé | À vérifier |
| 04 | À compléter | À compléter | Non fixé | À vérifier |
| 05 | À compléter | À compléter | Non fixé | À vérifier |
| 06 | À compléter | À compléter | Non fixé | À vérifier |
| 07 | À compléter | À compléter | Non fixé | À vérifier |
| 08 | À compléter | À compléter | Non fixé | À vérifier |
| 09 | À compléter | À compléter | Non fixé | À vérifier |
| 10 | À compléter | À compléter | Non fixé | À vérifier |
| 11 | À compléter | À compléter | Non fixé | À vérifier |
| 12 | À compléter | À compléter | Non fixé | À vérifier |

**Arrêt avant import :** source non définitive, droits non identifiés, fichier renommé artificiellement, contenu de l'édition indécidable ou taille non maîtrisée. La présence d'un fichier ou son succès technique n'atteste jamais le droit de le vendre.

## 2. Importer dans l'Admin autorisé, pas en Production par ce guide

1. Dans `/admin/catalogue`, reprendre le projet ou créer l'album. Garder le projet **brouillon/masqué** pendant la préparation ; ne pas modifier le jukebox ou un projet historique par inadvertance.
2. Dans `/admin/catalogue/{slug}`, créer/contrôler les 12 titres, leur ordre et leur état. Les titres sont saisis dans le Catalogue ; l'import groupé de fichiers n'importe pas automatiquement un CSV de métadonnées.
3. Ouvrir `/admin/musique/{slug}` et « Ajouter un ou plusieurs masters WAV au lot ». Sélectionner les 12 fichiers, **associer explicitement chaque ligne à sa piste**, choisir le début d'extrait ; ne pas associer deux fichiers à la même piste.
4. Lancer un fichier pour contrôler l'association, puis le lot associé. Deux tâches maximum fonctionnent simultanément. Une erreur ne doit pas faire recommencer les onze fichiers réussis. Suspendre/reprendre seulement la ligne concernée, avec le même fichier et les mêmes paramètres ; un résultat inconnu se vérifie avant de créer un nouvel import.
5. Attendre **WAV validé + MP3 privé + extrait prêts**, pas seulement 100 % d'octets envoyés. Le décodage complet strict, les tailles/durées et les structures WAV/MP3 sont contrôlés. Un master invalide, tronqué ou mal étiqueté reste refusé ; ne pas modifier son statut/encodeur en SQL pour contourner cette validation.
6. Lire chaque extrait et vérifier son début, sa durée physique ≤60 secondes, le titre, l'ordre et la version. Le WAV reste l'original privé ; le MP3 complet et l'extrait sont des fichiers dérivés distincts. Les fichiers complets et leur clé ne doivent jamais devenir publics.

**Bornes actuelles :** WAV RIFF PCM entier/flottant, 512 Mio et 30 minutes par source ; 50 fichiers par lot ; MP3 privé 320 kbit/s par défaut, stéréo 44,1 kHz, moins de 96 Mio ; extrait public ≤3 Mio et ≤60 s ; deux traitements audio et un ZIP ; archive ZIP32 de 100 entrées maximum et taille totale sous 4 Gio, en-têtes compris. Vérifier le poids cumulé des WAV de l'album avant de promettre son ZIP. Un WAV multicanal techniquement admis exige aussi une écoute artistique du MP3 stéréo dérivé. Les détails figurent dans [le guide d'import existant](DCN_REAL_ALBUM_IMPORT.md) et [le contrôle audio strict](DCN_LAUNCH_AUDIO.md).

### Ancien master `v1` et correction d'un import

Ne pas altérer une ancienne acquisition pour qu'elle pointe vers un nouveau master. Si le dernier master de cette piste porte exactement l'ancien marqueur `v1`, le WAV original identique peut être réimporté par la **voie additive contrôlée** : confirmation « Créer une nouvelle version », version attendue exacte, validation intégrale et nouveaux identifiants/objets. L'audit relie la version précédente ; ses fichiers et droits acquis restent intacts. Cette exception n'autorise ni doublon d'une autre piste, ni réimport aveugle d'un `v2-strict`, ni correspondances ambiguës.

Un véritable nouveau mix/master, un nouvel extrait après import ou une mauvaise association corrigée passe également par une nouvelle version. Dans tous les cas, les nouveaux médias repartent avec droits en attente ; l'approbation d'une ancienne version ne vaut pas approbation de la suivante.

## 3. Vérifier les droits par version avant toute vente

Dans « **Autorisations et collaborateurs — par version de master** » :

1. Examiner réellement composition, auteurs/co-auteurs, master/producteur, interprètes/collaborateurs, samples/reprises, extraits et éventuelles clauses exclusives de distribution, pour les usages annoncés.
2. Conserver les contrats/autorisations dans une archive privée accessible aux seuls administrateurs habilités. Le formulaire ne constitue pas un coffre d'upload de correspondance : saisir une référence opaque `private-evidence:...` et le SHA-256 du justificatif ou d'un manifeste privé vérifié.
3. Sélectionner seulement les versions réellement couvertes. Un manifeste commun peut couvrir les 12 pistes s'il les identifie toutes ; « Sélectionner les versions éligibles » ne les approuve pas automatiquement.
4. Choisir la décision, confirmer l'attestation et enregistrer. La décision `APPROVED` est liée à l'identité/version et aux checksums WAV/MP3/extrait ; elle n'est pas une simple approbation générale de l'album.
5. Vérifier la nouvelle ligne de l'historique append-only. Les états `DRAFT`, `REVIEW_REQUIRED`, `REJECTED` ou `REVOKED`, une preuve absente ou une version remplacée bloquent la nouvelle vente concernée. Aucun ancien événement n'est écrasé.

Cette revue structurée est **distincte** de la case de droits de l'offre et de la validation juridique des CGV. L'upload seul n'accorde aucun droit ; un featuring ou une collaboration ne doit jamais être commercialisé par simple présomption. Le logiciel vérifie les preuves enregistrées et leur rattachement, pas l'authenticité juridique de toute signature ou la reconnaissance automatique d'ayants droit.

## 4. Préparer les offres et prévisualiser l'édition exacte

Lorsque la préparation et les droits sont prêts, choisir explicitement la publication **locale/QA** du projet et des seules pistes incluses. Les pistes « Annoncée » et « Non listée » ne font pas partie de l'album vendu. Pour ce premier album, vérifier que le diagnostic annonce bien **12 pistes incluses**, ni onze ni treize.

Renseigner séparément l'offre de chaque piste souhaitée et l'**offre album indépendante**. L'album ne nécessite pas forcément la vente séparée de tous ses titres. « Inédit / non distribué » reste compatible avec la vente, mais ne dispense pas de droits. Confirmer les droits de l'offre seulement après la revue par version, puis activer uniquement la disponibilité **TEST** explicitement autorisée. Les messages « Prête à la vente TEST » ou « Offre album vendable TEST » ne signifient pas LIVE ouvert.

Dans `/album/{slug}`, contrôler cover, titres/ordre, nombre exact de pistes, lecteur et extraits, formats et prix choisis. Dans le panier numérique, contrôler que le panier physique, le stock et les livraisons ne sont pas affectés. Pour « Compléter l'album », comparer le devis serveur aux acquisitions éligibles nettes de remboursements ; ne pas saisir un crédit manuel ni réécrire les factures des anciens titres. Une variation de prix/composition exige un nouveau devis accepté. Un album déjà acquis ou une preuve ambiguë ne doit pas produire un second paiement.

**Arrêt technique :** mauvaise édition/version, extrait erroné, absence de MP3, droits non approuvés, prix absent, somme ou crédit inattendu, état de paiement inconnu, ZIP trop volumineux ou fichier complet accessible publiquement. Fermer les nouvelles ventes concernées ; ne pas effacer les fichiers/documents acquis et ne pas relancer un paiement pour « débloquer » une incohérence.

## 5. Vérifier la livraison sur QA autorisée

Les preuves Stripe TEST, PayPal SANDBOX, R2 et Safari Mac déjà acquises sont conservées. **Ne pas relancer ces campagnes ni utiliser un véritable album/client pour un achat sans autorisation précise.** Une recette locale avec doubles doit porter la mention simulation ; une vérification prestataire ou physique ne devient PASS qu'après exécution réelle. Safari iPhone reste `NOT_RUN — validation facultative différée`.

Pour la prochaine recette autorisée, le parcours attendu est : compte actif/email vérifié → panier/devis serveur → informations territoriales → cases distinctes non précochées → paiement serveur confirmé → facture et confirmation contractuelle → remise durable et reconnaissance explicite → commencement → bibliothèque.

Dans « Ma musique », vérifier pour **l'édition effectivement achetée** :

- 12 WAV et 12 MP3 individuels disponibles au propriétaire seulement ; autre utilisateur refusé ; liens privés renouvelables.
- ZIP WAV et ZIP MP3 distincts, chacun avec les douze noms/positions prévus ; aucune substitution par le dernier remaster courant.
- Téléchargements réellement conservés et ouverts, écoute WAV/MP3, décompression ZIP, SHA-256 comparés aux identités de cette acquisition ; ne pas publier des masters complets dans le dossier de restitution.
- Confirmation, facture et avoir éventuel cohérents sur somme, version, crédit et fiscalité validée ; aucune numérotation réelle ou taxation supposée issue d'une fixture QA.
- Notifications sans doublon ; un e-mail capturé ne vaut ni envoi, ni livraison, ni lecture. Aucun e-mail de recette vers un vrai client.

## 6. Audit actuel des consentements et de la remise — preuves à conserver

Lecture ciblée de `components/digital-checkout.tsx`, `lib/digital/commerce.ts`, `fulfillment-policy.ts`, `documents.ts`, `notifications.ts` et `components/digital-documents.tsx` sur la base annoncée. Aucun parcours contractuel historique n'a été modifié par cet audit.

| Étape | Preuve réellement prévue par le code | Limite avant ouverture réelle |
| --- | --- | --- |
| Choix du client | Deux cases distinctes initialement fausses ; serveur exige les deux choix vrais et la bonne version de termes. | Les libellés actifs restent les textes génériques de consolidation QA. La présence du nouveau brouillon France en lecture ne l'intègre pas au contrat d'un achat. |
| Contrat accepté | Snapshot horodaté avec identité client, texte/version et hash ; contrôle du texte et des consentements lors de la génération. | Les règles et le moment de formation doivent être relus ; un numéro de version envoyé par le navigateur seul n'est pas la preuve d'une acceptation effective du texte affiché. Il faut aligner exactement lecture/choix/texte figé avant LIVE. |
| Paiement | État prestataire contrôlé côté serveur avant préparation de facture/contrat et droits. | Le retour navigateur n'accorde aucun accès ; ne pas transposer un paiement QA simulé en confirmation réelle. |
| PDF remis | PDF privé avec hash vérifié ; GET du propriétaire trace `DOCUMENT_TRANSFER_FINISHED`. HEAD ne trace pas de remise. | L'événement atteste un flux envoyé par le serveur, explicitement **pas** un stockage ou une lecture sur l'appareil. |
| Réception et commencement | Le client coche après demande de téléchargement ; serveur exige document/owner/hash et événement de transfert, puis recontrôle compte/territoire/droits/médias/crédit. Audit de réception et `confirmationAt/accessReadyAt` sont conservés. | Cette politique est marquée QA, proposée pour revue juridique ; elle n'est pas une validation LIVE de la remise durable ou du moment juridique de commencement. |
| E-mail | Jobs idempotents séparés pour contrat disponible et accès prêt ; capture locale isolée. | `CAPTURED_QA` n'est pas `SENT`/livré. Une notification contenant un lien seul ne doit pas être prétendue confirmation durable intégralement remise. |

L'[article L. 221-28, 13°](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044563170) exige les conditions cumulatives de consentement exprès préalable, reconnaissance, confirmation prévue par [L. 221-13](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044563210) et commencement de fourniture. Le paiement ou l'acceptation générale des CGV n'en tient pas lieu. Les garanties légales ne disparaissent pas avec cette exception.

L'[article L. 221-21](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044563193), en vigueur dans sa nouvelle rédaction depuis le 19 juin 2026, impose la fonctionnalité de rétractation en ligne pour les contrats conclus en ligne. Les modalités de [D. 221-5, version applicable depuis le 19 juin 2026](https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069565/LEGISCTA000032807234/2026-07-01/) prévoient l'identification du consommateur et du contrat, le moyen électronique de remise de l'accusé, la possibilité de relire/corriger, une confirmation explicite puis un accusé durable indiquant le contenu de la déclaration, sa date et son heure. Le lot de raccordement prépare une option DCN dans `/retractation`, sans faire passer cet achat pour une commande personnalisée. Ce guide ne certifie pas sa conformité avant ses tests. Le délai ordinaire de quatorze jours et les demandes légales valables restent préservés ; l'information manquante peut prolonger le délai selon les règles applicables, elle ne crée pas une perte automatique du droit.

La [fiche DGCCRF du 2 octobre 2026](https://www.economie.gouv.fr/dgccrf/les-fiches-pratiques/delais-de-reflexion-ou-de-retractation-comment-sappliquent-t-ils), relue dans ce lot, confirme la fonctionnalité en ligne, le départ du délai à la conclusion pour les contenus numériques et les conséquences d'une information insuffisante. Ces sources sont publiques ; aucun accès fournisseur de paiement n'a été utilisé. Elles ne constituent pas une approbation du dossier contractuel particulier de LNX Beats.

L'encadré exact de garantie applicable à une fourniture numérique ponctuelle, **D. 211-3 et son annexe**, demeure à intégrer/revoir avant approbation finale. Le résumé du brouillon France n'est pas sa reproduction certifiée ; ne pas le publier comme tel. La durée de réponse des défauts de conformité et la présomption d'antériorité sont distinctes ; aucune garantie ne doit être effacée pour présenter une vente « non remboursable ».

## 7. Dernière fiche de validation, sans faux « prêt Production »

| Domaine | À obtenir ou vérifier réellement | Ne pas recommencer |
| --- | --- | --- |
| Édition réelle | Album choisi, douze masters définitifs, cover, titres/ordre, extraits écoutés et formats téléchargés. | Pas de reconstruction d'architecture ou de catalogue déjà correct. |
| Droits réels | Revues approuvées pour chaque master exact et preuves privées valables, y compris collaborations. | Pas de nouvelle adhésion CM2C ni d'identité d'entreprise inventée. |
| Prix | Vrais prix titre/album décidés par le vendeur et récapitulatif compréhensible. | Aucun prix de maquette transformé en tarif réel, aucun pay-what-you-want ajouté. |
| Fiscalité France et portée | Base documentée du nouveau flux, calcul et facture validés ; contrôle juridique des modalités du périmètre commercial déjà retenu. | La décision commerciale métropole/Corse est acquise ; ne pas la confondre avec un accord fiscal/juridique. |
| Nouveaux contrats | Texte exact approuvé, version nouvelle sélectionnée par le parcours, encadré D. 211-3, consentements et preuve de remise/commencement. | Aucune réécriture des contrats, snapshots, factures ou approvals historiques. |
| Rétractation DCN | Formulaire dédié/raccordé, confirmation et accusé durable, horodatage, anti-énumération, demandes traitables sans remboursement automatique. | Ne pas modifier le parcours Commander/Boutique pour masquer une absence de support numérique. |
| Exploitation et release | Secrets séparés, flags, recettes affectées autorisées, reprise/limites, sauvegarde/restore, migration/ACL et promotion explicitement autorisés le moment venu. | Aucun nouveau push, déploiement, appel prestataire ou changement Production par ce guide. |

**Préflight d'horodatage :** les nouvelles preuves DCN exigent des sessions PostgreSQL réellement UTC. Le contrôle doit comparer un nouvel ISO de reçu avec l'epoch SQL natif, pas seulement relire la date via le même adaptateur. Le lot final a corrigé uniquement le profil de sa copie locale et ajouté un refus des nouvelles opérations DCN sur session incompatible ; ne modifier aucun horodatage ou reçu historique pour faire passer ce gate.

Pour arrêter seulement une disponibilité commerciale, désactiver l'offre concernée sans falsifier les preuves de droits. Une contestation réelle de droit doit être enregistrée comme telle et traitée ; une révocation n'est pas un simple bouton marketing. Préserver les acquisitions, versions et justificatifs et ne supprimer aucun ancien master pour faciliter une reprise.

**Conclusion : préparation du premier album documentée ; aucune ouverture commerciale, mutation Production ou nouvelle recette prestataire exécutée ; projet non déclaré prêt Production.**
