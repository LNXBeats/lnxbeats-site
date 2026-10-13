# DCN-1.0 — travail local isolé

Base : `7e7b8861d6b114a02e06ea69a9a7baf39693d83a`.
Branche : `feature/dcn-1-0`. Aucune promotion, aucun push, aucun déploiement autorisé.

Le dossier fourni (deux textes, 18 maquettes, trois captures) a été lu en intégralité.
Les prix des maquettes ne sont pas des tarifs. Aucun master client ni secret Production
ne doit être utilisé pour les fixtures locales.

## Lots

- A : audit, modèle additif, politique et ACL ciblées.
- B : masters privés versionnés, extraits physiques <= 60 s, import Admin.
- C : offres, tracklist interactive, panier numérique distinct.
- D : commandes numériques, confirmation serveur, bibliothèque et téléchargements.
- E : états négatifs, registre, gates juridiques/fiscaux, tests et revue locale.

## Décisions provisoires, non approuvées pour LIVE

Panier numérique séparé du panier physique ; compte vérifié obligatoire avant paiement ;
licence d'écoute personnelle sans cession de droits ; retrait des pistes du panier si
elles sont couvertes par un album ; achat d'album bloqué si des pistes sont déjà détenues
(pas de réduction présumée). Tout parcours LIVE reste fermé par défaut et exige une
validation explicite des prix, droits, conditions numériques et TVA.

## Bilan du 13 octobre 2026

Version locale testable, pas une release Production. Le pack complet a été extrait dans
`/private/tmp/lnx-dcn-pack.oPAKfd/LNX_DCN_1_0` ; les 18 maquettes et les trois captures
ont été réellement ouvertes. Aucun tarif ni produit fictif du dossier n'a été importé
comme donnée commerciale définitive.

### Audit et réemploi

| Domaine existant | Réemploi / décision |
| --- | --- |
| Catalogue Project / Track / Asset | Conservé ; relations additives pour les offres, masters et extraits. Publication interne et distribution externe sont distinctes. |
| Assets et stockage privé R2/local | Réutilisés. Une clé `digital/masters/...` est acceptée seulement dans le stockage privé. Aucune route publique ne délivre un master. |
| Upload multipart livrables/Créations | Moteur client, pièces de 8 Mio, reprise et confirmation serveur réutilisés ; sessions et quotas propres à DCN. |
| FFmpeg | Décodage complet et génération MP3 réutilisés, avec vérification physique du résultat inférieur ou égal à 60 s. |
| Player et coordination audio/vidéo | Player existant réutilisé, sans second moteur audio. La commutation des deux extraits a été contrôlée dans le navigateur. |
| Auth, origine, corps bornés, rate-limit | Compte vérifié avant checkout, Admin pour les imports, endpoints dédiés et réponses privées non cachées. |
| Stripe / PayPal | Construction Checkout et transport PayPal réutilisés. Métadonnées, URLs webhook, marchands et credentials sont séparés du Soutien et des commandes historiques. |
| Facturation existante | Aucun détournement de l'Invoice ou du Payment historique. Aucun faux Order physique. L'émission fiscale numérique reste à finaliser. |
| UI V4 | Fond, logo et assets existants inchangés. Ajouts CSS-module isolés et liens conditionnels ; jukebox conservé. |

### État par lot

| Lot | État local | Réalisé / réserve |
| --- | --- | --- |
| A — modèle, règles, ACL | DONE local | 11 tables additives, contraintes, snapshots, journal append-only, rôle runtime non propriétaire. Upgrade SQL réel sur PostgreSQL isolé avec canaris. |
| B — médias et Admin | PARTIAL | Imports multiples avec association explicite, progression/reprise, masters privés versionnés, extraits physiques autonomes, droits et prix séparés. WAV de 18,4 Mio envoyé réellement depuis le navigateur. R2 réel, Safari physique, antivirus et nettoyage des uploads abandonnés restent à recetter/finaliser. |
| C — public et panier | DONE local | Discographie enrichie, prix individuels et album indépendant, panier numérique distinct, recalcul serveur, piste couverte par album retirée, achat redondant bloqué. Revue visuelle humaine nouvelle requise. |
| D — paiement et bibliothèque | PARTIAL | Adaptateurs TEST/SANDBOX, consentements non précochés, idempotence, verrou persistant inter-prestataires, reprise hors navigateur, droits acquis et téléchargements/ZIP protégés. Règles testées avec doubles ; aucune recette prestataire réelle dans cette mission. |
| E — finance, juridique, exploitation | PARTIAL | Registre CSV protégé contre les formules, audit et retrait/suspension local des droits sur preuve simulée de remboursement/litige. Factures/avoirs numériques, e-mails d'achat, traitement complet des webhooks de remboursement/litige et qualification fiscale restent à livrer/valider. |

