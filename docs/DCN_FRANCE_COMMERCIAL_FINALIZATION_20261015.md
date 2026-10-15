# Finalisation locale du commerce musical DCN France

Le parcours France a progressé sur quatre points visibles et fonctionnels : prévisualisation privée de l’édition depuis l’Admin, complément gratuit lorsque les crédits couvrent l’album, équivalences explicitement administrées entre masters et conditions France intégralement liées à la confirmation. Le candidat est compilé et utilisable localement. **Il n’est pas prêt Production** : nouveaux documents, remise durable, fiscalité/social, données de résidence et catalogue réel restent à valider, puis les frontières techniques TEST-only devront évoluer dans un lot autorisé.

La branche reste `feature/dcn-1-0`, issue de `40f191127e578c74a4724b623a41cbef5b911002` (tree `269704467b2d0431970278442006307971bb3ba5`). Aucun fetch, push, merge, déploiement ou accès Production n’a été effectué. Le SHA/tree final et l’état Git sont dans `FINAL_REVISION.json` du ZIP et dans la restitution de conversation ; ce fichier ne peut pas contenir récursivement le hash de son propre commit.

## Fonctionnalités terminées localement

### Album et Administration

L’import impose une association fichier → piste explicite, bloque les doublons et les lots incomplets, permet de choisir le début de l’extrait à la milliseconde et préserve chaque version. Changer le début d’un extrait sur le même WAV crée une nouvelle révision additive avec droits en attente ; les anciens masters et leur approbation ne sont pas réécrits. Le worker peut être exécuté sur un `uploadId` précis sans reprendre d’autres imports.

La fiche Admin montre la cover, les métadonnées, la composition vendue, les versions, les prix et disponibilités, puis permet d’écouter l’extrait avant publication. Les routes de prévisualisation sont authentifiées, sans cache partagé et refusent les fichiers complets. Aucun prix par défaut n’a été ajouté. Le [guide Admin](DCN_ADMIN_PREPARATION_DRAFT_20261015.md) complète le [premier import réel](DCN_FIRST_REAL_ALBUM_LAUNCH.md) ; aucun véritable album n’a été importé.

### Compléter l’album et conserver les acquisitions

Le calcul serveur reprend les sommes admissibles réellement payées et non remboursées, dans la même devise et pour le propriétaire concerné. Les crédits sont réservés une seule fois ; prix, composition, master et sources sont revérifiés. Les promotions non répartissables et autres situations ambiguës restent bloquées avec un lien `/contact`, sans remise arbitraire.

Un complément à 0 € produit une attribution `GRANTED`, des droits versionnés, une confirmation contractuelle et son audit. Il ne crée ni prestataire, ni tentative financière, ni facture de paiement fictif. Le crédit appliqué est plafonné au prix de l’album ; le surplus ne devient ni porte-monnaie ni remboursement. Concurrence même clé ou clés distinctes : une seule attribution est autorisée. La remise durable et l’accusé restent requis avant fourniture, comme pour les nouveaux achats payants.

Les équivalences source → cible sont administrables avec justification privée, empreinte, attestation, décision courante et journal append-only. Elles sont limitées aux versions d’une **même piste canonique** ; pas d’équivalence inverse, transitive, par titre ou par ressemblance du fichier. Une révocation bloque un nouvel usage mais ne réécrit pas les acquisitions figées. Les pistes d’identifiants différents restent en revue manuelle : leur rapprochement n’est pas livré. L’attribution discrétionnaire d’une nouvelle édition n’est pas automatisée ni proposée comme un cadeau implicite.

WAV, MP3 et les deux ZIP restent liés au contenu acquis. Les renouvellements d’autorisation n’ont pas de plafond arbitraire ; chaque requête conserve les contrôles de compte, droits, états financiers et média. Le rachat après remboursement intégral et les cas de montants, remboursements, prix et compositions déjà couverts sont préservés ; aucune campagne Stripe, PayPal ou R2 n’a été relancée.

### Conditions et preuves France

Les nouvelles commandes QA utilisent `digital-music-france-cgv-20261015-draft-02`. Texte intégral, sections, version, trois choix distincts, horodatage UTC et empreintes sont figés côté serveur puis liés à la confirmation. Les quinze paragraphes de l’encadré de garantie sont présents dans la page et le PDF. Les contrats et reprises historiques gardent leur version ; aucune CGV d’une autre activité n’est modifiée.

Le parcours de rétractation et ses accusés existants sont réutilisés, sans remboursement ou retrait d’accès automatique. Rétractation, non-conformité et geste commercial restent distincts. Le [rapport contractuel](DCN_FRANCE_CONTRACT_REVIEW_20261015.md), le texte exact QA et l’exemple PDF sont inclus. Les anciens rapports décrivant `draft-01`, un encadré absent ou ces fonctions encore manquantes restent historiques : le présent lot les remplace uniquement sur ces points.

