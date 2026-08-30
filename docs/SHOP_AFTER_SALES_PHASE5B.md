# SAV Boutique — fondation Phase 5B

## Portée

La Phase 5B prépare uniquement un workflow local et audité de demande SAV pour les `ShopOrder` déjà payées. Le garde `SHOP_AFTER_SALES_ENABLED` est fermé par défaut et ne peut s’ouvrir que sur l’instance PostgreSQL Prisma Dev Phase 5B, l’origine loopback `127.0.0.1:31776`, les transports capture et le faux fournisseur de remboursement. Railway, les bases distantes, Stripe, PayPal, Resend et R2 sont explicitement refusés.

## Machine d’état

`REQUESTED → UNDER_REVIEW → APPROVED/AWAITING_RETURN/REJECTED → RETURN_RECEIVED → INSPECTED → REFUND_PENDING → REFUNDED → CLOSED`.

Une demande peut être annulée par son propriétaire uniquement depuis `REQUESTED`. Une acceptation sans retour physique peut passer d’`APPROVED` à `REFUND_PENDING`. Les transitions sont validées côté serveur et chaque mutation sensible crée un `ShopReturnAuditEvent` idempotent.

## Quantités et autorité serveur

Chaque ligne conserve le titre, le prix unitaire et la devise historiques de `ShopOrderItem`. Les quantités commandée, demandée, autorisée, reçue, remboursable, remboursée, restockable et restockée sont distinctes et bornées. Un trigger PostgreSQL verrouille la ligne achat et interdit que plusieurs dossiers actifs dépassent la quantité achetée. Le navigateur ne fournit jamais un montant de remboursement.

Le remboursement articles est calculé par `prix unitaire historique × quantité remboursable`. L’expédition est une décision Admin explicite limitée à `NONE` ou `FULL` dans le banc QA. Cette alternative technique ne fixe aucune politique juridique générale.

## Remboursement, avoir et stock

Un remboursement cible l’unique `Payment` gagnant `TEST`, utilise une clé fournisseur stable et réutilise `RefundAttempt`. Un résultat ambigu devient `REQUIRES_REVIEW` et n’est jamais relancé aveuglément. Un succès vérifié met à jour le paiement, crée au plus un avoir lié au dossier et enfile au plus une notification client.

`REFUND != RESTOCK` est un invariant. Le succès du remboursement ne modifie jamais `Product.stock`. Après inspection, une action Admin séparée peut réintégrer uniquement la quantité marquée `RESTOCKABLE`; une clé unique par dossier/produit rend le ledger `ProductStockAdjustment` exactly-once.

## Accès et confidentialité

Le membre charge les dossiers par `userId` et `requestNumber`; connaître une référence ne suffit pas. L’Admin seul décide, reçoit, inspecte, rembourse, réconcilie, restocke et clôture. Les formulaires mutatifs exigent session, rôle, origine identique et confirmation explicite. Les notifications utilisent l’outbox existante et ne contiennent ni payload fournisseur, ni donnée bancaire, ni secret.

## Limites assumées

- aucune API transporteur et aucune étiquette retour ;
- aucun remboursement réel ;
- aucun renvoi ou échange automatique ;
- aucune activation d’un texte juridique candidat ;
- aucun calcul automatique des frais de retour ou de la part d’expédition remboursable ;
- aucun lien automatique avec une rétractation : le champ existe, mais le rattachement exige une décision explicite future.

Les décisions juridiques et comptables ouvertes sont suivies dans [`LEGAL_DECISIONS_REQUIRED.md`](LEGAL_DECISIONS_REQUIRED.md).

## Rollback technique

Le code peut être désarmé en laissant `SHOP_AFTER_SALES_ENABLED=false`. La migration est additive et les tables/audits restent lisibles. Ne jamais supprimer les dossiers, avoirs ou ledgers de stock pour effectuer un rollback applicatif. Aucun `migrate reset` n’est autorisé sur un environnement persistant.
