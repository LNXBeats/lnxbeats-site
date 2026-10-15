# DCN — décisions commerciales confirmées et limites de leur validation

15 octobre 2026. **Provenance : USER_CONFIRMED dans la conversation ; pas approbation juridique/fiscale inventée.** Ce registre complète les anciennes décisions et ne réécrit ni une acquisition, ni une facture, ni un document déjà approuvé. Tous les nouveaux encaissements **DCN LIVE restent fermés** ; les paiements des autres domaines ne sont pas modifiés.

## Décisions acquises — ne pas les redemander

| Décision | État et portée | Ce qui reste réellement à vérifier |
|---|---|---|
| Licence privée | **USER_CONFIRMED** : écoute, téléchargement et conservation pour usage privé. Diffusion publique, redistribution, publication et exploitation commerciale nécessitent des autorisations séparées | Rédaction des nouvelles CGV/licence DCN, droits impératifs et modalités de consentement. Ce choix ne vaut pas approbation du texte DRAFT |
| Périmètre de lancement | **USER_CONFIRMED** : particuliers en France métropolitaine, Corse comprise. Pas d’ouverture mondiale, outre-mer ou B2B implicite | Mise en œuvre légale de la restriction, qualification fiscale de DCN et preuves proportionnées. `FR-MET` est un marché applicatif interne, pas une qualification ISO ou une approbation globale de `FR` |
| Collaborations | **USER_CONFIRMED** : pas de commercialisation avant vérification des droits d’œuvre/master/contributions/samples, preuves privées Admin et historique conservé | Vérification effective de chaque œuvre réelle et de ses pièces ; une case déclarative ou l’upload seul ne prouve pas une autorisation |
| Changement d’avis | **USER_CONFIRMED** : examen individuel ; pas de remboursement commercial automatique pour ce seul motif après fourniture immédiate ayant légalement entraîné la perte du droit de rétractation | Revue de la rédaction, du commencement effectif, du support durable et des conditions légales. Aucun « non remboursable » absolu |
| Droits légaux | Toujours préservés : rétractation lorsqu’elle subsiste, conformité et autres remboursements/recours imposés par la loi | Les conditions légales ne sont ni déduites du paiement seul, ni remplacées par la politique commerciale |
| Modèle vendeur au lancement | Vente directe LNX sur ce périmètre préparé ; **pas de Merchant of Record pour ce lancement** | Qualification fiscale/juridique et formalités DCN restant déterminantes. Le comparatif MoR antérieur est conservé comme étude, pas comme démarche à relancer |

Restent également acquis : panier numérique distinct du physique, compte actif/e-mail vérifié, WAV+MP3, deux ZIP d’album, versions exactes conservées, absence de remaster automatique et complément calculé sur le net réellement payé. **Aucun tarif de lancement réel n’est fixé ici.** L’EI, le régime BNC/micro-BNC, la franchise historiquement utilisée et CM2C sont documentés : pas de nouvelle constitution ni adhésion.

## Audit ciblé des remboursements existants — aucun nouveau mécanisme financier

Sources lues : `lib/digital/finance.ts`, `finance-providers.ts`, `documents.ts`, `http.ts`, routes Admin/client `[operation]`, composants de remboursement, écran d’achat Admin et `scripts/digital-reconcile.ts`.