## Vérifications réellement exécutées

Les résultats ci-dessous se chevauchent : ils ne sont pas additionnés pour fabriquer un total de tests uniques.

| Périmètre | Résultat | Preuve et environnement |
| --- | --- | --- |
| Passage final des fonctions affectées | 129 PASS, 0 FAIL, 0 SKIP | 16 fichiers, tests de politiques/services avec dépôts et prestataires doublés ; `targeted-tests.json` |
| Passage avant équivalences et contact | 188 PASS | Preuve conservée, non répétée intégralement ; `pre-equivalence-targeted-tests.json` |
| Admin, import et portée des jobs | 25 PASS | Politiques et doubles locaux, détaillés dans le guide |
| Audio et ZIP physiques locaux | 8 PASS | FFmpeg/FFprobe, fichiers synthétiques, pas R2 distant |
| Import et routes privées intégrés | 10 PASS | PostgreSQL non propriétaire, stockage réel local, vrais handlers Request/Response |
| Attribution gratuite intégrée | 9 PASS | PostgreSQL réel, races, PDF/accusé, e-mails capturés, WAV/MP3/deux ZIP et conservation des historiques |
| Équivalences et verrous | 4 PASS | PostgreSQL réel : défaut fermé, approbation exacte, crédit SQL, révocation concurrente et première fourniture refusée |
| Admin équivalences | 6 PASS | Vrais handlers/auth/PG : refus, idempotence, décision périmée, projection privée et historique intact |
| Contrat et remise France | 71 PASS | Passage contractuel du sous-lot, doubles locaux, non ajouté au passage final |
| HTTP du candidat compilé | 5 PASS | Health 200, conditions 200, panier 200, checkout anonyme 307 vers connexion, brouillon public 404 |
| Navigateur local | PASS ciblé | Lecture/pause réelle d’un extrait de 52,976 s, paire V1→V2 révoquée, captures desktop 1440 et mobile 390 sans débordement |
| Prisma, lint, typecheck, builds Web et worker DCN, diff-check | PASS | Commandes et sorties dans `final-checks.json` et les logs ; lint conserve quatre avertissements préexistants hors code du lot |
| Scan secrets et contenu du ZIP | PASS après génération | Code modifié et textes livrés, valeurs privées comparées en mémoire ; `security-scan.json` |