## Modèle et sécurité

`DigitalOffer`, `DigitalMaster`, `DigitalUpload`, `DigitalCart`, `DigitalCartLine`,
`DigitalOrder`, `DigitalOrderLine`, `DigitalPaymentAttempt`, `DigitalEntitlement`,
`DigitalEvent`, `DigitalDownloadTicket` sont séparés des domaines historiques.

- Aucun prix par défaut : `null`, vente fermée ; prix obligatoire, entier en centimes
  et droits confirmés pour activer. Les montants 1,49 / 2,49 / 5,99 EUR ne sont que QA.
- Offre album indépendante de la somme des titres. Pistes et versions figées au paiement ;
  un futur import ne remplace ni les fichiers ni les noms du snapshot acheté.
- Empreinte de contenu stockée au panier : retirer une piste, changer un master, son titre
  ou son ordre bloque le paiement jusqu'à nouvelle revue, même à prix inchangé. Le checkout
  affiche les lignes et le nombre de pistes incluses. Les projets sans DCN prêt gardent leur
  tracklist historique ; les titres annoncés restent visibles mais ni jouables ni vendus.
- Sources WAV/MP3/FLAC, 512 Mio maximum déclarés côté serveur. Réel décodage testé sur
  trois WAV synthétiques de plus de 10 Mio ; le transfert de 512 Mio n'a pas été exécuté.
- Les routes médias publiques exigent publication, extrait public et droits vérifiés.
- Le Web n'assemble pas un master complet en RAM. En mode R2, les pièces vont au stockage
  via URLs temporaires ; le profil local teste un transport disque par pièces.
- Aucun statut payé depuis un clic ou une URL de retour. Montant, devise, merchant,
  environnement et références sont liés avant attribution atomique des droits.
- Réservation et lease sont persistantes avant réseau ; aucune transaction DB ouverte
  pendant un appel prestataire. Un résultat inconnu bloque un paiement incompatible.
- Interrupteur nouveaux paiements distinct : n'arrête pas réconciliation/téléchargements.
- Téléchargement authentifié et propriétaire, cookie HttpOnly, ticket de 120 s / trois
  utilisations, contrôle répété des droits ; pas de clé privée ni token dans l'URL.
- ZIP réellement streamé avec CRC et noms du snapshot. Limite locale : 100 pistes et
  moins de 4 Gio, contrôlée avant ouverture des fichiers ; ZIP64 reste hors implémentation.
- ACL DCN : SELECT/INSERT ; UPDATE par colonnes autorisées ; événements, masters et lignes
  achetées append-only. Pas de DELETE, TRUNCATE, ownership, DDL ou GRANT global sur public.
- TEST uniquement, y compris CHECK SQL. Configuration absente, LIVE, mauvais marchand,
  mauvais état ou contradiction : fail closed. Ce candidat ne peut pas ouvrir DCN LIVE.

