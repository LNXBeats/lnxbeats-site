# Backfill contrôlé des factures historiques

Cette procédure est limitée de façon immuable à `LNX-2026-000003`, `LNX-2026-000007` et `LNX-2026-000011`.

Politique validée : la date d’émission est la date réelle d’exécution en Europe/Paris. La date historique `paidAt` reste conservée dans le snapshot financier de la facture. Aucune facture n’est antidatée.

## Barrières

- Le dry-run utilise une transaction PostgreSQL `READ ONLY` et ne contient ni `nextval`, ni `setval`, ni écriture.
- L’APPLY exige le runtime Railway Production Web exact, les remboursements Live désarmés, la Boutique fermée et le canal client validé.
- L’APPLY n’accepte aucun numéro de commande en argument : la whitelist de trois commandes est compilée dans le runner.
- Les trois commandes sont verrouillées et revalidées dans une transaction `SERIALIZABLE` avant le premier appel au moteur de facturation.
- L’ordre d’allocation est `paidAt` croissant, puis `orderNumber`.
- Le runner appelle uniquement `issueInvoiceForPayment`. Il ne crée ni avoir, ni notification, ni RefundAttempt et ne contacte aucun provider.
- Une exécution répétée refuse les factures déjà présentes avant toute nouvelle allocation.

## Commandes opérateur

Lecture seule :

```sh
npm run billing:historical-invoices:dry-run
```

L’APPLY est interdit sans une autorisation humaine séparée. Lorsqu’elle existe, la confirmation one-shot exacte reste obligatoire :

```sh
npm run billing:historical-invoices:apply -- \
  --apply \
  --confirm=APPLY_OPTION_C_LNX_2026_000003_000007_000011
```

Ne jamais enregistrer cette confirmation dans Railway. Ne jamais ajouter de route publique ou de bouton Admin/Member pour ce runner.
