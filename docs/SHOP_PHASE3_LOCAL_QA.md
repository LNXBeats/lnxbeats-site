# Boutique Phase 3A — preview QA locale hors réseau

Cette preview prolonge le contrat jetable décrit dans
[`SHOP_PHASE2_LOCAL_QA.md`](SHOP_PHASE2_LOCAL_QA.md). Elle réutilise exactement
la cible Prisma Dev `lnx-studio-v110-phase2-test`, l’origine loopback
`http://127.0.0.1:31760`, les deux identités fictives, les deux produits
synthétiques, le stockage local et les transports `capture`. Elle refuse le
port PostgreSQL standard, toute base distante, Railway et toute credential de
provider.

La fixture Phase 3 ajoute, sans réseau :

- une `ShopOrder` fictive appartenant au MEMBER ;
- une acceptation de la version technique QA des CGV ;
- un `Payment` TEST et une preuve provider synthétique ;
- la confirmation atomique du stock ;
- une notification propriétaire et une confirmation client ;
- deux rendus e-mail écrits uniquement dans le fichier capture local.

Le script appelle le repository de réconciliation avec une preuve mockée. Il
n’importe aucun gateway Stripe/PayPal, ne crée aucune route provider factice et
ne fait aucun `fetch`. Les flags globaux et providers restent désactivés. Cela
permet de vérifier Compte, Admin, stock, CGV, outbox et templates sans donner au
navigateur un faux Checkout qui pourrait être confondu avec un parcours réel.

## Préparation

Créer l’instance et `.env.phase2-qa.local` exactement comme indiqué dans le
runbook Phase 2, puis appliquer les **21 migrations**, dont
`20260827220000_shop_payment_fulfillment_foundation`. Ne pas ajouter de clé
Stripe, PayPal, Resend ou Railway. Ne pas ajouter `SHOP_LEGAL_*`,
`SHOP_PAYMENTS_ENABLED` ni `EMAIL_OWNER_RECIPIENT` au fichier local : les
wrappers Phase 3 exigent leur absence, puis injectent seulement leurs valeurs
QA publiques et fermées dans le processus validé.

Les mots de passe restent exclusivement dans :

- `LNX_AUTH_QA_MEMBER_PASSWORD` ;
- `LNX_AUTH_QA_ADMIN_PASSWORD`.

Ils ne sont jamais imprimés.

## Fixture et preview

```sh
npm run shop:phase2:migrate
npm run shop:phase3:fixtures:setup
npm run shop:phase3:preview:build
npm run shop:phase3:preview:start
```

Le setup est idempotent : il retire d’abord uniquement la fixture Phase 3
bornée, remet en place les fixtures Phase 2, puis recrée la commande payée
mockée. Il affiche seulement les e-mails fictifs, le numéro de commande et les
URLs relatives Compte/Admin. Les identifiants provider synthétiques ne sont pas
des credentials.

Identités locales :

- MEMBER : `lnx-v110-phase2-member@example.invalid` ;
- ADMIN : `lnx-v110-phase2-admin@example.invalid`.

La commande est visible sous `/compte/achats/<numéro>` et
`/admin/boutique/commandes/<numéro>`. Son état initial est payé, stock confirmé,
fulfillment en attente. Les deux notifications initiales sont déjà `DELIVERED`
par le transport local `CAPTURE`; aucun e-mail n’est envoyé.

## Limite volontaire du mock navigateur

Les boutons Checkout restent fail-closed dans cette preview :

- `PAYMENTS_ENABLED=false` ;
- `SHOP_PAYMENTS_ENABLED=false` ;
- `STRIPE_PAYMENTS_ENABLED=false` ;
- `PAYPAL_PAYMENTS_ENABLED=false`.

Un bouton de paiement mock dans le navigateur nécessiterait une nouvelle route
de mutation et risquerait de créer une seconde architecture divergente. Il est
donc explicitement différé. La QA Stripe Test et PayPal Sandbox doit utiliser
des environnements séparés, après autorisation humaine et avec leurs gardes
provider dédiées.

## Nettoyage

```sh
npm run shop:phase3:fixtures:cleanup
npx prisma dev stop lnx-studio-v110-phase2-test
npx prisma dev rm lnx-studio-v110-phase2-test
npx prisma dev ls
```

Le cleanup vérifie l’identité MEMBER, le token de création fixe, les produits,
le graphe Payment TEST, les événements, les notifications et les ajustements de
stock. Il restaure uniquement le stock consommé par cette preuve mockée, puis
supprime le graphe Phase 3 et les fixtures Phase 2. Toute relation, état ou
identité étrangère provoque un arrêt fermé. Le fichier capture local est retiré.
La suppression de l’instance Prisma Dev reste ensuite une action humaine
explicite et doit être prouvée.