Principes consultés : [Stripe Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment),
[webhooks](https://docs.stripe.com/webhooks), [clés et séparation des modes](https://docs.stripe.com/keys).
La confirmation serveur et les endpoints dédiés suivent ces contraintes ; aucune validation
de compte LIVE ni recette Stripe/PayPal réelle n'est revendiquée.

## Tests réellement exécutés

- `npm ci` standard : PASS, lockfile et versions de dépendances inchangés.
- Suite `tests/**/*.test.ts` : **1 512 PASS / 0 FAIL / 1 SKIP** (1 513 tests).
  Les 20 tests DCN sont inclus : ne pas les additionner au total.
- SKIP préexistant : « Admin V2 generates and follows draft slugs without moving
  published URLs ». Il reste explicitement non exécuté ; rien n'a été supprimé.
- 18 groupes runtime PostgreSQL/FFmpeg/disque réels, rejoués sur une nouvelle base vide,
  plus 10 groupes de régression PostgreSQL : PASS. Ce sont des groupes, pas 28 paiements réels.
  Deux rôles runtime non propriétaires, droits positifs/négatifs et reprovisionnement/rotation.
- Dix appels concurrents, timeout avant/après création simulée, reprise de lease, refus,
  webhooks répétés/désordonnés simulés, protection Stripe/PayPal, kill-switch, remboursement
  réel de ligne **en DB locale sur preuve simulée**, tickets expirés et anti-IDOR : PASS local.
- ZIP de l'album contrôlé avec `unzip -t`, conservation des versions et noms : PASS.
- Signatures Stripe invalides, événement LIVE et contexte Connect rejetés avant requête
  Account : PASS local. Ce n'est pas une réception de webhook sandbox réelle.
- Lint, typecheck, Prisma format/validate/generate, build Web optimisé : PASS.
- Build worker historique dédié et graphe TypeScript worker DCN : PASS.
- `npm ls --all`, diff-check et scan de secrets du delta : PASS.
- Audit `--omit=dev` : **0 vulnérabilité**. Audit complet : **5 HIGH dev-only** inchangées,
  chaîne ESLint / fast-glob / micromatch / braces, GHSA-vfj7-8cjw-p6xm. Risque d'épuisement
  de pile sur motifs imbriqués dans l'outillage : à traiter séparément, pas à ignorer.
- Avertissement de dépréciation `pg` pendant le scénario concurrent réel ; tests réussis.
  Aucun upgrade de pg ni d'une autre dépendance n'a été fait.

Trois assertions de source Boutique, déjà obsolètes sur la base (produits externes DistroKid),
ont été actualisées dans les tests uniquement. Code et CSS Boutique sont identiques à la base.

## Revue locale et captures

Le build optimisé est servi sur **http://127.0.0.1:3140** uniquement, avec PostgreSQL local
sur port 55473. Données synthétiques ; une pochette déjà publique copiée à l'identique,
aucun master client/Production. Aucun credential financier dans le profil de revue.

| Page | Lien direct |
| --- | --- |
| Discographie / offres | http://127.0.0.1:3140/discographie |
| Album QA et deux extraits | http://127.0.0.1:3140/album/dcn-local-test |
| Panier numérique | http://127.0.0.1:3140/musique/panier |
| Checkout (compte vérifié ; sandbox absent, bouton fermé) | http://127.0.0.1:3140/musique/checkout |
| Bibliothèque (membre QA, achat **simulé**) | http://127.0.0.1:3140/compte/musique |
| Registre Admin | http://127.0.0.1:3140/admin/musique |
| Offres / imports Admin | http://127.0.0.1:3140/admin/musique/dcn-local-test |

Les identifiants **QA locaux seulement** sont dans `.private/dcn-review-credentials.json`
(mode 0600), jamais dans Git ni ce rapport. La configuration locale est également privée.
La bibliothèque dispose d'un achat simulé clairement TEST ; aucun débit chez un prestataire.
Les domaines historiques sont en lecture dans ce profil QA, sans leurs credentials paiement.

Si le serveur s'arrête : `npm run dcn:local:built` depuis le worktree ; `npm run dcn:local:worker`
pour les nouveaux imports. PostgreSQL doit être démarré. Le profil contient des chemins `/private/tmp`
et n'est pas un paquet de Production ; ne pas le copier dans Railway.

Captures réelles, pas des maquettes IA, dans :
`/Users/lnxbeats/.codex/visualizations/2026/08/09/019fe533-ab67-7791-9ed5-4a0c521aef42/dcn-1-0/`.
Album : 375/390/430/768/1440 px, absence de débordement mesurée, CTA 47 px et players 48 px.
Autres interfaces capturées à 390/1440 px. Safari/iPhone physique et charge mémoire : NOT_RUN.

### Index des captures

| Interface | Desktop 1440 | Mobile 390 |
| --- | --- | --- |
| Discographie | [capture](/Users/lnxbeats/.codex/visualizations/2026/08/09/019fe533-ab67-7791-9ed5-4a0c521aef42/dcn-1-0/discographie-desktop-1440.jpg) | [capture](/Users/lnxbeats/.codex/visualizations/2026/08/09/019fe533-ab67-7791-9ed5-4a0c521aef42/dcn-1-0/discographie-mobile-390.jpg) |
| Album / extraits | [capture](/Users/lnxbeats/.codex/visualizations/2026/08/09/019fe533-ab67-7791-9ed5-4a0c521aef42/dcn-1-0/album-desktop-1440.jpg) | [capture](/Users/lnxbeats/.codex/visualizations/2026/08/09/019fe533-ab67-7791-9ed5-4a0c521aef42/dcn-1-0/album-mobile-390.jpg) |
| Checkout | [capture](/Users/lnxbeats/.codex/visualizations/2026/08/09/019fe533-ab67-7791-9ed5-4a0c521aef42/dcn-1-0/checkout-desktop-1440.jpg) | [capture](/Users/lnxbeats/.codex/visualizations/2026/08/09/019fe533-ab67-7791-9ed5-4a0c521aef42/dcn-1-0/checkout-mobile-390.jpg) |
| Bibliothèque | [capture](/Users/lnxbeats/.codex/visualizations/2026/08/09/019fe533-ab67-7791-9ed5-4a0c521aef42/dcn-1-0/bibliotheque-desktop-1440.jpg) | [capture](/Users/lnxbeats/.codex/visualizations/2026/08/09/019fe533-ab67-7791-9ed5-4a0c521aef42/dcn-1-0/bibliotheque-mobile-390.jpg) |
| Import / offres Admin | [capture](/Users/lnxbeats/.codex/visualizations/2026/08/09/019fe533-ab67-7791-9ed5-4a0c521aef42/dcn-1-0/admin-desktop-1440.jpg) | [capture](/Users/lnxbeats/.codex/visualizations/2026/08/09/019fe533-ab67-7791-9ed5-4a0c521aef42/dcn-1-0/admin-mobile-390.jpg) |

[Panier mobile](/Users/lnxbeats/.codex/visualizations/2026/08/09/019fe533-ab67-7791-9ed5-4a0c521aef42/dcn-1-0/panier-mobile-390.jpg),
[upload navigateur prêt](/Users/lnxbeats/.codex/visualizations/2026/08/09/019fe533-ab67-7791-9ed5-4a0c521aef42/dcn-1-0/upload-browser-ready.jpg),
[registre Admin](/Users/lnxbeats/.codex/visualizations/2026/08/09/019fe533-ab67-7791-9ed5-4a0c521aef42/dcn-1-0/registre-admin-desktop-1440.jpg).
Ces deux dernières captures sont des preuves du scénario précédent de même logique métier,
pas une recette bancaire ni une preuve de restitution fiscale.

## Arbitrages et étapes restantes avant toute mise en ligne

1. Valider les prix réels par titre/album, la licence personnelle et le traitement d'un album
   partiellement possédé (actuellement achat bloqué, pas de remise implicite).
2. Valider l'expérience DCN sur les captures/local, la politique de futures versions/pistes,
   et les états publication/distribution/vente. Aucun ancien visuel ne constitue cet accord.
3. Finaliser et faire valider CGV numériques, consentement de fourniture immédiate, TVA,
   informations de facturation et conservation. La confirmation fiscale du Soutien ne vaut
   pas automatiquement qualification de ces ventes numériques.
4. Intégrer factures/avoirs et e-mails numériques sans fausses commandes physiques ni
   renumérotation des factures historiques. Raccorder refus/remboursements/litiges réels,
   réconciliation et revue opérateur ; aucun remboursement LIVE de QA.
5. Recette réelle Stripe TEST / PayPal SANDBOX avec leurs propres clés, merchant et signatures.
   Tester notamment 3DS, refus, événements, capture/refund sandbox. Les doubles ne suffisent pas.
6. Recette R2 isolée, CORS et grands fichiers, protection du worker/antivirus, purge contrôlée
   des uploads abandonnés, quotas/exploitation et réconciliation planifiée. Pas de service payant
   Railway créé. Intégration opérationnelle du worker DCN à décider avant release.
7. Recette physique Safari macOS/iPhone, accessibilité/clavier plus large, ZIP volumineux,
   performance et charge représentative ; compléter cas de catalogue volumineux/pagination.
8. Actualiser les règles de nettoyage/archivage existantes pour les clients détenant des
   achats DCN : les FK RESTRICT protègent les données, mais l'UX historique n'est pas encore adaptée.
9. Traiter les HIGH d'outillage avant release ; puis fetch/réconciliation, candidat exact,
   backup Production chiffré, restore et upgrade sur copie/ACL. Ces gates Production sont
   **NOT_RUN**, hors autorisation de cette mission locale.
10. Demander l'autorisation explicite de release. Aucun main/push/deploy, migration Production,
    paiement LIVE, webhook Production ou configuration Railway n'a été modifié ici.

Verdict : **prototype local fonctionnel, lots A/C terminés localement ; B/D/E partiels**.
**READY_FOR_LOCAL_REVIEW = YES ; READY_FOR_PRODUCTION = NO.**
