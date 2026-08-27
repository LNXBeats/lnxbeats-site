# Boutique Phase 2 — preview QA locale isolée

Cette preview sert uniquement à la QA humaine de la Boutique Phase 2. Elle utilise une instance PostgreSQL Prisma Dev jetable, deux comptes `example.invalid`, deux produits entièrement synthétiques et le stockage média local. Elle ne contacte ni Railway, ni Resend, ni Stripe, ni PayPal, ni R2.

Elle ne doit jamais viser `lnx-studio-local-preview`, le port PostgreSQL `5432`, le port HTTP personnel `3000`, une base distante ou un service Railway. Aucun script de cette procédure ne confirme un paiement et aucune route QA n'est créée.

## Identité de l'environnement

Les valeurs non secrètes sont fixes :

- cible PostgreSQL : `lnx-studio-v110-phase2-test` ;
- port PostgreSQL demandé : `51260` ; le port effectivement attribué doit être lu dans la preuve Prisma Dev et rester strictement loopback ;
- preuve Prisma Dev : `~/Library/Application Support/prisma-dev-nodejs/lnx-studio-v110-phase2-test/server.json` ;
- origine Next/Auth : `http://127.0.0.1:31760` ;
- médias locaux : `/private/tmp/lnx-studio-v110-phase2-media` ;
- compte MEMBER : `lnx-v110-phase2-member@example.invalid` ;
- compte ADMIN : `lnx-v110-phase2-admin@example.invalid` ;
- produits : `lnx-v110-phase2-qa-product-a` et `lnx-v110-phase2-qa-product-b`.

Les comptes sont actifs et vérifiés uniquement dans cette base jetable. Le mot de passe MEMBER provient exclusivement de `LNX_AUTH_QA_MEMBER_PASSWORD` et le mot de passe ADMIN de `LNX_AUTH_QA_ADMIN_PASSWORD`. Les deux valeurs doivent être distinctes. Le script ne les contient pas, ne les demande pas sur la ligne de commande et ne les affiche jamais. Les sessions sont créées par le vrai formulaire Better Auth sur `/connexion`, jamais par la fixture.

## Fichier local ignoré

Créer `.env.phase2-qa.local` dans le worktree. `.gitignore` ignore déjà `.env.*`; vérifier néanmoins qu'il n'apparaît jamais dans `git status`. Générer `AUTH_SECRET`, `LNX_AUTH_QA_MEMBER_PASSWORD` et `LNX_AUTH_QA_ADMIN_PASSWORD` localement, placer les trois valeurs directement dans ce fichier et ne jamais les copier dans un rapport, une capture ou un log.

Le fichier doit contenir le contrat suivant. Les trois marqueurs entre chevrons sont des valeurs locales à fournir, pas des valeurs à committer :

```dotenv
NODE_ENV=test
LNX_DATABASE_TARGET=lnx-studio-v110-phase2-test
LNX_PRISMA_DEV_SERVER_FILE="/Users/<UTILISATEUR>/Library/Application Support/prisma-dev-nodejs/lnx-studio-v110-phase2-test/server.json"
DATABASE_URL=<CONNEXION_EXACTE_EXPORTÉE_PAR_LA_PREUVE_PRISMA_DEV>

AUTH_URL=http://127.0.0.1:31760
SITE_URL=http://127.0.0.1:31760
APP_CANONICAL_URL=http://127.0.0.1:31760
AUTH_SECRET=<SECRET_LOCAL_ALÉATOIRE_D_AU_MOINS_32_CARACTÈRES>
LNX_AUTH_QA_MEMBER_PASSWORD=<MOT_DE_PASSE_MEMBER_LOCAL_DE_12_À_128_CARACTÈRES>
LNX_AUTH_QA_ADMIN_PASSWORD=<MOT_DE_PASSE_ADMIN_LOCAL_DISTINCT_DE_12_À_128_CARACTÈRES>
AUTH_QA_ACCESS_ENABLED=false
AUTH_QA_ACCESS_CONFIRM=
AUTH_QA_ACCESS_SECRET=

EMAIL_PROVIDER=capture
AUTH_EMAIL_CAPTURE_PATH=/private/tmp/lnx-studio-v110-phase2-auth-mailbox.jsonl
EMAIL_NOTIFICATIONS_ENABLED=true
OWNER_EMAIL_NOTIFICATIONS_ENABLED=true
CLIENT_EMAIL_NOTIFICATIONS_ENABLED=true
NOTIFICATION_DEPLOYMENT_ENV=development
NOTIFICATION_EMAIL_TRANSPORT=capture
NOTIFICATION_CAPTURE_PATH=/private/tmp/lnx-studio-v110-phase2-notifications.jsonl
NOTIFICATION_WORKER_ENABLED=false
NOTIFICATION_WORKER_SECRET=
NOTIFICATION_SCHEDULER_MODE=disabled
SMS_TRANSPORT=disabled
SMS_NOTIFICATIONS_ENABLED=false
RESEND_API_KEY=
RESEND_WEBHOOK_SECRET=
EMAIL_OWNER_RECIPIENT=
SMS_OWNER_RECIPIENT=

PAYMENTS_ENABLED=false
PAYMENT_DEPLOYMENT_ENV=development
LIVE_REFUNDS_ENABLED=false
STRIPE_PAYMENTS_ENABLED=false
STRIPE_MODE=test
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
PAYPAL_PAYMENTS_ENABLED=false
PAYPAL_ENVIRONMENT=sandbox
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_WEBHOOK_ID=

SHOP_ENABLED=true
SHOP_LOCAL_QA_CONFIRM=enable-local-shop-commerce-qa
SHOP_ALLOWED_COUNTRIES=FR
SHOP_RESERVATION_TTL_MINUTES=30
MUSIC_PRICING_SOURCE=legacy

MEDIA_DEPLOYMENT_ENV=test
MEDIA_STORAGE_DRIVER=local
MEDIA_LOCAL_PUBLIC_ROOT=/private/tmp/lnx-studio-v110-phase2-media/public
MEDIA_LOCAL_PRIVATE_ROOT=/private/tmp/lnx-studio-v110-phase2-media/private
MEDIA_STORAGE_ROOT=/private/tmp/lnx-studio-v110-phase2-media/public
ORDER_UPLOAD_MODE=local-qa
ORDER_UPLOAD_DIR=/private/tmp/lnx-studio-v110-phase2-media/private
MEDIA_STORAGE_PROVIDER=
MEDIA_S3_ENDPOINT=
MEDIA_S3_ACCESS_KEY_ID=
MEDIA_S3_SECRET_ACCESS_KEY=
MEDIA_PUBLIC_BUCKET=
MEDIA_PRIVATE_BUCKET=
```

