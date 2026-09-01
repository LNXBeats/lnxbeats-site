import { prisma } from "@/lib/prisma";
import { runShopReadinessMaintenance } from "@/lib/shop/readiness-scheduler";

let exitCode = 0;
try {
  const result = await runShopReadinessMaintenance();
  console.info(JSON.stringify({ event: "shop.maintenance.completed", ...result }));
} catch (error) {
  exitCode = 1;
  console.error(JSON.stringify({
    event: "shop.maintenance.failed",
    error: error instanceof Error ? error.name : "UnknownError",
  }));
} finally {
  await prisma.$disconnect().catch(() => { exitCode = 1; });
}

process.exitCode = exitCode;
