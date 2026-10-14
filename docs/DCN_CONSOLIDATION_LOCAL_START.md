# Démarrer la consolidation DCN locale

Version de revue, prix fictifs, aucun paiement réel. Aucun tunnel, accès R2 ou credential prestataire nécessaire.

## Sur ce Mac, données déjà préparées

```sh
cd /Users/lnxbeats/.codex/worktrees/dcn-1-0/lnxbeats-site-v1
node --import tsx scripts/digital-local-server.ts web-built consolidation
```

Si ce serveur est déjà actif, ne pas en démarrer un second. Ouvrir `http://127.0.0.1:3140`. Application loopback 3140 ; PostgreSQL loopback 55473. Aucun accès entrant Internet ou HTTPS privé ajouté par ce lot.

- Album : `/album/dcn-consolidation-7b2ebd49-4e0c-42b0-80e6-d17484cce6d5`.
- Bibliothèque : `/compte/musique` ; panier : `/musique/panier`.
- Admin album : `/admin/musique/dcn-consolidation-7b2ebd49-4e0c-42b0-80e6-d17484cce6d5`.
- Politiques : `/admin/musique/juridictions?pays=FR` ; brouillons publics de revue : `/musique/conditions`.

Les accès **synthétiques locaux** sont dans `.private/dcn-consolidation-browser-credentials.json`, fichier 0600 à consulter uniquement dans un éditeur local privé ; ne pas le copier dans le chat, une capture ou un rapport. Se connecter par le formulaire normal. La restitution ne contient pas ce fichier ni les profils de DB. Aucun mot de passe historique n’a été changé par cette consolidation.

Le compte de revue possède déjà un titre partiellement remboursé et l’album complété à 8,90 € en simulation locale. La bibliothèque présente WAV, MP3, ZIP WAV, ZIP MP3 et les PDF QA. Les liens peuvent être renouvelés ; ne pas rejouer les scripts de fixtures pour « recommencer » un achat historique.

## Développement facultatif

Arrêter uniquement le serveur QA lancé avec Ctrl-C avant build ou remplacement du processus.

```sh
node --import tsx scripts/digital-local-server.ts web consolidation
```

Le lanceur refuse un autre profil DB, le marchand réel, les clés prestataires et l’activation de nouveaux paiements. Les fixtures QA pays ne valent jamais approbation fiscale. Aucun travailleur n’est nécessaire pour consulter les deux ZIP déjà prêts. Ne pas lancer un worker général uniquement pour traiter des anciennes files QA ; les helpers de ce lot disposent de filtres d’ordres/lignes précis.

## Transfert à un autre ordinateur

Le ZIP est une **restitution de revue**, pas une image déployable et pas un export de base. Il s’ouvre hors ligne avec `index.html`, sans compte ni serveur. Les profils privés, masters et bases n’y figurent volontairement pas. Pour une nouvelle installation, préparer séparément une DB QA isolée et un profil local autorisé ; ne jamais récupérer `.env`/credentials de Production.

Les scripts de sauvegarde/upgrade refusent d’écraser une copie déjà existante. Les trois migrations sont de nouveaux fichiers non appliqués en Production. Aucun nettoyage global, `reset`, suppression de données ou reprise de campagne prestataire n’est une étape de lancement local.
