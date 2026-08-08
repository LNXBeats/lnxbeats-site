# LNX Beats — V1.0

Première version réellement prête à déposer dans le dépôt GitHub `LNXBeats/lnxbeats-site` puis à déployer sur Railway.

## Ce qui est déjà inclus

- Site public responsive noir/or
- Hero LNX Beats
- Liens Spotify, YouTube, Apple Music, Deezer, Amazon Music, TikTok, Instagram
- Discographie mise à jour avec les albums et singles transmis le 8 août 2026
- Boutique DistroKid + Etsy
- Parcours “Crée ta musique — 50 €”
- Paiement PayPal préparé + option virement préparée
- Administration locale des commandes
- Pages légales et confidentialité
- Configuration Railway + endpoint `/health`

## Mise sur GitHub depuis le Mac

Décompresse le dossier puis ouvre Terminal dans ce dossier. Exécute :

```bash
git init
git branch -M main
git remote add origin https://github.com/LNXBeats/lnxbeats-site.git
git add .
git commit -m "LNX Beats V1 initiale"
git push -u origin main --force
```

Le `--force` est nécessaire ici uniquement parce que le dépôt GitHub contient déjà le README initial créé sur le site GitHub.

---

# LNX Beats — site officiel (V0.4)

Version fonctionnelle mobile-first du site LNX Beats, dans la direction visuelle noir / blanc / jaune-or validée.

## Nouveautés V0.4

- E-mail de réception des commandes configuré : `lnx.beats.pro@gmail.com`.
- Délai commercial affiché : **7 jours après confirmation du paiement et réception d’un brief exploitable**.
- **1 retouche raisonnable incluse** dans les 50 €.
- Droits inclus : usage personnel + partage non commercial sur les réseaux sociaux.
- Utilisation professionnelle/commerciale : accord distinct obligatoire.
- Deux modes de paiement : **PayPal ou virement bancaire**.
- Le virement utilise automatiquement le numéro de commande comme référence.
- Dans l’administration, un virement peut être marqué « reçu » avant de passer la commande en « À créer ».
- TikTok et Instagram officiels intégrés.


- Amazon Music officiel intégré.
- Informations d’éditeur issues de la formalité de création intégrées dans les mentions légales : entrepreneur individuel, nom commercial LNX Beats, adresse professionnelle et activité.
- Régime fiscal indiqué comme **régime spécial BNC** avec **franchise en base de TVA**, conformément au document fourni.
- Domaine recommandé pour la mise en ligne : **lnxbeats.fr**. Le nom `LNX_BEATS.fr` n’est pas syntaxiquement enregistrable en `.fr` à cause du caractère `_`; `lnxbeats.fr` est la variante la plus courte et cohérente avec les identifiants sociaux.

## Pages construites

- Accueil avec Hero LNX Beats, titre à la une, univers musicaux, YouTube, boutique, présentation et contact.
- Musique.
- Vidéos.
- Boutique DistroKid + Etsy.
- LNX Beats.
- Contact.
- Liens / bio sociale.
- Mentions légales.
- Confidentialité.
- CGV (version de travail à finaliser juridiquement).
- **Crée ta musique — 50 €** avec formulaire en 6 étapes.
- Administration privée `/admin.html`.

## Formulaire « Crée ta musique »

Le parcours comprend :

- coordonnées du client, e-mail et téléphone ;
- destinataire / occasion / date ;
- style musical ;
- option **« Je laisse LNX Beats choisir le style qui correspond le mieux à mon histoire »** ;
- ambiance et type de voix ;
- histoire détaillée et éléments à éviter ;
- pièces jointes facultatives ;
- usage prévu ;
- récapitulatif ;
- choix PayPal ou virement bancaire ;
- numéro de commande du type `LNX-2026-0001`.

## Lancer le site en local

1. Installer Node.js 20+.
2. Dans le dossier du projet :

```bash
npm install
cp .env.example .env
npm start
```

3. Ouvrir `http://localhost:3000`.

## Activer PayPal

Créer une application REST dans le tableau de bord développeur PayPal puis renseigner dans `.env` :

```env
PAYPAL_MODE=sandbox
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
```

Tester d’abord en Sandbox. Une fois le parcours validé, utiliser les identifiants Live et passer :

```env
PAYPAL_MODE=live
```

Le montant est fixé côté serveur à **50,00 EUR**.

**Ne jamais placer le `PAYPAL_CLIENT_SECRET` dans un fichier JavaScript public.**

## Activer le virement bancaire

Les coordonnées bancaires ne sont volontairement pas incluses dans l’archive. Les renseigner dans le fichier `.env` du serveur :

```env
BANK_ACCOUNT_HOLDER=
BANK_IBAN=
BANK_BIC=
BANK_NAME=
```

Le site n’affiche l’option opérationnelle qu’une fois au minimum le titulaire et l’IBAN configurés. Après création de la commande, le client reçoit/voit : montant, titulaire, IBAN, BIC si présent et **référence obligatoire = numéro de commande**.

La commande reste « En attente de paiement ». Dans `/admin.html`, le virement peut ensuite être marqué « Virement reçu » ; la commande passe alors à « À créer ».

## E-mails

L’adresse d’administration choisie est déjà renseignée :

```env
ADMIN_EMAIL=lnx.beats.pro@gmail.com
```

