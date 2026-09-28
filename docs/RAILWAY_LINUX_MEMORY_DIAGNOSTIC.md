# Diagnostic mémoire Linux Railway

Ce lot est une sonde temporaire d'observation du processus Web. Il ne change
aucun comportement métier, n'ajoute aucune route et reste inactif par défaut.

## Activation proposée

Pour une fenêtre contrôlée sur le seul service Web, conserver toute valeur
existante de `NODE_OPTIONS` puis lui ajouter :

```text
--require=./scripts/diagnostics/railway-linux-memory-preload.cjs
```

Activer ensuite explicitement la sonde avec :

```text
RAILWAY_LINUX_MEMORY_DIAGNOSTICS=observe-v1
RAILWAY_LINUX_MEMORY_DIAGNOSTICS_DURATION_MINUTES=30
```

La durée peut être choisie entre 30 et 60 minutes. Toute valeur hors plage est
bornée à cette plage. La fréquence normale est fixe : un snapshot au démarrage,
un après 60 secondes de warmup, puis un toutes les cinq minutes. La sonde se
désactive automatiquement, restaure ses hooks et ne conserve aucun historique
en mémoire.

`MEMORY_DIAGNOSTICS_ENABLED`, déjà utilisé par les compteurs média existants,
n'active pas cette sonde Linux.

## Données collectées

- identité technique du processus Node, uptime et `process.memoryUsage()` ;
- compteurs mémoire autorisés de `/proc/self/status` ;
- `memory.current`, `memory.max`, `memory.stat` et `memory.events` du cgroup ;
- PID, PPID, nom de processus et RSS des processus visibles dans le conteneur ;
- nombre d'instances Prisma enregistrées et compteurs agrégés des pools `pg` ;
- booléens indiquant si `pdfkit`, `crypto-js`, `jpeg-exif`, `ffmpeg-static` et
  `sharp` ont déjà été chargés ;
- classes des handles et requêtes Node actifs ;
- stack technique du warning `pg` ciblé s'il se reproduit.

La stack `pg` est capturée par un listener limité au message de dépréciation
recherché. Le flag global `--trace-deprecation` n'est donc pas nécessaire et
n'ajoutera pas le bruit d'autres dépréciations à cette fenêtre.

La sonde ne lit ni les valeurs d'environnement, ni les arguments des processus,
ni SQL, ni payload HTTP. Elle ne journalise aucune URL de base, credential,
requête ou donnée utilisateur.

## Arrêt et retrait

L'arrêt normal est automatique après la durée choisie. Un arrêt anticipé exige
de retirer les deux variables de diagnostic et les options ajoutées à
`NODE_OPTIONS`, puis de redémarrer uniquement le service Web selon la procédure
Railway validée. Aucun endpoint ni signal distant n'est exposé.

Le retrait définitif du lot consiste à supprimer le preload, son test, ce
document et le petit hook optionnel de `lib/prisma.ts`.

## Fenêtre de mesure proposée

1. Relever le deployment et le SHA Web avant activation.
2. Appliquer seulement les variables ci-dessus au service Web, sans changer les
   ressources, replicas ou services secondaires.
3. Observer 30 minutes, sans charge artificielle Production.
4. Exporter uniquement les lignes préfixées `[railway-linux-memory]` et les
   éventuelles stacks de dépréciation.
5. Retirer l'activation et redéployer le même SHA sans la sonde active.
6. Vérifier `/api/health`, le SHA servi et l'absence de nouveau snapshot.

Cette procédure est seulement proposée : aucune mutation Railway n'est incluse
dans le présent lot.
