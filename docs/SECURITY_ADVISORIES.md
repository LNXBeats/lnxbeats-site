# Avis de sécurité des dépendances

## GHSA-ggr8-5vv4-36mx / CVE-2026-40345

Revue effectuée le 22 août 2026. Cette analyse constitue une investigation technique du dépôt LNX Studio, pas une acceptation implicite du risque.

### Faits publiés

- package : `deepmerge-ts` ;
- versions affectées : `< 8.0.0` ;
- versions corrigées : `>= 8.0.0` ;
- version retenue ici : `8.0.2`, dernière version stable au jour de la revue ;
- sévérité : High, CVSS v4 8.2 ;
- faiblesse : CWE-674, récursion non contrôlée ;
- impact : indisponibilité par épuisement synchrone de la pile.

Les API publiques `deepmerge`, `deepmergeCustom`, `deepmergeInto` et `deepmergeIntoCustom` étaient affectées. Deux valeurs contenant des auto-références au même chemin provoquaient une récursion sans suivi des objets visités. Un document JSON simple ne peut pas exprimer l’identité d’objet cyclique requise.

Sources :

- [advisory GitHub du mainteneur](https://github.com/RebeccaStevens/deepmerge-ts/security/advisories/GHSA-ggr8-5vv4-36mx) ;
- [release corrective deepmerge-ts 8.0.0](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0) ;
- [release Prisma stable 7.9.1](https://github.com/prisma/prisma/releases/tag/7.9.1).

### Graphe de dépendances avant correction

```text
lnx-studio
└── prisma@7.9.1 (devDependency racine et peer optionnel résolu)
    └── @prisma/config@7.9.1
        └── deepmerge-ts@7.1.5
```

Il existait une seule instance. L’application n’importe pas directement `deepmerge-ts`. `@prisma/config` 7.9.1 impose exactement `7.1.5` et le fournit comme `merger` à `c12` lors du chargement de `prisma.config.ts`. Prisma 7.9.1 reste la dernière version stable disponible au jour de la revue ; Prisma 8 n’est disponible qu’en release candidate.

Une installation `npm ci --omit=dev` conservait malgré tout Prisma, `@prisma/config` et `deepmerge-ts`, en raison des peers Prisma de `@prisma/client` et Better Auth. Avant correction, cette installation remontait trois vulnérabilités high liées au même advisory ; l’installation complète en remontait six.

### Reachability observée

| Phase ou entrée | Package chargé | Donnée transmise au merge |
| --- | --- | --- |
| `npm install` / `npm ci` | Oui via le `postinstall` `prisma generate` | configuration locale de confiance |
| `prisma generate` | Oui | `prisma.config.ts` |
| `prisma migrate deploy/status` | Oui | `prisma.config.ts` |
| `next build` | Pas par le build Next lui-même | aucune |
| `next start` | Pas dans les bundles applicatifs | aucune |
| requête HTTP ou webhook | Aucun chemin trouvé | aucune |
| formulaire MEMBER/ADMIN | Aucun chemin trouvé | aucune |
| upload | Aucun chemin trouvé | aucune |
| ligne PostgreSQL | Aucun chemin trouvé | aucune |
| variable d’environnement | Chaînes lues par `prisma.config.ts` pendant la CLI | objet acyclique construit par le code |

La dépendance restait physiquement présente dans l’installation de production, mais aucune route réseau LNX Studio ne chargeait l’API vulnérable. Les entrées JSON, FormData, URLSearchParams, lignes Prisma et chaînes d’environnement sont acycliques. Un attaquant distant ne pouvait pas fabriquer l’identité JavaScript auto-référencée nécessaire sans qu’un code applicatif transforme d’abord son entrée en graphe cyclique ; aucun tel code n’a été identifié.

Cette faible reachability ne suffisait pas à lever le gate tant que la version vulnérable restait installée.

### Matrice de décision

| Solution | Sécurité | Compatibilité | Risque de régression | Aptitude production |
| --- | --- | --- | --- | --- |
| Prisma 7 stable corrigé | Idéale | Aucune version disponible | Faible | À préférer lorsqu’elle existera |
| Mise à jour ciblée `@prisma/config` | Idéale | Aucune version stable distincte disponible | Moyen | Non applicable |
| Override `deepmerge-ts` 8.0.2 | Advisory supprimé | Probe complet réussi | Moyen, car major transitive | Retenue et surveillée |
| Aucun changement | Advisory reste installé | Maximale | Faible côté code, élevée côté gate | Refusée |
| Prisma 8 RC | Advisory supprimé | Migration majeure non évaluée | Élevé | Refusée sans gate humain séparé |

### Correctif retenu

`package.json` impose l’override npm exact suivant :

```json
{
  "overrides": {
    "deepmerge-ts": "8.0.2"
  }
}
```

Le lockfile contient une seule instance `8.0.2`. Prisma reste en `7.9.1` : aucune migration majeure ou RC n’est introduite. Les changements de comportement de deepmerge-ts 8 concernent principalement les Maps, certains types/customizers et `deepmergeInto`; `@prisma/config` utilise uniquement `deepmerge` comme merger de configurations ordinaires. Le test complet du vrai chargeur Prisma démontre la compatibilité requise pour ce dépôt.

### Preuves de correction

- PoC locale avant correction : `deepmerge` et `deepmergeInto` produisaient `RangeError: Maximum call stack size exceeded` ;
- même graphe avec 8.0.2 : cycles traités sans épuisement de pile ;
- `npm install`, `npm ci`, `npm ls --all`, Prisma generate/validate, typecheck et build : réussis ;
- PostgreSQL vierge : 17 migrations appliquées, `migrate status` à jour ;
- runtime remboursements : 14 groupes réussis, incluant transactions, contraintes, verrous advisory et rollback ;
- `npm audit` installation complète : zéro vulnérabilité ;
- `npm ci --omit=dev` : `deepmerge-ts@8.0.2` présent et zéro vulnérabilité.

Le test `npm run test:security` verrouille la version corrigée dans le manifeste, le lockfile et l’installation, puis rejoue localement les deux graphes cycliques publics de l’advisory. Il ne doit jamais être dirigé contre un service distant.

### Risque résiduel et maintenance

L’override est une substitution majeure transitive que Prisma 7.9.1 ne déclare pas encore officiellement. Le risque de compatibilité observé est couvert par les validations CLI, migration, runtime et application, sans pouvoir garantir tous les usages futurs de `@prisma/config`.

À chaque mise à jour Prisma :

1. contrôler la dépendance publiée de `@prisma/config` ;
2. conserver `test:security` et l’audit production ;
3. retirer l’override uniquement lorsqu’une version stable Prisma dépend elle-même d’une version corrigée ;
4. réexécuter les 17 migrations sur PostgreSQL jetable et les runtimes.

Décision V0.7.7 : **SECURITY ADVISORY RESOLVED** pour le code et les installations reproductibles issues de ce lockfile. Les autres gates juridiques, e-mail, paiements Live et QA production restent indépendants.
