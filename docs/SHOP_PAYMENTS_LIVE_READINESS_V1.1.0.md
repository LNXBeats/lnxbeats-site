# Boutique V1.1.0 — Release B3 Payments et remboursements Live

## Statut

Release B3 rend le code déployable avec tous les nouveaux gates financiers fermés. Elle ne constitue ni une autorisation de déploiement, ni une activation de la Boutique, ni une autorisation de remboursement. L’état attendu après un futur dark deploy reste : `SHOP_ENABLED=false`, `SHOP_PAYMENTS_ENABLED=false` et `LIVE_REFUNDS_ENABLED=false`.

## États Refund Live

- `OFF` : Payments/Refund Live n’est pas demandé. Aucun ordre de remboursement Live ne peut partir.
- `READY_NOT_ARMED` : le stack Payments Live est cohérent, mais le flag Refund reste fermé.
- `ARMED` : uniquement en Railway Production strict, avec Payments Production armé, au moins un provider Live compatible, `LIVE_REFUNDS_ENABLED=true` et `LIVE_REFUNDS_PRODUCTION_CONFIRM=enable-production-live-refunds`.
- `BLOCKED` : valeur invalide, confirmation manquante ou résiduelle, runtime incorrect, provider incompatible, ou configuration Payments incohérente.

Le flag seul n’autorise rien. Le diagnostic et le preflight exposent l’état et la présence/validité des confirmations sans imprimer leur valeur.

## Autorité et provider

Le serveur relit l’unique `Payment` gagnant. `Payment.provider`, `Payment.mode`, `providerPaymentId`, les montants persistés et la devise EUR déterminent l’opération. L’Admin ou le client ne choisissent jamais le provider : un paiement Stripe se rembourse via Stripe et un paiement PayPal via PayPal. Un paiement TEST/Sandbox ne peut pas atteindre un endpoint Live.

Les remboursements totaux et partiels utilisent des centimes entiers. Le solde remboursable déduit les remboursements confirmés et les tentatives actives. Les verrous PostgreSQL, contraintes uniques, clés locales et clés provider persistantes empêchent une seconde opération logique concurrente.

## Ambiguïté et réconciliation

Après timeout ou acceptation provider potentielle sans preuve persistée, la tentative passe en `REQUIRES_REVIEW`. Une répétition de la demande ou une réconciliation sans `providerRefundId` ne réémet jamais un ordre financier. Avec un identifiant provider connu, la réconciliation effectue uniquement une lecture `retrieve` et applique une preuve cohérente. Toute divergence de provider, identifiant, mode, montant ou devise reste en revue.

Les webhooks signés constituent une preuve provider dédupliquée ; ils ne constituent jamais une autorisation humaine de créer un remboursement. Les litiges, reversals et chargebacks restent des incidents séparés et n’émettent aucun remboursement automatique.

## Boutique, SAV et maintenance

Créer ou approuver un dossier SAV ne déclenche aucun provider. Une décision Admin explicite reste requise pour la mutation financière. En Production, `SHOP_AFTER_SALES_REFUND_PROVIDER=payments` n’est accepté que lorsque la politique Refund Live est `ARMED`; `disabled` reste valide pour le dark deploy.

La maintenance Shop accepte les états `OFF`, `READY_NOT_ARMED` et `ARMED`, mais échoue fermée sur `BLOCKED`. Elle ne crée jamais d’ordre de remboursement. Le suivi Colissimo manuel reste indépendant du gate Refund lorsque sa configuration financière est cohérente.

## Ordre d’activation futur

1. Déployer le code B3 avec Shop, Shop Payments et Live Refunds fermés.
2. Revalider health, migrations, quiet window, files financières, maintenance et notifications en lecture seule.
3. Préparer Stripe Live et PayPal Live sans ouvrir la Boutique.
4. Exécuter le preflight B3 ; toute valeur `BLOCKED` impose l’arrêt.
5. Armer séparément Refund Live avec les deux confirmations exactes et le mode SAV `payments`.
6. Ouvrir ensuite Shop, shipping et Shop Payments uniquement après une autorisation humaine distincte.

## Rollback

Le rollback est non destructif : remettre d’abord `LIVE_REFUNDS_ENABLED=false` et retirer sa confirmation dédiée, puis fermer `SHOP_PAYMENTS_ENABLED` et `SHOP_ENABLED` si nécessaire. Conserver `Payment`, `RefundAttempt`, `ProviderEvent`, factures, avoirs et audits. Ne jamais supprimer une tentative ambiguë pour réessayer.
