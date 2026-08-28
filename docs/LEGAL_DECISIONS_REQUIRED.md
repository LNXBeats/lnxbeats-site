# Registre des décisions juridiques, comptables et logistiques — Phase 4B

Date des décisions propriétaire de cette phase : **2026-08-28**. Une décision `RESOLVED_BY_OWNER` fixe le besoin métier ; elle ne remplace pas la validation d’un texte juridique. Les documents restent `AWAITING_LEGAL_REVIEW`.

| ID | status | decision | source | ownerDecisionDate | legalReviewRequired | implementationStatus |
|---|---|---|---|---|---|---|
| `VAT_AND_INVOICING_STATUS` | `ACCOUNTING_SOURCE_VERIFIED` | Franchise en base de TVA, option d’assujettissement non exercée, aucune TVA collectée ni facturée. | Guichet unique communiqué + BOFiP 2026 | 2026-08-28 | Oui, revalidation avant activation | Snapshot et mention centralisée implémentés en QA |
| `VAT_LEGAL_NOTICE` | `ACCOUNTING_SOURCE_VERIFIED` | Mention exacte : « TVA non applicable, article 293 B du CGI ». | BOI-TVA-DECLA-40-10-20 § 210 | 2026-08-28 | Oui, revalidation fiscale avant activation | Implémenté en constante unique |
| `INVOICE_TRIGGER` | `RESOLVED_BY_OWNER` | Facture uniquement après preuve serveur d’un paiement `SUCCEEDED` / commande `PAID`. | Décision propriétaire Phase 4B | 2026-08-28 | Non pour le principe ; modèle à valider | Implémenté transactionnellement en QA |
| `ACCOUNTING_RETENTION_AND_INVOICE_FORMAT` | `ACCOUNTING_SOURCE_VERIFIED` | Factures, avoirs et pièces comptables conservés dix ans ; séquence unique, chronologique et continue. | Code de commerce L123-22 + Bercy | 2026-08-28 | Oui avant activation | Modèle immuable et séquences implémentés en QA |
| `E_INVOICING_2026_2027` | `ACCOUNTING_SOURCE_VERIFIED` | Réception obligatoire au 01/09/2026 ; émission TPE/PME au 01/09/2027 ; franchise en base incluse ; B2C relevant de l’e-reporting selon champ d’application. | economie.gouv.fr + impots.gouv.fr | 2026-08-28 | Conseil comptable requis | Runbook seulement, aucune intégration fiscale |
| `MUSIC_DELIVERY_DELAY` | `RESOLVED_BY_OWNER` | 7 à 14 jours après paiement confirmé et brief exploitable. | Décision propriétaire Phase 4B | 2026-08-28 | Relecture du libellé | Candidat CGV 2026-02 |
| `MUSIC_REVISION_POLICY` | `RESOLVED_BY_OWNER` | Une retouche raisonnable incluse dans le brief ; changement substantiel = nouvelle demande. | Décision propriétaire Phase 4B | 2026-08-28 | Relecture du périmètre | Candidat CGV 2026-02 |
| `MUSIC_REFERENCE_FILE_RETENTION` | `RESOLVED_BY_OWNER` | Jusqu’à 90 jours après livraison, sauf obligation, litige ou demande justifiée. | Décision propriétaire Phase 4B | 2026-08-28 | Relecture RGPD | Candidat CGV/confidentialité 2026-02 |
| `DELIVERY_COUNTRIES` | `LOGISTICS_RESOLVED` | France métropolitaine uniquement au lancement. | Décision propriétaire Phase 4B | 2026-08-28 | Relecture CGV | Exigence documentée ; moteur Colissimo différé |
| `HANDLING_TIME` | `LOGISTICS_RESOLVED` | Préparation 2 à 3 jours ouvrés après paiement, sauf mention produit explicite. | Décision propriétaire Phase 4B | 2026-08-28 | Relecture CGV | Candidat CGV 2026-02 |
| `COLISSIMO_SIGNATURE_POLICY` | `LOGISTICS_RESOLVED` | Colissimo avec signature uniquement au lancement. | Décision propriétaire Phase 4B | 2026-08-28 | Relecture CGV | Architecture future, non active |
| `RETURN_ADDRESS` | `LOGISTICS_RESOLVED` | LNX Beats, 35 Impasse des Orties, 07370 Ozon, France. | Décision propriétaire Phase 4B | 2026-08-28 | Relecture CGV | Candidat CGV 2026-02 |
| `WHO_PAYS_WITHDRAWAL_RETURN_COSTS` | `LOGISTICS_RESOLVED` | Client pour rétractation de convenance informée ; vendeur lorsque la loi l’impose (défaut, non-conformité, erreur). | Décision propriétaire + Code consommation | 2026-08-28 | Oui | Candidat CGV 2026-02 |
| `SEALED_AUDIO_PRODUCT_POLICY` | `LOGISTICS_RESOLVED` | CD audio expédiés scellés ; garanties légales toujours préservées. | Décision propriétaire Phase 4B | 2026-08-28 | Oui pour l’exception exacte | Candidat CGV 2026-02 |
| `MINIMUM_BILLABLE_WEIGHT_150G` | `LOGISTICS_RESOLVED` | Somme produits × quantité + emballage + protection, puis minimum facturable interne 150 g. | Décision propriétaire Phase 4B | 2026-08-28 | Non | Contrat technique futur seulement |
| `TRACKING_POLICY` | `LOGISTICS_RESOLVED` | Suivi automatique Colissimo avec fallback Admin manuel. | Décision propriétaire Phase 4B | 2026-08-28 | Relecture information client | Contrat technique futur seulement |
| `MUSIC_CONTRACT_CLASSIFICATION` | `LEGAL_REVIEW_REQUIRED` | Qualifier service personnalisé / contenu numérique / combinaison. | Code consommation L221-18/L221-28 | — | Oui, conseil juridique | Non résolu ; activation bloquée |
| `EARLY_PERFORMANCE_WITHDRAWAL_WORDING` | `LEGAL_REVIEW_REQUIRED` | Valider demande expresse, moment et conséquence du commencement anticipé. | Code consommation L221-25/L221-28 | — | Oui, conseil juridique | Non résolu ; activation bloquée |
| `SHOP_CONTRACT_FORMATION_TIME` | `LEGAL_REVIEW_REQUIRED` | Aligner formation du contrat, paiement, confirmation durable et statuts. | Code consommation / e-commerce | — | Oui, conseil juridique | Non résolu ; activation bloquée |
| `SEALED_AUDIO_WITHDRAWAL_EXACT_WORDING` | `LEGAL_REVIEW_REQUIRED` | Limiter strictement l’exception aux enregistrements audio descellés sans écarter les garanties. | Code consommation L221-28 9° | — | Oui, conseil juridique | Non résolu ; activation bloquée |
| `B2B_TERMS_SCOPE` | `RESOLVED_BY_OWNER` | LNX Studio accepte particuliers et professionnels ; les parcours sont distincts, les droits commerciaux restent manuels et contractuels. | Décision propriétaire Phase 4B | 2026-08-28 | Oui pour les clauses finales B2B | Modèle de facture conditionnel préparé ; parcours UI final à valider |
| `COLISSIMO_RATE_POLICY` | `FUTURE_IMPLEMENTATION` | Grilles datées/versionnées, service et paliers, snapshot à la commande ; aucun tarif codé en dur. | Conditions La Poste en vigueur | 2026-08-28 | Relecture à l’intégration | Non implémenté |
| `DELIVERY_ESTIMATE` | `FUTURE_IMPLEMENTATION` | Estimation transport dynamique distincte de la préparation. | Conditions La Poste en vigueur | 2026-08-28 | Relecture à l’intégration | Non implémenté |
| `PACKAGING_PROFILE` | `FUTURE_IMPLEMENTATION` | Emballage/protection administrables avec poids, capacité et règles. | Décision propriétaire Phase 4B | 2026-08-28 | Non | Non implémenté |

## Sources à revérifier le jour de l’approbation

Entités contractantes, adresses, DPA, sous-traitants et mécanismes de transfert Railway, Cloudflare, Resend, Stripe, PayPal et OVHcloud ; coordonnées CM2C ; situation TVA réelle ; conditions Colissimo alors en vigueur.