Ne pas ajouter `LNX_PREVIEW_MODE=persistent-local`. `NODE_ENV=test` est intentionnel : il garde cette preview hors du runtime Production, empêche Next de charger la configuration personnelle `.env.local` et conserve des cookies HTTP adaptés à l'origine loopback. Les fichiers `.env`, `.env.test` et `.env.test.local` doivent également être absents du worktree : le préflight les refuse pour empêcher Next d'injecter des variables supplémentaires après validation.

## Création et lancement

Depuis le worktree Phase 2 :

```sh
npx prisma dev --name=lnx-studio-v110-phase2-test --db-port=51260 --detach
```

Lire la preuve créée, vérifier son nom, son PID et son port, puis prouver que ce PID écoute exclusivement l'adresse loopback sur ce port. Prisma Dev 0.16.28 peut attribuer un autre port libre malgré le port demandé ; seul le port exact de cette preuve est alors autorisé. Reporter sa `connectionString` exacte dans le fichier local sans l'imprimer dans un rapport. Appliquer ensuite la migration avec le wrapper gardé :

```sh
npm run shop:phase2:migrate
npm run shop:phase2:fixtures:setup
npm run shop:phase2:preview:build
npm run shop:phase2:preview:start
```

Les quatre commandes chargent `.env.phase2-qa.local` avec `--env-file-if-exists`, puis échouent fermées si le fichier est absent ou incomplet parce que la garde exige explicitement chaque valeur du contrat. Elles échouent également si la cible, la preuve, le PID, le port effectivement exporté par la preuve, les origines, les racines média, les flags ou l'absence de services externes ne correspondent pas. Ouvrir uniquement `http://127.0.0.1:31760`; ne pas remplacer ce nom d'hôte par `localhost`.

Après le démarrage, `/api/health` doit répondre `200` et annoncer la Boutique active avec la source tarifaire `legacy`. La fixture affiche seulement les deux emails et les deux routes produit. Chaque mot de passe reste dans le fichier local et correspond uniquement au rôle indiqué par son nom de variable.

## Parcours humain

1. Visiter `/boutique`, puis les deux fiches produit.
2. Ajouter les produits au panier et changer les quantités.
3. Se connecter avec le compte MEMBER par `/connexion`.
4. Saisir uniquement une adresse fictive en France.
5. Créer une `ShopOrder` et vérifier l'état « prête pour paiement » sans paiement ni appel provider.
6. Vérifier la commande dans Compte → Mes achats.
7. Se déconnecter, se connecter avec le compte ADMIN et vérifier Admin → commandes Boutique.
8. Contrôler les écrans principaux à 390 px, le clavier, le focus visible et les libellés accessibles.
9. Dans l'onglet Réseau, confirmer que toutes les requêtes restent sur `127.0.0.1:31760`, notamment les médias `/media/boutique/*`, et qu'aucune requête ne vise Stripe, PayPal, Resend, Railway ou R2.

La fixture ne précrée aucune `ShopOrder` : la commande observée prouve donc le parcours réel. Relancer `fixtures:setup` supprime uniquement les commandes, comptes, produits et médias de ce namespace QA avant de les recréer. Ne pas relancer pendant une session à conserver. Les liens externes du pied de page et les anciennes pages musique ne font pas partie de ce parcours : ne pas les ouvrir pendant la preuve d'isolement réseau.

## Nettoyage

Conserver l'instance tant que la QA humaine n'est pas terminée. À la fin seulement :

1. arrêter `shop:phase2:preview:start` ;
2. exécuter le nettoyage borné ;
3. arrêter puis supprimer l'instance Prisma Dev.

```sh
npm run shop:phase2:fixtures:cleanup
npx prisma dev stop lnx-studio-v110-phase2-test
npx prisma dev rm lnx-studio-v110-phase2-test
npx prisma dev ls
```

Le cleanup refuse de supprimer un média partagé, un produit étranger, une commande payée/expédiée, une réservation confirmée ou une identité reliée à un autre domaine. Dans ce cas, conserver l'instance pour audit au lieu d'élargir le nettoyage. Après succès, prouver que le PID est arrêté, que le port PostgreSQL exact de la preuve est fermé et que le répertoire d'instance a disparu. Supprimer enfin le fichier `.env.phase2-qa.local` par un moyen local récupérable adapté; il ne doit jamais être committé.

## Contrôles techniques

Avant remise à la QA humaine :

```sh
npm run test:shop
npm run typecheck
npm run lint
git diff --check
```

Le scan de secrets doit couvrir le diff, la migration, les fixtures, les nouveaux scripts et le bundle client. Les chaînes suivies ne doivent contenir aucun `DATABASE_URL` réel, mot de passe QA, cookie, `AUTH_SECRET`, credential provider ou token Railway.
