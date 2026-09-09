import { prisma } from "@/lib/prisma";
import { activateDueRightsLicenses } from "@/lib/rights/payment-repository";
import { runShopReadinessMaintenance } from "@/lib/shop/readiness-scheduler";

let exitCode = 0;
try {
  const [shop, rights] = await Promise.allSettled([
    runShopReadinessMaintenance(),
    activateDueRightsLicenses(),
  ]);
  if (shop.status === "fulfilled") {
    console.info(JSON.stringify({ event: "shop.maintenance.completed", ...shop.value }));
  } else {
    console.error(JSON.stringify({ event: "shop.maintenance.failed", error: shop.reason instanceof Error ? shop.reason.name : "UnknownError" }));
  }
  if (rights.status === "fulfilled") {
    console.info(JSON.stringify({ event: "rights.activation.completed", ...rights.value }));
  } else {
    console.error(JSON.stringify({ event: "rights.activation.failed", error: rights.reason instanceof Error ? rights.reason.name : "UnknownError" }));
  }
  if (shop.status === "rejected" || rights.status === "rejected") exitCode = 1;
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
