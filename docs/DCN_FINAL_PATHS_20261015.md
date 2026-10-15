# DCN — rétractation, résidence et premier album

15 octobre 2026. Base `3a015d380e876e885feceb9c9e0bb603dbcc8fb3`, branche `feature/dcn-1-0`. Les décisions commerciales acquises restent inchangées. Ce lot prépare localement les deux parcours manquants ; il n'approuve aucun nouveau texte, taux, territoire LIVE ou tarif.

## Parcours terminés localement

### Demandes des consommateurs

Le registre et le formulaire historiques de rétractation sont étendus au téléchargement DCN, avec identification de l'achat depuis la bibliothèque ou la confirmation. Le client peut présenter, sans connexion obligatoire, une rétractation, une réclamation pour non-conformité ou une demande commerciale. Les natures restent distinctes. Il relit et corrige sa déclaration avant confirmation explicite ; aucun motif de rétractation n'est obligatoire.

Le reçu est téléchargeable immédiatement et conserve le contenu, la nature de demande, la date/heure UTC et son empreinte. La queue e-mail existante est réutilisée avec retry et idempotence. En local, **CAPTURED_QA signifie capturé, pas envoyé ni reçu par une personne réelle**. L'Admin consulte les éléments et l'historique puis motive sa décision. Ni la demande, ni sa réception ou son acceptation ne déclenchent un remboursement ou une révocation d'accès. Les remboursements et avoirs DCN restent dans la procédure financière distincte existante.

L'exception numérique est examinée cumulativement : consentement exprès préalable, reconnaissance de perte du droit, confirmation durable et commencement de l'exécution. Deux cases ou un délai apparent de quatorze jours ne suffisent pas. Le parcours TEST conserve ses preuves QA sans les convertir en preuve de remise juridiquement validée. Les demandes inconnues restent enregistrées et nécessitent une vérification humaine ; aucun contenu d'une ancienne demande n'est divulgué lors d'une nouvelle soumission différente.

### Résidence et cohérence de facturation

Le checkout permet d'enregistrer une adresse privée minimale — voie/lieu-dit, ville, code postal et pays — puis d'en suivre la revue Admin. France métropolitaine et Corse uniquement ; outre-mer, Monaco et étranger restent fermés. Aucun téléphone, nationalité, date de naissance, document d'identité ou justificatif photographique systématique n'est demandé.

Le contrôle ne confond pas une syntaxe d'adresse, deux déclarations ou le pays d'une carte avec une preuve de résidence. L'Admin examine le dossier de façon proportionnée, explique les incohérences et trace son appréciation. La facturation locale disponible est vérifiée, sans inventer une adresse absente ni requalifier une déclaration historique en preuve prestataire. Une contradiction reste bloquante tant qu'elle n'est pas explicitement résolue par un opérateur habilité.

Les nouveaux engagements lient utilisateur, déclaration, revue, pays/codes postaux, hashes et contexte de facturation figé. Un retry ne permet pas de changer de pays ou d'adresse ; remplacement de déclaration, révocation, expiration ou altération bloque le nouvel engagement/la première fourniture. Les acquisitions historiques et re-téléchargements déjà autorisés ne sont pas réécrits.

Lorsque les réponses de paiement **déjà obtenues** contiennent un pays/code postal de facturation, le normaliseur DCN en conserve uniquement ces champs pour vérifier la cohérence. Aucune requête supplémentaire ni collecte d'adresse chez Stripe/PayPal n'est ajoutée. Une contradiction avant capture PayPal bloque celle-ci ; si un paiement est déjà confirmé, le montant reste reconnu comme payé mais la nouvelle attribution passe en revue, sans remboursement automatique. L'absence de champ prestataire reste inconnue et ne fabrique pas de preuve. Les payloads de création Checkout/Order et les autres domaines de paiement ne changent pas.

## Textes et validation restante

Références vérifiées pour le cadrage d'octobre 2026 : [L. 221-21](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044563193), [D. 221-5](https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069565/LEGISCTA000032807234/2026-07-01/) et [L. 221-28, 13°](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044563170/2022-08-25), avec la [fiche DGCCRF du 2 octobre 2026](https://www.economie.gouv.fr/dgccrf/les-fiches-pratiques/delais-de-reflexion-ou-de-retractation-comment-sappliquent-t-ils). L. 221-21/D. 221-5 sont applicables depuis le 19 juin 2026 ; la fiche d'octobre confirme la fonctionnalité en ligne et l'accusé avec contenu/date/heure. Les lectures directes de certaines URL Légifrance datées d'octobre étaient indisponibles ; les textes officiels indexés et la confirmation DGCCRF ont été recoupés, sans prétendre à une consultation juridique.

Les seules validations restantes portent sur le **nouveau commerce DCN** :