Commandes finales : `node scripts/digital-france-commercial-checks.mjs`, puis `node scripts/digital-france-commercial-smoke.mjs`. Le premier sélectionne seulement les tests affectés et exécute `prisma validate`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run dcn:worker:build` et `git diff --check`. Aucun changement de dépendance ou de schéma Prisma : ni installation ni génération inutile, ni nouvel audit réseau de dépendances. Les scripts d’upgrade/runtime documentent leurs commandes ; ne pas les relancer sur une base déjà préparée pour répéter une preuve.

Les logs livrés ont leurs retours chariot et espaces de fin de ligne normalisés ; leur contenu et leurs résultats ne sont pas changés. Le diff est également vérifié après indexation des nouvelles preuves, pour inclure les fichiers précédemment non suivis.

Les premières tentatives restent visibles : assertion de test checkout obsolète puis corrigée, annotation TypeScript du harnais corrigée, fixtures audio anciennes volontairement refusées, deux archives de tentative en `REQUIRES_REVIEW` après le plafond mémoire inchangé. Le harnais final utilise le worker ZIP séparé et passe ; aucune limite mémoire n’a été affaiblie. Les fixtures et documents de ces tentatives sont conservés.

Le portail `/admin` général rencontre une ACL locale manquante sur `creations` après connexion, avec erreur serveur/React 441. La page Admin musique directe fonctionne ; aucun droit d’un autre domaine n’a été ajouté pour masquer cette limite QA. Les captures de ce lot sont issues du navigateur intégré local, **pas d’une nouvelle recette Safari physique**. Safari Mac antérieur reste PASS dans son périmètre ; iPhone reste NOT_RUN, facultatif différé.

## Sauvegarde et migrations locales

Une sauvegarde fraîche de `lnx_dcn_final_paths_test_20261015` a été chiffrée AES-256-GCM avec clé séparée, vérifiée par SHA-256 puis réellement restaurée vers la nouvelle copie `lnx_dcn_france_commercial_test_20261015`, sur `127.0.0.1:55473`. Les 106 tables historiques ont conservé leurs canaris. Les treize contrôles du rôle non propriétaire `dcn_runtime_a` sont PASS ; ACL des autres domaines inchangées. La base source n’a subi aucune mutation.

| Migration additive appliquée à la copie uniquement | SHA-256 |
| --- | --- |
| `20261015050000_digital_free_completion` | `6077e2ebd6cb63fb30ecb786673446069857ed6791dcb3b275f035388c3d21bc` |
| `20261015060000_digital_master_equivalence` | `807c260537fe9bb7b41676ae52e411b92cf58e375e74439d79ba7152e40406f4` |

La seconde mise à niveau a réutilisé la copie restaurée, sans nouvel export inutile. Chaque migration a préservé données et privilèges ; aucune migration historique n’a été éditée. Le trigger vérifie les références de preuve et les contraintes SQL ; la fraîcheur de la dernière décision et la cohérence commerciale complète restent aussi contrôlées par l’application. Le runtime est une frontière de confiance, pas un client SQL hostile.

La clé, l’archive de base, les profils et fichiers privés restent hors Git et hors ZIP. Cette restauration QA **n’est pas un backup Production**. Le [runbook de mise en service](DCN_FRANCE_PRODUCTION_RUNBOOK_20261015.md) prévoit la future sauvegarde Production, l’upgrade exact, les ACL et un rollback sachant lire `GRANTED` et les preuves d’équivalence sans effacer d’opération.

## Ce qui reste avant le lancement

1. **Juridique et données** : approuver uniquement les nouveaux textes DCN, l’encadré applicable, les consentements, la remise réelle sur support durable et le commencement de fourniture, la résidence/limitation territoriale, l’information/base/durées/accès/transferts des données. Vérifier la couverture du téléchargement dans CM2C existant, sans nouvelle adhésion automatique.
2. **Fiscal et social** : utiliser le [dossier ciblé](DCN_FRANCE_COMMERCIAL_FISCAL_DOSSIER_20261015.md), distinguant SACEM, DistroKid, téléchargement direct et collaborations. Confirmer qualification BNC/social, agrégats, franchise/mention, Corse et hors franchise, factures/avoirs, complément gratuit et obligations électroniques. Aucune inscription, déclaration, taux ou règle territoriale `ALLOW` n’a été créée.
3. **Vrai catalogue** : LNX fournit ses masters/covers, preuves de droits et prix choisis ; importer une édition privée, écouter tous les extraits, approuver les versions exactes puis prévisualiser. Aucun prix réel ou remaster cadeau n’est déduit des fixtures.
4. **Technique LIVE** : les passerelles, documents/notifications et nouvelles capacités restent TEST/local-only, e-mails capturés, paiements externes fermés. Un lot autorisé doit préparer leurs contrôles LIVE, transport durable, numérotation définitive et comptes/webhooks DCN distincts avant l’ouverture. Un simple flag ne suffit pas. Définir les seules recettes impactées puis autoriser la promotion séparément.

Aucune nouvelle décision déjà approuvée n’est redemandée. Les cas d’éditions à identifiants de piste différents et l’interface de cadeau discrétionnaire restent des extensions éventuelles, pas des comportements automatiques du lancement.

## Utiliser la démonstration et transmettre le dossier

Depuis `/Users/lnxbeats/.codex/worktrees/dcn-1-0/lnxbeats-site-v1` :

```sh
npm run dcn:local:built -- commercial-france
```

L’application écoute uniquement `http://127.0.0.1:3140`, PostgreSQL reste en loopback sur `55473`. Le profil privé QA déjà préparé est nécessaire ; aucun secret n’est transmis. Après la connexion QA normale, ouvrir directement `/admin/musique/dcn-edition-privee-9d063091-fe2e-432a-bdae-53dd46988e2f#edition-preview`. Le serveur compilé est laissé disponible. Ne pas lancer le worker global pour une simple revue ; les fixtures ont utilisé des jobs ciblés.

Le ZIP contient un `index.html` hors ligne, les rapports actuels et leurs références locales utiles, le texte DRAFT exact, les exemples PDF/e-mails QA, les captures, les migrations et preuves expurgées. `MANIFEST_SHA256.json` vérifie chaque fichier ; l’ouverture et les empreintes sont contrôlées. Il ne contient ni secret, base, justificatif privé de droits ni audio complet. Les exemples QA ne sont ni des factures LIVE ni une approbation juridique.

Coût nouveau : 0 €. Aucun prestataire, e-mail réel, Production, Railway, OVH, DNS, Cloudflare ou paiement LIVE utilisé. Le dossier OVH Free 100M demeure BLOCKED. Les fonctionnalités, fichiers et données hors DCN, ainsi que les preuves Stripe/PayPal/R2/Safari déjà acquises, sont conservés.
