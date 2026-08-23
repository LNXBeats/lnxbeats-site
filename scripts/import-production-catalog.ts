import { applyProductionCatalogImport, planProductionCatalogImport } from "@/lib/production/catalog-import";
import { prisma } from "@/lib/prisma";
import { safeProductionBootstrapErrorMessage } from "@/lib/production/bootstrap-environment";

const allowedArguments = new Set(["--apply"]);
const argumentsProvided = process.argv.slice(2);
const unknownArgument = argumentsProvided.find((argument) => !allowedArguments.has(argument));
const apply = argumentsProvided.includes("--apply");

async function run() {
  if (unknownArgument) throw new Error("Unsupported production catalogue import argument.");
  const plan = await planProductionCatalogImport(prisma);
  console.info("CATALOG_PRODUCTION_IMPORT");
  console.info(`sourceVersion=${plan.sourceVersion}`);
  console.info(`sourceProjects=${plan.sourceProjects}`);
  console.info(`sourceTracks=${plan.sourceTracks}`);
  console.info(`sourceCredits=${plan.sourceCredits}`);
  console.info(`sourcePlatformLinks=${plan.sourcePlatformLinks}`);
  console.info(`existingProjects=${plan.existingProjects}`);
  console.info(`wouldCreate=${plan.creates.length}`);
  console.info(`wouldSkip=${plan.skips.length}`);
  console.info("conflicts=0");
  if (!apply) {
    console.info("status=DRY_RUN_SAFE");
    return;
  }
  const result = await applyProductionCatalogImport(prisma);
  console.info(`created=${result.created}`);
  console.info(`skipped=${result.skipped}`);
  console.info("status=APPLIED");
}

run()
  .catch((error: unknown) => {
    console.error(safeProductionBootstrapErrorMessage(error, "Production catalogue import failed safely; inspect server diagnostics."));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