1. Relecture des CGV DCN France DRAFT, des mentions de fourniture/rétractation/garanties et de l'encadré réglementaire D. 211-3. Définir la preuve de remise durable acceptable avant LIVE puis raccorder la version exacte lue/acceptée aux nouvelles commandes seulement. Les anciens contrats/snapshots restent immuables.
2. Qualification fiscale des nouveaux téléchargements et du complément d'album, branche de franchise effectivement applicable, cumul des recettes et mentions comptables. Réutiliser les quatre questions précises du rapport fiscal France, pas une nouvelle constitution d'EI ni un dossier mondial.
3. Relecture des modalités de limitation territoriale et de la politique de conservation des données de résidence. Le hash d'adresse reste une donnée personnelle pseudonymisée, pas une anonymisation ; aucune durée légale n'est inventée.
4. Vrais masters, droits par version et prix librement fixés par LNX. Les anciens prix de maquette ne deviennent pas des tarifs de lancement.

L'EI LNX Beats, CM2C déjà souscrit, le régime historiquement documenté et les CGV approuvées des autres activités ne sont pas reconstitués. Les captures e-mail QA ne valident ni délivrance réelle, ni texte juridique. L'activation DCN LIVE reste un futur lot explicitement autorisé, avec ses gates propres ; la revue d'une adresse ne suffit jamais à ouvrir le paiement.

## Limites techniques circonscrites

- Revue manuelle de résidence pour chaque nouvelle déclaration : sûre et utilisable mais à opérer humainement ; aucune certification automatique d'adresse ni de personne.
- Pas encore de rattachement technique a posteriori d'une référence de demande inconnue : vérifier humainement puis conserver l'original ; ne pas réécrire son identité ou son reçu.
- Accusé e-mail et confirmation contractuelle juridiquement recevable en LIVE restent à qualifier/raccorder. Le transport local capture uniquement.
- L'encadré de garantie final et la sélection de la nouvelle version France par le futur checkout ne sont pas maquillés en fonctionnalités LIVE terminées.
- Aucune nouvelle recette Stripe/PayPal/R2, Safari physique ou campagne générale n'est exécutée. Les preuves antérieures sont conservées, pas automatiquement étendues à un nouveau comportement LIVE.

## Import du premier album

Suivre `docs/DCN_FIRST_REAL_ALBUM_LAUNCH.md` : préparer les 12 WAV et la grille des métadonnées/prix, importer individuellement ou en lot dans le Catalogue/Admin DCN, traiter les erreurs par reprise, vérifier formats et extraits, approuver les droits privés de chaque master, enregistrer les prix de titres et d'album indépendamment, produire WAV/MP3 et les deux ZIP, puis prévisualiser le parcours QA. Aucune mise en vente réelle avant les validations ci-dessus. Ne remplacer aucun master acquis : créer une nouvelle édition additive.

## Vérifications et lancement local

Les preuves de ce lot sont dans `output/dcn-final-paths/`. La campagne ciblée comporte **128 tests PASS, zéro FAIL/SKIP**, avec doubles de dépôts/sessions/prestataires. Prisma format/validate/generate, lint, typecheck et builds Web/worker passent ; quatre avertissements lint préexistants concernent les anciens outils QA. Ils ne sont pas comptés comme de nouveaux tests prestataires.

Après les ajustements du formulaire et du normaliseur d'adresse PayPal, 45 tests du sous-ensemble affecté ont passé, sans addition aux 128. Le contrôle indépendant de l'horodatage SQL décrit ci-dessous a ensuite justifié un dernier passage étendu : **76 tests affectés PASS, zéro FAIL/SKIP**, incluant les nouveaux tests UTC et les protections du profil local. Les campagnes se recouvrent ; elles ne sont pas additionnées en un total artificiel. Lint/typecheck et builds Web/worker du candidat final passent. La revue indépendante du diff n'a identifié aucun blocage concret dans ces frontières ; elle ne constitue ni audit juridique ni recette prestataire.

La seule migration nouvelle est `20261015040000_digital_consumer_withdrawal`. Le protocole d'upgrade sauvegarde/chiffre la QA locale source et restaure une **nouvelle copie**, puis contrôle les anciennes colonnes de toutes les tables et les droits réels du rôle non propriétaire. L'essai ACL initial a échoué sur une fixture : `now()` PostgreSQL est l'heure de début de transaction, antérieure au reçu JS créé ensuite. La fixture d'accusé exige une heure effective postérieure ; la contrainte et le code applicatif ne sont pas affaiblis. La reprise réutilise le backup/restore acquis, sans nouvel export ni réapplication de migration. Les résultats finaux et l'essai initial sont conservés séparément.

