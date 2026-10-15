# DCN — préparation France métropolitaine et Corse uniquement

15 octobre 2026 — préparation locale depuis `ee5ace65dff096545cbf1622291e55280cc4d8ae`. **Tous les encaissements DCN LIVE restent fermés. Aucun territoire n’est approuvé, aucune donnée ou configuration Production n’est modifiée.**

Ce plan restreint la préparation opérationnelle au marché métropolitain/Corse ; il ne supprime ni le registre territorial général, ni les preuves mondiales préparées, ni les acquisitions historiques. Les éléments acquis concernant l’EI LNX Beats, le régime BNC/micro-BNC, la franchise historiquement utilisée et CM2C sont conservés. Ils ne constituent pas à eux seuls une approbation du nouveau produit DCN ou de sa fiscalité.

## 1. Périmètre et garde fermé

Le module pur serveur `lib/digital/france-launch-policy.ts` classe des **déclarations**, pas des résidences prouvées :

- Pays exactement `FR` ; cinq chiffres ASCII, sans trim ni espace, caractère Unicode, suffixe ou retour à la ligne.
- Préfixes de département `01` à `95`, dont `20` pour la Corse (`20000` à `20999`). Les zéros initiaux sont préservés.
- Rejet des préfixes `00`, `96`, `97`, `98`, `99`, donc notamment les codes ultramarins, Monaco `98000` et les codes spéciaux/internationaux de ce périmètre. Aucun repli sur un simple code pays `FR`.
- Codes de résidence et de facturation contrôlés séparément ; ils peuvent différer entre deux localités métropolitaines/Corse. Une facturation `97100` n’est jamais sauvée par une résidence `75001`.
- `CEDEX` déclaré est refusé. **Un code numérique tel que `75050` peut avoir une apparence métropolitaine sans prouver une adresse ordinaire** : la syntaxe seule reste `PREPARED`, jamais `residenceVerified=true`. La preuve indépendante devra confirmer le routage `ORDINARY` ; `UNKNOWN` ou `CEDEX` dans cette preuve bloque.

La classification ne remplace pas une base officielle des adresses/codes postaux et ne démontre ni l’existence d’une adresse précise, ni son usage réel par le client, ni l’absence de CEDEX. Aucune adresse n’est géocodée, aucune API n’est consultée et aucun système KYC n’est ajouté.

## 2. Provenance d’une preuve — contrat d’intégration, pas collecte exécutée

Une déclaration conforme sans preuve indépendante produit :

```text
status = PREPARED
residenceVerified = false
paymentAllowed = false
code = FRANCE_INDEPENDENT_RESIDENCE_PROOF_REQUIRED
```

Le callback serveur `DigitalFranceResidenceRepository(subjectUserId)` doit charger **le dernier** événement append-only `FR_RESIDENCE_REVIEWED` pour l’utilisateur authentifié, tri `createdAt`, puis `id`. Une entrée plus récente `REVIEW` ou `REVOKED` ne permet jamais de reprendre une ancienne entrée `VERIFIED`.

Contrat de la revue chargée :

- identifiant de l’événement et nature exacte ; utilisateur bénéficiaire ; identifiant de l’acteur ;
- acteur relu fraîchement en base : même identifiant, `ADMIN`, `ACTIVE`, e-mail vérifié ;
- état `VERIFIED` / `REVIEW` / `REVOKED` ;
- pays `FR`, code de résidence correspondant, routage postal `ORDINARY` ;
- nature `INDEPENDENT_RESIDENCE_EVIDENCE`, référence privée `private:…` et SHA-256 de la preuve ;
- date de revue, date réelle de création, échéance non dépassée ;
- hash canonique des champs immuables, recontrôlé lors de l’évaluation.

Le hash n’est **pas** une signature et n’établit pas la provenance : tout navigateur peut calculer un hash public. La provenance doit venir exclusivement du chargement serveur dans le journal append-only existant et de l’acteur effectivement relu en base. Un objet API comportant les mêmes champs ou un booléen client `verified` n’est pas une preuve ; ces champs ne font pas partie du parseur déclaratif.

Le module ne fabrique aucun événement, ne vérifie aucun document en prétendant l’avoir lu, ne crée aucun formulaire d’approbation et n’ajoute aucune clé HMAC. Le stockage éventuel reste privé ; la commande n’emporte ni le document source ni son chemin privé complet. IP seule, pays de carte, nationalité et deuxième déclaration du même formulaire ne sont pas assimilés à une revue indépendante de résidence.

**Manque précis actuellement documenté :** aucune source indépendante collectée/revue ni aucun événement `FR_RESIDENCE_REVIEWED` réel n’a été établi par ce lot. Il reste à définir la source proportionnée et admissible, sa conservation et sa revue selon les exigences fiscales/juridiques retenues pour DCN. Le callback et les tests démontrent uniquement le contrat d’intégration. La présence d’un futur champ de prestataire ne suffira pas si sa provenance et sa signification ne sont pas vérifiables côté serveur.

## 3. Liaison immuable de la commande

Une revue serveur valide peut donner `residenceVerified=true`, mais le résultat global reste **PREPARED / paymentAllowed=false** : les approbations fiscales, juridiques, paiement et prix sont des gates séparés, non accordés ici.

Le snapshot minimal proposé sous `jurisdictionSnapshot.franceResidence` contient :

