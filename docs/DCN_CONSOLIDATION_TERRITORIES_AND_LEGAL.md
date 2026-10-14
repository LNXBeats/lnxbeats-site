# DCN — territoires et nouveaux documents contractuels

Périmètre local uniquement. Aucun pays LIVE ouvert, aucune mutation prestataire ou Production.

## Fonctionnalités livrées

- `DigitalCountryTaxRule` : registre versionné par pays ISO/subdivision/B2C. 249 lignes initiales `REVIEW_REQUIRED` / `REVIEW`, portée `NONE`, sans taux, taxe ou exemption. Les pays inconnus sont bloqués.
- Statuts `DRAFT`, `REVIEW_REQUIRED`, `APPROVED`, `EXPIRED` ; décision distincte `ALLOW`, `REVIEW`, `BLOCK`. L’expiration est contrôlée au moment de l’action, même sans mise à jour d’un statut stocké.
- Historique append-only : modifier/supprimer une politique est interdit par trigger. Une nouvelle version est nécessaire. Le rôle runtime doit avoir **SELECT seulement** sur ce registre ; aucun écran ni endpoint d’approbation n’est livré.
- Revue probante exigée : fiscalité, juridique, paiement, validateur, référence privée de preuve (pas la correspondance), empreinte, dates, contrat/langue et paramètres fiscaux explicites. La référence d’une preuve n’est pas une preuve d’approbation vérifiée à elle seule.
- États américains et provinces canadiennes obligatoires et contrôlés. Aucun fallback d’une subdivision vers la ligne du pays. Résidence/facturation/indice prestataire contradictoires : revue avant PSP. Aucun IP-only.
- Snapshot immuable par nouvelle commande : politique, version, SHA-256, pays/subdivision, indices déclarés, contrat/langue, expiration, règle fiscale. Revalidation avant confirmation/délivrance dans l’intégration racine. Une politique expirée, remplacée ou contradictoire ne peut accorder silencieusement de nouveaux fichiers.
- Calcul en centimes EUR, arrondi `HALF_UP_CENTS`, mode taxe incluse/exclue explicite. Pas de TVA zéro ou art. 293 B par défaut ; un taux nul doit relever d’une exemption expressément justifiée. Complément à zéro : bloqué en attendant la décision dédiée.

La fixture `LOCAL_QA` est synthétique et en mémoire, jamais insérée par migration, incapable d’autoriser LIVE. Elle exige un mode TEST et une capacité interne explicitement vérifiée par le lanceur local isolé. Les paramètres du navigateur ne peuvent pas l’autoriser. Sa taxe `QA_ONLY` est **sans qualification fiscale réelle**.

## Migration et compatibilité

`20261015030000_digital_country_tax_rules` ajoute le registre, les triggers et `digital_orders.jurisdictionSnapshot` nullable. Aucun ancien achat n’est enrichi rétroactivement : les anciennes commandes conservent `NULL` et leur preuve contractuelle existante. Aucun historique approuvé, facture, avoir, acquisition ou montant historique n’est modifié.

Le rollback applicatif compatible conserve ces objets et leurs traces. Ne pas supprimer le registre, les snapshots ou les données pour revenir en arrière. Les nouvelles commandes doivent être traitées par une version comprenant leurs gardes territoriaux ; sinon fermer les nouvelles opérations et conserver la réconciliation.

## Nouveaux brouillons, anciens acquis préservés

`lib/digital/digital-legal.ts` contient deux documents indépendants :

1. `DIGITAL_MUSIC_TERMS` — CGV catalogue numérique, version `digital-music-cgv-20261014-consolidation-draft-01`.
2. `DIGITAL_PRIVACY_ADDENDUM` — complément ciblé de confidentialité DCN, version `digital-privacy-addendum-20261014-draft-01`.

Statut **DRAFT**, aucun approbateur/date d’approbation/activation. Contenu présenté en Admin pour revue. Il couvre WAV+MP3, ZIP distincts, compte vérifié, complément d’album, paiement serveur, confirmation durable, consentements distincts, garanties de conformité, versions acquises, re-téléchargement, remboursements/avoirs, recours et preuves minimales.

Les documents `APPROVED` de `data/legal.ts` restent inchangés : leurs versions/hashes sont référencés, sans réapprobation ni substitution. La clause de fourniture/rétractation DCN reste proposée ; le paiement seul ne prouve ni remise durable ni perte du droit. Aucun « non remboursable » absolu ni prestation fictive.

### Acquis et provenance exacte

- CM2C, adhésion de trois ans et paiement 48 € du 27/08/2026 : **dossier utilisateur réconcilié** ; le présent lot n’a pas relu Gmail ni la convention PDF. Coordonnées et échéances réutilisées depuis `consumerMediatorInformation`. Aucune nouvelle adhésion proposée.
- EI LNX Beats / SIRET 10687085000018, BNC/micro-BNC et franchise historique : **dossier utilisateur et référentiel existant**, pas une nouvelle validation fiscale de DCN.
- CGV/mentions approuvées du 01/09/2026 : **référentiel versionné existant**, avec `effectiveAt:null` distinct de l’approbation.
- Le dossier fourni n’est pas une approbation juridique/fiscale par territoire et n’ouvre aucun pays.

## Matrice de décisions restantes réellement nouvelles