1. **Aucun remboursement automatique de changement d’avis identifié.** La route cliente autorise seulement `status`, `reconcile` et le chemin de capture PayPal du paiement déjà engagé ; `refund` n’est pas une opération cliente disponible. Le refus de l’API de remboursement client n’éteint pas le droit de demander un examen ou d’invoquer un recours légal par les moyens de contact appropriés.
2. **Opérateur authentifié et autorisé.** La route de réservation impose `withDigitalApi(..., true)` ; le service relit un Admin actif et vérifié dans la transaction avant toute écriture de remboursement/audit. Une identité cliente ou une ancienne prétention au rôle Admin ne suffit pas. Same-origin, taille de corps, validation stricte, rate limiting et réponses privées restent conservés.
3. **Demande ≠ restitution.** `requestDigitalRefund` réserve uniquement un remboursement `REQUESTED`, avec clé idempotente, montant explicitement confirmé, lignes et motif opérationnel `PRICE_REDUCTION` ou `RESOLUTION`. Elle n’appelle aucun prestataire, ne crée aucun paiement, ne recapture rien et ne génère pas encore un avoir de restitution confirmée.
4. **Exécution séparée.** `execute-refund` est une action Admin distincte avec confirmation du montant, contrôle de la commande et autorisation TEST explicite du candidat actuel. `processDigitalRefund` réclame atomiquement la demande puis enregistre une preuve contrôlée ; le client prestataire utilise la clé idempotente persistante. Le script de réconciliation ne sélectionne que `PENDING` et `REQUIRES_REVIEW`, pas `REQUESTED` : il ne lance donc pas une restitution simplement parce qu’une demande a été enregistrée. Résultat ambigu : `REQUIRES_REVIEW`, puis recherche du résultat réel, jamais nouvelle restitution aveugle.
5. **Facture et avoir séparés.** Une preuve de remboursement réussie peut créer un avoir unique et une notification unique. La facture initiale reste identique. La réduction de prix conserve les droits ; une résolution complète des lignes concernées révoque leur source d’accès, avec historique et documents conservés. Un reçu/webhook dupliqué n’émet pas un second avoir.
6. **Pas de règle légale automatisée nouvelle.** Les états financiers ne décident pas à eux seuls si un client a perdu son droit de rétractation. Un opérateur doit examiner les preuves et le fondement avant une décision commerciale ou légale. Les remboursements/litiges réels contradictoires restent des faits à enregistrer et rapprocher, non des preuves à masquer.

La procédure de réception et traitement des demandes, la rétractation éventuellement applicable et les délais/moyens légaux doivent être correctement décrits dans les nouveaux textes DCN avant lancement. Le formulaire de rétractation historique ne doit pas être présenté sans vérification comme un traitement automatique déjà raccordé aux commandes DCN.

## Tests effectivement exécutés

```sh
NODE_OPTIONS=--conditions=react-server node --import tsx --test tests/digital/commercial-refund-policy.test.ts
```

**9 PASS, 0 FAIL, 0 SKIP.** Les **vrais services** de réservation/exécution/preuve et les **vraies routes HTTP** Admin/client sont exécutés avec dépôts, session et prestataire **doublés en mémoire**. Aucun compte réel, base PostgreSQL ou prestataire externe n’est utilisé ; aucun e-mail n’est transporté. Il ne s’agit pas d’une nouvelle recette Stripe/PayPal ou d’une validation juridique.

- Non-Admin et ancien/faux Admin : refus avant écriture financière/audit ou appel de gateway.
- Demande opérateur : simple réservation ; aucun nouveau paiement/recapture, aucun avoir prématuré.
- Même clé : même demande/audit ; montant contradictoire refusé.
- Réduction confirmée de 200 centimes, puis résolution du solde de 790 centimes d’un album **QA** de 990 : deux avoirs et deux notifications uniques, droits conservés puis révoqués, facture inchangée et historique conservé.
- Doublons de traitement et de preuve : pas de seconde restitution/avoir.
- Timeout : résultat en revue ; reprise par réconciliation seulement, sans deuxième POST de restitution.
- API cliente `refund` : 404, aucune donnée financière écrite.
- Route Admin : client refusé ; Admin peut réserver, mais l’exécution reste refusée sans autorisation externe TEST.
- Origine étrangère : refus avant réservation/exécution.

Les campagnes Stripe/R2/PayPal précédentes ne sont pas rejouées. Aucun changement de service, configuration, permission, flux métier ou état financier existant n’était nécessaire pour matérialiser cette décision commerciale.

**État final de cette préparation : décisions commerciales USER_CONFIRMED ; nouveaux textes DCN DRAFT/non approuvés ; validation fiscale et juridique toujours distincte ; aucune ouverture LIVE et aucune déclaration prêt Production.**
