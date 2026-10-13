# DCN-1.2 — reprise locale et lecture du dossier hors serveur

## Lire sans installer ni démarrer le site

1. Décompresser `LNX_DCN_1_2_RESTITUTION.zip` dans un dossier neuf.
2. Ouvrir `index.html` dans un navigateur. Toutes les captures et liens de documents utilisent des chemins **relatifs**, sans serveur, réseau ou exécution de JavaScript.
3. Lire `README.md`, puis `rapports/DCN_1_2.md`, les limites/décisions et la demande d’autorisation externe. Les trois rapports1.1 originaux sont dans `rapports/`.
4. Les fichiers `preuves/tests.json` et `preuves/release.json` donnent les statuts réellement exécutés, SHA, environnement et distinction anciens/nouveaux. `manifest-sha256.json` décrit les empreintes des fichiers livrés. Le manifeste ne peut pas contenir sa propre empreinte.

Le dossier est un **dossier de revue**, pas une sauvegarde installable. Il exclut code complet, dépendances, base, masters, profil privé, secrets et cookies. Les prix/audio/données présentés sont synthétiques ; les exemples PDF ne valent ni facture réelle, ni validation juridique/fiscale. Les originales privées de la démo ne sont pas transférées.

## Reprendre sur le Mac de développement déjà préparé

Worktree conservé : `/Users/lnxbeats/.codex/worktrees/dcn-1-0/lnxbeats-site-v1` ; branche `feature/dcn-1-0`. Ne pas écraser d’autres modifications, déplacer main ni relancer un bootstrap global. Vérifier d’abord les processus/ports existants afin de ne pas démarrer une seconde instance.

Depuis ce dossier, dans des terminaux séparés si les services sont arrêtés :

```sh
npm run dcn:local:web
npm run dcn:local:worker
```

La revue utilise le mode développement normal, exclusivement loopback :

- `http://127.0.0.1:3140/discographie`
- `http://127.0.0.1:3140/musique/panier`
- `http://127.0.0.1:3140/compte/musique`
- `http://127.0.0.1:3140/admin/musique`

Les URLs exactes des nouvelles fixtures sont dans le bilan1.2 ; ne pas remplacer les anciennes. Une session QA normale est nécessaire pour Admin/bibliothèque. Identifiants dans le profil local privé mode0600 ; **aucune valeur à recopier ici, dans Git ou dans l’archive**. Se connecter en interface, ne pas contourner Auth.

La préparation 1.2 est **additive** (`scripts/digital-1-2-local-prepare.ts`) : nouveau membre fictif et WAV synthétiques bornés, privilèges locaux d’édition Catalogue expressément autorisés. Elle ne remplace pas les mots de passe historiques, n’injecte pas l’album/les pistes/offres à la place de la preuve Admin navigateur, et ne remet pas la démo à zéro. Ne pas l’utiliser comme commande de nettoyage.

Le profil local conservé est `.private/dcn-review-config.json`, les comptes `.private/dcn-review-credentials.json`. Les lanceurs lisent ce seul profil ; pas de reprise implicite des clés LIVE du `.env` historique. L’état simulé ne doit pas ouvrir un checkout prestataire ; la fonction QA éventuelle ne fonctionne que dans la cible locale bornée qui a été auditée/testée, jamais sur la foi d’un paramètre client.

Le script de préparation n'effectue pas de rotation globale. Une sécurisation distincte a été expressément autorisée après une soumission native locale avant hydratation : les quatre comptes QA partageant l'ancien accès ont été tournés et leurs six sessions révoquées, sans changer leurs achats. Le profil privé actuel contient les accès nouveaux. Ne pas réutiliser un ancien dump/profil de credentials comme accès actif ni relancer cette rotation pour une simple reprise de revue.

La simulation navigateur 1.2 utilise une capacité explicite du lanceur, un compte QA précis, DB/port/rôle/origin exacts, disque local et mail capture, et rejette la présence des credentials financiers. Elle ne se fonde pas sur `NODE_ENV` seul. Ses références `dcn12-local-…` identifient le double ; aucun appel Stripe même si le provider interne de test porte ce libellé. `DCN_NEW_PAYMENTS_ENABLED=false` et `DCN_EXTERNAL_TEST_AUTHORIZED=false` restent les états de recette. Ne jamais exporter ou copier cette capacité dans Railway.