Résultat réel final : **backup chiffré AES-256-GCM avec clé séparée, restauration et upgrade PASS ; 106 tables historiques préservées ; 33 contrôles ACL PASS** avec `dcn_runtime_a` non propriétaire, y compris refus des mutations d'identité/reçu original, des suppressions et du DDL. Seule la nouvelle copie `lnx_dcn_final_paths_test_20261015` est migrée. La source `lnx_dcn_consolidation_test` est restée en lecture seule et une dernière comparaison des 106 canaris est fournie. Aucun backup ou accès Production n'a été effectué.

**12 scénarios fonctionnels réels PostgreSQL PASS** sur la copie : adresse sans revue bloquée, revue liée sans ouverture LIVE, pays/adresse figés et retry refusé en cas de changement, invalidation par nouvelle déclaration, demande rapprochée/doublon, reçu JSONB et hash relus, e-mail capturé non envoyé, décision humaine idempotente, trois natures de demandes distinctes, absence de mutation financière, refus d'une session non UTC et concordance indépendante de l'epoch SQL avec le reçu. Les fixtures synthétiques des deux passages sont conservées dans cette seule copie ; aucune acquisition historique n'est réécrite. Un avertissement de dépréciation `pg` sur des requêtes simultanées du client de fixture a été observé ; aucun échec SQL ni contournement de contrainte n'a été retenu comme PASS.

### Anomalie locale d'horodatage détectée et corrigée

Le premier contrôle JSONB/Prisma, bien qu'il ait passé, ne suffisait pas à démontrer l'heure réellement persistée. Le téléchargement navigateur a été comparé avec une lecture indépendante par `pg` : le premier reçu synthétique avait une différence de deux heures entre le timestamp SQL et l'ISO du snapshot. L'adaptateur installé sérialise les Date en heure murale UTC sans offset, puis normalise les retours timestamptz en retirant l'offset ; la session locale héritait de `Europe/Paris`. Deux lectures par le même adaptateur pouvaient donc masquer l'écart. Ce résultat initial n'est pas présenté comme une preuve d'heure SQL correcte.

Le profil **de la seule nouvelle copie QA** impose maintenant `options=-c timezone=UTC`. Le validateur PostgreSQL local générique reste inchangé : une exception DCN n'accepte que cette valeur exacte et cette base précise, jamais un autre paramètre libpq ou hôte. Un garde applicatif vérifie réellement `current_setting('TimeZone')` dans la même transaction avant les nouvelles écritures DCN de déclaration, preuve de résidence ou décision ; une session non UTC, inconnue ou illisible refuse l'action avant DML. Il ne change pas silencieusement le fuseau et ne modifie pas l'adaptateur partagé.

L'ancien reçu synthétique, son hash et ses timestamps restent intacts, ainsi que les preuves antérieures conservées `pre-utc-*`. Les nouveaux reçus ont été vérifiés par **epoch SQL natif = ISO du snapshot = Date Prisma**, puis téléchargement réel. La configuration UTC doit faire partie des gates d'un futur environnement DCN ; aucun état de fuseau Production n'a été supposé ou consulté dans cette mission.

La recette navigateur réelle **locale dans Codex** a vérifié la sélection DCN par défaut, la relecture, le bouton Modifier, la confirmation explicite, l'affichage du reçu et son téléchargement TXT réellement enregistré. Cette demande synthétique inconnue reste en attente, avec une seule notification durable non envoyée ; aucune erreur console n'a été capturée. Ce n'est pas une nouvelle recette Safari physique. Les smokes du build contrôlent aussi health/album/conditions/formulaire à 200, les API privées refusées sans connexion et la bibliothèque redirigée. Le premier smoke Admin a utilisé GET sur une route POST et obtenu le 405 attendu de cette méthode ; le harnais a été corrigé pour vérifier le refus du véritable POST, sans changement applicatif.

La restitution portable `LNX_DCN_FINAL_PATHS_20261015.zip` contient les rapports, preuves expurgées, l'accusé TXT synthétique, une capture réelle et un index HTML hors ligne. L'intégrité de l'archive et chaque SHA-256 du manifeste sont vérifiés. Le scan ciblé couvre tous les fichiers modifiés et recherche aussi les valeurs des profils privés en mémoire, sans les imprimer. Aucun master, base, fichier `.env`, document de droits privé ou credential n'est inclus.

Pour tester le nouveau schéma, utiliser **la copie finale**, jamais migrer la QA historique pour lancer ce build : `npm run dcn:local:built -- final-paths`, puis `http://127.0.0.1:3140`. Application et PostgreSQL restent en loopback. Le lanceur active uniquement l'interface TEST sur cette base explicitement autorisée ; nouveaux paiements externes/LIVE et annonces restent désactivés. Aucun tunnel, port public ou confiance TLS n'est créé.

**Aucun push, merge, déploiement, changement Production/Railway/OVH, paiement LIVE, e-mail réel ou mutation d'acquisition historique. Pas prêt Production.**
