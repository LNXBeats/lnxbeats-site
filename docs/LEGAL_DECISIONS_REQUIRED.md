# Décisions humaines requises

Ces décisions sont des gates. Le code ne doit pas leur attribuer de valeur implicite.

## LEGAL_DECISION_REQUIRED

| Code | Question à trancher |
|---|---|
| `MUSIC_CONTRACT_CLASSIFICATION` | Service, contenu numérique, prestation personnalisée ou combinaison ? |
| `EARLY_PERFORMANCE_OF_MUSIC_SERVICE` | Forme et moment du consentement au commencement anticipé et reconnaissance de ses conséquences. |
| `MUSIC_DELIVERY_DELAY` | Délai contractuel et point de départ d’un brief exploitable. |
| `MUSIC_REVISION_POLICY` | Définition, nombre et délai des retouches incluses. |
| `SHOP_CONTRACT_FORMATION_TIME` | Moment de formation : acceptation, paiement, confirmation ou autre étape. |
| `SEALED_AUDIO_PRODUCT_POLICY` | Produits scellés concernés, preuve de scellement et traitement des défauts. |
| `WHO_PAYS_WITHDRAWAL_RETURN_COSTS` | Frais de retour d’une rétractation valide, distincts d’une non-conformité. |
| `MUSIC_REFERENCE_FILE_RETENTION` | Durée de conservation puis purge des références privées. |
| `B2B_TERMS_SCOPE` | Conditions B2B séparées et exclusions du régime consommateur. |

## ACCOUNTING_DECISION_REQUIRED

| Code | Question à trancher |
|---|---|
| `VAT_AND_INVOICING_STATUS` | Régime TVA effectif, franchise, mentions et présentation HT/TTC. |
| `ACCOUNTING_RETENTION_AND_INVOICE_FORMAT` | Format de facture, numérotation, archivage et durées comptables. |

## LOGISTICS_DECISION_REQUIRED

| Code | Question à trancher |
|---|---|
| `DELIVERY_COUNTRIES` | Pays réellement desservis. |
| `HANDLING_TIME` | Délai de préparation. |
| `DELIVERY_ESTIMATE` | Estimation par destination/service. |
| `RETURN_ADDRESS` | Adresse opérationnelle de retour. |
| `MINIMUM_BILLABLE_WEIGHT_150G` | Minimum interne de calcul/palier. |
| `COLISSIMO_RATE_POLICY` | Source, fréquence, versioning et snapshot des tarifs. |
| `COLISSIMO_SIGNATURE_POLICY` | Seuils et produits nécessitant une signature. |
| `TRACKING_POLICY` | Création, synchronisation, fallback manuel et information client. |

## SOURCE_RECHECK_REQUIRED

Les entités contractantes, adresses, DPA, sous-traitants et mécanismes de transfert Railway, Cloudflare, Resend, Stripe, PayPal et OVHcloud doivent être relus dans les contrats réellement souscrits. Les coordonnées CM2C doivent être revérifiées le jour de la publication.