## PostgreSQL et fichiers existants

Cluster QA existant : `/private/tmp/lnx-dcn-postgres.UwLq6m/data`, PostgreSQL17.11 sur `127.0.0.1:55473`, base persistante `lnx_dcn_runtime_test`. Ne pas initialiser, supprimer ou restaurer par-dessus cette racine/base. Identifier l’instance avant tout démarrage ciblé via `pg_ctl`. La base utilise rôles propriétaires/runtime distincts ; ne pas accorder de droits globaux pour faire passer la démo.

Les anciens masters, acquisitions et documents doivent rester présents. Les chemins médias sous `/private/tmp/lnx-dcn-*` sont des racines locales historiques, **pas une garantie de conservation durable**. Toute sauvegarde longue durée reste une action ciblée privée à décider. Le ZIP de restitution ne contient pas ces médias ni dump.

La preuve1.1 d’upgrade/restore est référencée dans le rapport original. `npm run dcn:1.1:test:runtime` crée une **nouvelle cible jetable par run**, restaure le backup synthétique acquis et teste SQL/canaris/ACL ; il ne doit pas être exécuté inutilement pour revoir le visuel. Une base persistante créée historiquement en SQL brut n’a pas le registre Prisma complet : **pas de `prisma migrate deploy` aveugle sur cette base**, pas de reset ou de down-migration.

## Contrôles ciblés et export

Les commandes réellement exécutées sont listées dans `DCN_1_2.md`. Ne pas additionner les tests inclus dans la canonique, anciens groupes et campagnes intermédiaires. On peut lancer les tests DCN affectés, lint/typecheck et builds quand le code change ; un fichier document/capture ne justifie pas tous les tests financiers.

La commande d’export est strictement locale, sans DB ni réseau :

```sh
node scripts/digital-1-2-export.mjs --evidence output/dcn-1-2/evidence.json
```

Elle exige un index d’entrée revu avec SHA/tree, preuves structurées filtrées, captures aux dimensions réelles et copies PDF/e-mails **entièrement synthétiques** validées pour transmission. Elle ne collecte pas récursivement `.private`, logs, profils ou médias. Elle crée un dossier neuf de sortie, un index hors ligne, un manifeste SHA256 puis le ZIP exact ; vérifie l’intégrité par `unzip -t` et compare le listing aux fichiers annoncés. Aucun écrasement du précédent dossier.

Les captures avant et après ont chacune navigateur/scénario/SHA/largeur/hauteur réels. Un viewport virtuel1440 dont l’image est tronquée1124 n’est pas un PASS1440 ; l’index conserve cette distinction. Les copies du dossier n’altèrent pas les preuves1.1 sources.

## Safari physique et futures recettes externes

Préparer une URL HTTPS privée joignable depuis l’appareil, un certificat fiable et une autorisation exacte de réseau/ports ; aucune exposition LAN/Internet ou tunnel ici. `127.0.0.1` n’est pas l’adresse iPhone du Mac. Le build optimisé conserve les cookies sécurisés : pas de désactivation de cette sécurité pour le servir en HTTP sur un appareil.

La procédure regroupée, les comptes/buckets encore à nommer, plafonds/opérations/coûts et nettoyage se trouvent intégralement dans `DCN_1_2_EXTERNAL_AUTHORIZATION.md`. Aucun StripeTEST/PayPalSANDBOX/R2 distant ou email réellement envoyé sans cette autorisation. L’émulation reste étiquetée comme telle ; attendre le retour humain pour déclarer un PASS Safari physique.

## Protections

`MAIN_PUSH=NO`, `MAIN_MERGE=NO`, `DEPLOYMENT=NO`, `RAILWAY_MUTATION=NO`, `PRODUCTION_MUTATION=NO`, `LIVE_PAYMENT=NO`, `LIVE_REFUND=NO`, `REAL_CLIENT_EMAIL=NO`, `PUBLIC_TUNNEL=NO`.

Une future release demanderait une autorisation séparée et ses gates réels ; ce lot et son dossier ne sont **pas prêts pour Production**.