```text
policy / policyHash / territory=METROPOLITAN_CORSICA
subjectUserId / countryCode=FR
residencePostalCode / billingPostalCode / postalRouting=ORDINARY
reviewEventId / reviewRecordHash / reviewedAt / expiresAt
```

Le snapshot est relu et comparé à la revue fraîche avant le paiement/la première fourniture lorsque l’intégration le requiert. Changement d’utilisateur, de code, d’événement, de hash, révocation ou expiration => revue/blocage, jamais attribution silencieuse. Le callback ne fait aucun retry ni repli vers une entrée antérieure si le dépôt est indisponible.

Les anciens snapshots ne possédant pas cette politique France restent historiques ; ils ne doivent pas être réécrits ou privés rétroactivement de leurs téléchargements pour la seule absence d’un nouveau champ. Le raccordement aux nouveaux checkouts et à la première fourniture doit préserver ce traitement séparé des droits déjà délivrés.

## 4. Proposition de ligne territoriale DRAFT

`DIGITAL_FRANCE_LAUNCH_DRAFT_RULE` est une **valeur de planification en mémoire**, non insérée :

```text
countryCode = FR
subdivisionCode = FR-MET
version = 1 (à rapprocher de l’état réel de ce slot avant toute insertion future)
status = DRAFT
decision = REVIEW
approvalScope = NONE
fiscalApproved / legalApproved / paymentApproved = false
taxRule / termsVersion / evidenceReference = null
notes.territory = METROPOLITAN_CORSICA
```

`FR-MET` est un **slot applicatif interne**, compatible avec la forme du registre existant, pas un code ISO officiel ni une preuve de résidence. Il ne faut pas utiliser la ligne générale `FR` pour couvrir implicitement l’outre-mer. Les notes documentent l’identifiant/hash de politique et le futur binding, mais ne remplacent pas le contrôle effectif du snapshot : le hash actuel du registre général n’inclut pas les notes.

L’identifiant d’exemple est explicitement un identifiant de planification ; aucune migration, DDL, insertion ou approbation ne découle de cette constante. Les tests vérifient qu’elle ne produit `ALLOW` ni en TEST ni en LIVE. Aucun taux de TVA n’est présumé, et le candidat n’applique pas automatiquement la franchise historique au nouveau DCN.

## 5. Tests locaux ciblés réellement exécutés

```sh
NODE_OPTIONS=--conditions=react-server node --import tsx --test tests/digital/france-launch.test.ts
./node_modules/.bin/eslint lib/digital/france-launch-policy.ts tests/digital/france-launch.test.ts
git diff --check
```

**12 PASS, 0 FAIL, 0 SKIP** ; lint ciblé et diff-check PASS. Tests purs avec preuves synthétiques injectées, **aucune preuve utilisateur ou prestataire réelle validée** : limites métropole/Corse, outre-mer/Monaco/CEDEX, whitespace, champs client d’approbation refusés, résidence/facturation distinctes, acteur/admin et propriétaire, intégrité/dates/échéance, révocation, absence de repli, dépôt indisponible, snapshots et DRAFT non autorisant.

Le raccordement au dépôt réel et les tests d’intégration associés sont distincts de cette campagne pure. Aucun appel Stripe/PayPal/R2, aucune installation, nouvelle donnée réelle, modification Production/Railway/OVH, push, merge ou déploiement.

## 6. Avant une autorisation commerciale réelle

1. Validation de la qualification fiscale et juridique du téléchargement DCN et du complément pour ce périmètre précis ; ne pas reconstruire l’EI ni CM2C.
2. Choix proportionné et vérifiable de la source de résidence et de la procédure de revue/conservation ; pas de collecte d’identité inutile par défaut.
3. Textes DCN, consentements et justificatifs approuvés/versionnés pour ce périmètre ; tarifs réels validés séparément.
4. Raccordement serveur des nouveaux checkouts et de la première fourniture, journal append-only et snapshot, avec tests fail-closed et préservation des historiques.
5. Seulement après une autorisation de release distincte : éventuelle ligne/version approuvée du registre et gates techniques habituels. Aucun changement de pays ou d’ouverture n’est accordé dans ce document.

**État : PREPARED, approbations et preuves indépendantes manquantes ; aucun DCN LIVE ouvert. Pas prêt Production.**

## 7. Raccordement local livré dans le même lot

`lib/digital/france-residence-service.ts` charge désormais le dernier événement depuis le journal existant et relit l'acteur en base. Le parseur navigateur ne reçoit que les déclarations ; les identifiants d'événement, dates de création et acteur proviennent du dépôt serveur. Les nouveaux parcours non simulés réservent exclusivement le slot interne `FR-MET`, sans repli FR général ; la preuve minimale est liée au propriétaire et revérifiée avant capture, confirmation et première fourniture. Les commandes anciennes et re-téléchargements restent séparés.

Sept tests locaux supplémentaires dans `tests/digital/france-checkout.test.ts` couvrent ce raccordement avec des doubles de dépôt : absence de preuve, entrée révoquée la plus récente, acteur non fiable dans le JSON, propriétaire, intégrité et refus avant commande/appel prestataire. Ils font partie de la campagne ciblée consolidée, sans être additionnés une seconde fois. **Aucune émission de preuve réelle ni workflow d'examen de résidence n'est ajouté.** La source indépendante et sa procédure restent donc les travaux opérationnels manquants ; le contrôleur ne constitue pas une autorisation commerciale.
