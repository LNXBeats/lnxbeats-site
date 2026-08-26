# Promotion Production — état préparatoire

La branche `feature/v0.8.0-main-promotion` au SHA `98b8bfcc6fd20bde054029821c70a7aba13a10da` devient obsolète dès l'intégration de V0.8.0.4 dans `develop`. Elle ne doit pas être poussée vers `main` et ne doit pas être supprimée. Une nouvelle branche de jonction devra être construite depuis le futur `origin/develop` et le `origin/main` alors courant.

Le candidat Railway devra prouver avant activation : SHA attendu, image contenant Prisma, Pre-deploy `npx prisma migrate deploy`, Start `npm start`, healthcheck `/api/health`, 18 migrations, paiements/notifications désarmés et scripts de diagnostic présents.

La configuration `/health` actuellement observée provient de l'ancien tree. Le nouveau [railway.toml](../railway.toml) impose `/api/health`; la checklist du candidat doit confirmer que Railway a chargé cette configuration du nouveau commit.

La séquence opérationnelle et les outils de données sont décrits dans [PRODUCTION_BOOTSTRAP.md](PRODUCTION_BOOTSTRAP.md). Aucun bootstrap ne fait partie du Pre-deploy.
