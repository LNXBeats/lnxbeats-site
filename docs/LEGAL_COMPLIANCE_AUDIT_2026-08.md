# Audit de conformité juridique — août 2026

## Conclusion

La Phase 4 remplace trois placeholders par cinq documents structurés **candidats**, ajoute une fondation de versioning, une déclaration de rétractation en ligne et la preuve de son accusé. Aucun document n’est `APPROVED` ou `ACTIVE`. La Boutique et ses paiements restent fermés en Production.

## État avant

- pages mentions/CGV/confidentialité incomplètes et non indexées ;
- une seule page CGV pour musique et Boutique ;
- version `shop-cgv-phase3-qa-v1` exclusivement QA ;
- snapshot de CGV déjà présent sur `ShopOrder` et snapshot d’usage personnel sur `Order` ;
- absence de registre de documents juridiques et de demande de rétractation persistante ;
- case CGV Shop non précochée et garde serveur déjà présentes ;
- bouton de paiement sans mention visible d’obligation de paiement ;
- aucun lien ODR obsolète trouvé ;
- cookies de session/sécurité uniquement et aucun embed tiers trouvé dans le rendu audité.

## Changements techniques candidats

- modèles additifs `LegalDocumentVersion` et `ConsumerWithdrawalRequest` ;
- contraintes SQL sur hash, statut d’approbation, parent de contrat, normalisation e-mail et accusé ;
- registre de cinq versions `AWAITING_LEGAL_REVIEW` calculées depuis leur contenu ;
- pages distinctes `/cgv/creation-musicale` et `/cgv/boutique` ;
- `/retractation` en deux étapes, payload fermé, contrôle d’origine, rate limit haché, anti-énumération et accusé cookie `HttpOnly` ;
- aucun remboursement ni mutation de paiement ;
- libellé Shop « commande avec obligation de paiement » visible dans le CTA ;
- footer, robots privés, styles responsive et impression.

## Gates non fermés

Les décisions recensées dans `LEGAL_DECISIONS_REQUIRED.md` interdisent toute activation Production. L’accusé est persisté et consultable ; l’envoi e-mail transactionnel devra être relié à l’outbox et validé avant activation juridique. Les pages candidates demeurent `noindex` tant qu’aucune version n’est active.
