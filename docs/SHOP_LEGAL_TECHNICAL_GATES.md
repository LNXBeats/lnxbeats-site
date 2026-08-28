# Gates juridiques techniques Boutique — Phase 3A

> Phase 4 : `shop-cgv-phase3-qa-v0` et `shop-cgv-phase3-qa-v1` restent des preuves historiques `QA_ONLY`. `shop-cgv-2026-01-draft` est une candidate de revue, pas une entrée `APPROVED`. `SHOP_LEGAL_READY=false` demeure la valeur sûre.

> Ce document décrit uniquement des mécanismes techniques. Il ne contient pas
> de CGV, ne remplace pas une revue juridique et n'autorise aucune vente.

## État fail-closed

`SHOP_LEGAL_READY=false` est l'état par défaut. Dans cet état, aucune tentative
Checkout Boutique ne peut obtenir un snapshot d'acceptation valide.

Lorsque `SHOP_LEGAL_READY=true`, le serveur exige :

- `SHOP_TERMS_VERSION` non vide et présente dans le registre immuable du code ;
- une entrée dont le statut d'approbation convient au runtime ;
- une acceptation client strictement égale à `true` ;
- un horodatage serveur valide.

Une valeur booléenne autre que `true` ou `false`, une version inconnue ou une
configuration partielle échoue fermée.

## Registre QA technique

Le registre contient l'entrée technique active :

```text
SHOP_TERMS_VERSION=shop-cgv-phase3-qa-v1
```

Elle est marquée `QA_ONLY`. Pour l'utiliser, il faut aussi :

```text
SHOP_LEGAL_QA_CONFIRM=enable-local-shop-legal-qa
```

Le runtime doit être hors Production et `AUTH_URL` ou `SITE_URL` doit être une
origine HTTP loopback (`localhost`, `127.0.0.1` ou `::1`). Cette confirmation
n'est pas un secret et ne suffit jamais à elle seule.

L'empreinte associée identifie un placeholder technique immuable. Elle ne
représente aucun texte juridique approuvé et est explicitement interdite en
Production.

Une entrée QA antérieure, `shop-cgv-phase3-qa-v0`, reste archivée dans ce
registre uniquement pour vérifier la reprise déterministe d'une tentative déjà
acceptée après rotation de la version active. Elle n'est ni promue, ni
réinterprétée : une commande qui possède un snapshot complet et enregistré
conserve exactement sa version, son empreinte et son horodatage initiaux.

## Preuve d'acceptation minimale

Le formulaire doit présenter une case explicite non précochée. Le serveur
refuse un champ absent, une chaîne truthy ou tout autre payload : seule la
valeur booléenne `true` est acceptée.

Lors de la première tentative admissible, la transaction fige sur la
`ShopOrder` :

- `termsVersion` ;
- `termsHashSha256` ;
- `termsAcceptedAt` calculé par le serveur.

Les trois champs sont soit tous absents, soit tous valides. Une tentative
ultérieure doit retrouver exactement la même version et la même empreinte ; le
client ne peut pas les choisir. `SHOP_TERMS_ACCEPTED` fournit l'événement
idempotent correspondant.

Aucune adresse IP complète, user-agent, copie du texte ou donnée sensible
supplémentaire n'est nécessaire à cette fondation.

## Passage juridique futur

Avant toute QA distante ou vente réelle, une action humaine devra :

1. faire approuver le texte applicable et sa version par le responsable
   juridique ;
2. enregistrer une nouvelle entrée immuable marquée `APPROVED` avec l'empreinte
   du contenu exact publié ;
3. vérifier l'affichage, le téléchargement/archivage éventuel et le wording de
   consentement ;
4. tester le snapshot et le rollback dans un environnement dédié ;
5. armer séparément commerce, juridique, paiements, providers et notifications.

La Phase 3A ne réalise aucune de ces actions. La version QA ne doit jamais être
promue, renommée ou requalifiée pour contourner la revue.

Voir [paiements Boutique](SHOP_PAYMENTS.md),
[QA offline](SHOP_PAYMENT_QA.md) et [commandes](SHOP_ORDER.md).
