# Runbook de publication juridique Boutique

## Interdit pendant Phase 4

- aucune version candidate `ACTIVE` ;
- `SHOP_LEGAL_READY=false`, `SHOP_ENABLED=false`, `SHOP_PAYMENTS_ENABLED=false` ;
- aucune migration Production, aucun paiement ou e-mail réel.

## Séquence future contrôlée

1. Valider toutes les décisions LEGAL/ACCOUNTING/LOGISTICS.
2. Relire les sources et contrats des sous-traitants.
3. Figer mentions, CGV musique, CGV Boutique, confidentialité et notice de rétractation.
4. Enregistrer approbateur, référence, hash et date d’effet.
5. Vérifier backup PostgreSQL et PITR.
6. Appliquer la migration additive avec gates fermés.
7. Déployer les pages candidates toujours sans Shop/paiements.
8. QA desktop/mobile/impression, CGV et rétractation.
9. Valider l’envoi e-mail durable et l’archive Compte.
10. Tester acceptation non précochée, version/hash, CTA obligation de paiement et information précontractuelle.
11. Valider paiements Test/Sandbox, livraison et retours.
12. Activer `SHOP_LEGAL_READY` sur une version `APPROVED`, puis paiements et Shop dans cet ordre, sur autorisations séparées.
13. Monitorer et conserver un rollback qui ne supprime aucune preuve ni migration.

Les webhooks de paiements historiques doivent rester réconciliables même lorsque les gates de nouveaux Checkout sont fermés.
