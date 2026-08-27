# Tarification musicale administrable — fondations V1.1

## Baseline V1.0 importée

La migration importe sans modifier aucune `Order` ni aucun `Payment` :

| Version | Création | Illustration | Priorité | État importé |
| --- | ---: | ---: | ---: | --- |
| `2026-08-v1` | 5 000 c | 1 000 c | 3 000 c | historique |
| `2026-08-v2` | 2 000 c | 1 000 c | 3 000 c | active |

La parité attendue reste 50/60/80/90 € pour v1 et 20/30/50/60 € pour v2.
Tous les montants sont des entiers en centimes et la devise est `EUR`.

## Versions et audit

`MusicPricingVersion` conserve chaque définition. Une activation crée une
nouvelle version ; elle ne réécrit jamais une version historique. Le singleton
`MusicPricingConfiguration` porte la version active et une révision optimiste.
`MusicPricingActivation` conserve l'ancienne version, la nouvelle, l'acteur et
la date.

Deux onglets Admin ne peuvent pas s'écraser silencieusement : l'action exige la
révision observée, prend un verrou PostgreSQL et échoue en cas de conflit.

## Snapshots existants

Les champs `basePriceCents`, `coverPriceCents`, `priorityPriceCents`,
`totalCents`, `currency` et `pricingVersion` de chaque `Order` restent la source
de vérité de cette commande. Aucun backfill ne les modifie. Un `Payment`
continue à copier ce snapshot serveur.

## Gate financier de transition

`MUSIC_PRICING_SOURCE=legacy` reste la valeur sûre de la phase 1. Les versions
DB et l'Admin sont préparés, mais Commander et les providers V1 continuent à
utiliser le registre validé de V1.0 tant que le sprint financier de cutover
n'est pas approuvé.

Le futur mode `database` devra charger par version la définition attendue lors
de la création d'une Order, de sa finalisation et de la réservation du
paiement. Il devra prouver que Stripe et PayPal reçoivent toujours le snapshot
persisté et que v1/v2 restent payables. Il ne doit jamais devenir un fallback
silencieux entre deux sources divergentes.

## Rollback

Conserver `MUSIC_PRICING_SOURCE=legacy`. Ne jamais supprimer une version déjà
utilisée et ne jamais réécrire les anciennes commandes. Une erreur de tarif se
corrige par une nouvelle version après validation humaine.

Avant la migration Production, un backup PostgreSQL/PITR vérifié et un
inventaire des snapshots `Order`/`Payment` sont obligatoires. Après migration,
la parité v1/v2 et les 19 migrations appliquées doivent être contrôlées avant
d'ouvrir l'Admin Tarifs. Aucun réglage Admin ne constitue à lui seul le cutover
financier de Commander.
