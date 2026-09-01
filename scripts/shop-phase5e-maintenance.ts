import { prisma } from "@/lib/prisma";
import { runShopReadinessMaintenance } from "@/lib/shop/readiness-scheduler";

async function main() {
  try {
    const result = await runShopReadinessMaintenance();
    console.info(`SHOP_PHASE5E_MAINTENANCE ${result.outcome}`);
    console.info(JSON.stringify(result));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("SHOP_PHASE5E_MAINTENANCE FAILED", error instanceof Error ? error.message : "unknown");
  process.exitCode = 1;
});