| Zone/sujet | État DCN | Seule validation nouvelle attendue |
|---|---|---|
| France | REVIEW | Qualification des ventes directes WAV/MP3, articulation BNC/BIC/droits d’auteur, régime TVA applicable à ce produit et mentions nouvelles factures |
| UE hors France | REVIEW/BLOCK | Conditions applicables au seuil transfrontalier, OSS/SME éventuels, preuve client et règles exactes de chaque pays |
| Royaume-Uni | REVIEW/BLOCK | Obligation d’enregistrement du vendeur non établi et règles numériques effectivement applicables |
| États-Unis | REVIEW/BLOCK | État/localité, caractère taxable, nexus et inscription nécessaires ; aucun régime national unique supposé |
| Canada | REVIEW/BLOCK | Province, régime GST/HST/provincial, seuil/conditions et inscriptions nécessaires |
| Australie | REVIEW/BLOCK | GST numérique, conditions/seuil/inscription et preuve client |
| Autres territoires | REVIEW/BLOCK | Règle spécifique, droits musicaux, conditions/langue et prestataire |
| CGV/licence DCN | DRAFT | Formulation personnelle, confirmation durable, rétractation/conformité/fin de service, recours impératifs territoriaux |
| CM2C existant | acquis, portée DCN à confirmer si nécessaire | Couverture sectorielle/territoriale de la convention existante ; pas de nouvelle adhésion |
| Confidentialité DCN | DRAFT | Durées de conservation et preuves fiscales du nouveau produit, transferts internationaux éventuels |

Les seuils et taux cités par les sources du dossier ne sont **pas codés comme règle d’ouverture**. Toute source actuelle non accessible reste `SOURCE_REVIEW_REQUIRED`, sans présumer sa validation. Les pages publiques relues dans le lot racine doivent être citées avec leur résultat/date propres.

### Vendeur direct versus Merchant of Record — étude seulement

| Modèle | Responsabilité à vérifier | Limite du présent lot |
|---|---|---|
| Vente directe Stripe/PayPal | LNX reste vendeur ; fiscalité, inscriptions, contrat client, garanties et facturation par pays à contrôler | Architecture existante conservée, aucun pays LIVE activé |
| Merchant of Record éventuel | Prestataire réellement vendeur contractuel, pays couverts, responsabilité fiscale, frais, versements, contrat client et traitement des remboursements | Aucun prestataire sélectionné, compte créé ou branchement effectué ; décision commerciale ultérieure |

## Preuves locales

Commande exécutée : `node --import tsx --test tests/digital/jurisdictions.test.ts tests/digital/digital-legal.test.ts`.

Résultat : **13 PASS, 0 FAIL**, PGlite isolé en mémoire inclus. La première exécution a échoué sur une coquille du test (`assert.notMatch`, inexistant) ; corrigée en `assert.doesNotMatch`, sans anomalie applicative.

SQL réellement appliqué au PostgreSQL embarqué : 249 lignes, 0 ALLOW, 0 règle fiscale, ancien achat conservé ; refus UPDATE/DELETE politiques, refus modification snapshot, refus ALLOW sans empreinte de preuve. Ce contrôle n’est **pas** présenté comme test effectif du rôle runtime PostgreSQL non propriétaire : celui-ci relève du gate isolé exécuté par le lot racine.

Autres couvertures : FR historique non extrapolée, QA jamais LIVE, UK/AU/pays inconnu bloqués, État/province, B2B refusé, conflits pays, droits/format/PSP, approbations manquantes, taxe sans base refusée, arrondis exacts, crédit excessif/négatif/zéro refusé, changement/expiration de politique après paiement, anciens documents préservés.

### Revue de l’intégration checkout

La revue a reproduit un écart précis : `providerCountryCode:null` du snapshot était propagé comme s’il s’agissait d’un pays prestataire déclaré. Le contrôleur de conflit le refusait, empêchant le rapprochement d’une commande QA normale. Le helper reconstruit désormais explicitement les seuls champs autorisés et omet cet indice quand il est indisponible ; aucune preuve n’est inventée.

La capacité QA vérifie également le profil isolé dans le helper, pas seulement chez son appelant. Les snapshots JSON corrompus falsy (`0`, chaîne vide) ne sont plus assimilés à une acquisition historique ; seuls `null` et `undefined` conservent le parcours legacy.

Commande exécutée : `NODE_OPTIONS=--conditions=react-server node --import tsx --test tests/digital/checkout-jurisdiction.test.ts tests/digital/jurisdictions.test.ts tests/digital/digital-legal.test.ts tests/digital/local-review-security.test.ts` — **22 PASS, 0 FAIL** (inclut les 13 précédents, ne pas additionner). Six nouveaux tests du helper vérifient le round-trip, les flags frauduleux du navigateur, le marchand différent, les profils non isolés, l’expiration/absence et les allowlists de routes. Les trois contrôles antérieurs de sécurité locale restent inclus. Lint ciblé de ces fichiers et diff-check : PASS.

La revalidation territoriale est destinée aux phases checkout/paiement/première délivrance. Une expiration ultérieure de politique ne doit pas, à elle seule, retirer une acquisition déjà délivrée ni empêcher son re-téléchargement : les droits/propriétaire/compte/remboursements et incidents légaux effectifs restent contrôlés séparément.

**DEV_READY** pour le registre/politiques/tests locaux. **LEGAL/FISCAL_REVIEW_REQUIRED** pour toute nouvelle vente réelle. Pas prêt Production.
