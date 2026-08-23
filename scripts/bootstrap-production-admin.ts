import { applyProductionAdminBootstrap, planProductionAdminBootstrap } from "@/lib/production/admin-bootstrap";
import { prisma } from "@/lib/prisma";
import { safeProductionBootstrapErrorMessage } from "@/lib/production/bootstrap-environment";

const allowedArguments = new Set(["--apply"]);
const argumentsProvided = process.argv.slice(2);
const unknownArgument = argumentsProvided.find((argument) => !allowedArguments.has(argument));
const apply = argumentsProvided.includes("--apply");

async function run() {
  if (unknownArgument) throw new Error("Unsupported production admin bootstrap argument.");
  const plan = await planProductionAdminBootstrap(prisma);
  console.info("ADMIN_BOOTSTRAP");
  console.info("environment=production");
  console.info("database=reachable");
  console.info(`existingUsers=${plan.existingUsers}`);
  console.info(`existingAdmins=${plan.existingAdmins}`);
  console.info("targetEmailConfigured=true");
  console.info(`targetEmail=${plan.targetEmailMasked}`);
  console.info(`action=${plan.action}`);
  if (!apply) {
    console.info("status=DRY_RUN_SAFE");
    return;
  }
  const result = await applyProductionAdminBootstrap(prisma);
  console.info(`result=${result.action}`);
  console.info(`completedAt=${new Date().toISOString()}`);
  console.info("status=APPLIED");
}

run()
  .catch((error: unknown) => {
    console.error(safeProductionBootstrapErrorMessage(error, "Production admin bootstrap failed safely; inspect server diagnostics."));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