Pour envoyer automatiquement les confirmations clients et notifications, configurer un SMTP :

```env
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM="LNX Beats <lnx.beats.pro@gmail.com>"
```

Pour Gmail, utiliser une méthode d’authentification adaptée au déploiement ; ne pas mettre le mot de passe habituel du compte Gmail dans le projet.

## Administration

Définir une longue clé aléatoire :

```env
ADMIN_KEY=...
```

Puis ouvrir `/admin.html`.

Les commandes disposent des statuts :

- En attente de paiement
- À créer
- En cours
- Terminée
- Envoyée
- Annulée

Pour un virement bancaire, le statut du paiement peut être validé manuellement lorsque les fonds sont reçus.

## Liens officiels intégrés

- Spotify : https://open.spotify.com/artist/4Qqg1iO2aKxcV0e64Hkg5R
- YouTube : https://youtube.com/@lnxbeats
- Apple Music : https://music.apple.com/fr/artist/lnx-beats/1856898446
- Deezer : https://link.deezer.com/s/343dUyN0Jo0qIXG4hR6X2
- Boutique DistroKid : https://direct.distrokid.com/lnxbeats2/
- Etsy : https://lnxbeats.etsy.com/listing/4528037390
- TikTok : https://www.tiktok.com/@lnx.beats
- Instagram : https://www.instagram.com/lnxbeats
- Amazon Music : https://music.amazon.fr/artists/B09VNR4Y3W
- Titre à la une : « J’ai adopté un humain » — https://youtu.be/TzhsaAotKWY

## À compléter avant la mise en ligne commerciale

- Coordonnées bancaires dans l’environnement sécurisé du serveur.
- Identifiants PayPal Sandbox puis Live.
- Configuration e-mail SMTP ou service d’e-mails transactionnels.
- SIREN et SIRET intégrés dans les mentions légales (106 870 850 / 106 870 850 00018).
- Hébergeur et ses coordonnées dans les mentions légales.
- Validation finale de la formulation fiscale sur les justificatifs de vente.
- Validation juridique finale des CGV, notamment rétractation / début d’exécution d’une prestation personnalisée.
- Durée de conservation des données et des pièces jointes.
- Stockage privé persistant des pièces jointes en production (S3 / Cloudflare R2 ou équivalent recommandé).
- Enregistrement du nom de domaine retenu `lnxbeats.fr`, puis configuration DNS et HTTPS.
- Hébergement.

## Important sur les fichiers clients

En développement, les pièces jointes sont stockées dans `uploads/`. Pour la production, utiliser un stockage privé persistant. Ne pas rendre ce dossier publiquement accessible.


## V0.5 — Identité légale et domaine

- Domaine officiel retenu pour la mise en ligne : **lnxbeats.fr**.
- SIREN : **106 870 850**.
- SIRET : **106 870 850 00018**.
- N° TVA intracommunautaire fourni : **FR14 106870850**.
- Statut : entrepreneur individuel — nom commercial **LNX Beats**.
- Les pages juridiques rappellent la franchise en base de TVA et la mention de facture « TVA non applicable, article 293 B du CGI » tant que ce régime s’applique.
- À compléter avant publication : hébergeur, validation finale des CGV, configuration PayPal/virement, SMTP, domaine/DNS/HTTPS.

## V0.6 — Déploiement Railway retenu

### Hébergement choisi

La production est prévue sur **Railway — plan Hobby**, avec le service principal déployé en **EU West (Amsterdam)**. Cette plateforme est retenue parce qu'elle exécute directement l'application Node.js/Express actuelle, gère les variables secrètes, les domaines personnalisés et le HTTPS, et permet d'attacher un volume persistant au même service.

### Architecture de départ

- 1 service Node.js/Express LNX Beats ;
- 1 volume persistant Railway monté sur `/data` ;
- `PERSISTENT_ROOT=/data` afin que les commandes et pièces jointes ne soient pas perdues lors d'un redéploiement ;
- sauvegardes automatiques du volume à activer dans Railway ;
- région **EU West / Amsterdam** ;
- domaine public prévu : `https://lnxbeats.fr` ;
- HTTPS géré automatiquement par Railway une fois le domaine relié ;
- `railway.toml` inclus dans le projet avec commande de démarrage et healthcheck `/health`.

### Réglages Railway à appliquer

1. Créer un projet Railway et sélectionner le plan Hobby.
2. Déployer ce dépôt GitHub / projet Node.js.
3. Choisir la région **EU West (Amsterdam)**.
4. Ajouter un volume persistant (2 Go suffisent au lancement) et le monter sur `/data`.
5. Définir `PERSISTENT_ROOT=/data`.
6. Ajouter toutes les variables secrètes de `.env.example` directement dans Railway (jamais dans GitHub).
7. Activer des sauvegardes du volume, au minimum quotidiennes + hebdomadaires.
8. Ajouter `lnxbeats.fr` et `www.lnxbeats.fr` comme domaines personnalisés lorsque le domaine aura été enregistré.
9. Activer le CDN Railway pour les assets statiques si souhaité.

### Important avant ouverture des commandes

La V0.6 conserve encore les commandes dans un fichier JSON sur le volume persistant. C'est acceptable pour le lancement avec **une seule instance** et un faible volume de commandes. Avant une montée en charge importante ou l'utilisation de plusieurs réplicas, migrer les commandes vers une base SQL transactionnelle.
