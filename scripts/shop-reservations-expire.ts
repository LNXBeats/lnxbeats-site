import { prisma } from "@/lib/prisma";
import { expireShopOrderReservations } from "@/lib/shop/order-service";
import { loadAndAssertShopPhase2QaExpiryEnvironment } from "@/lib/shop/qa-guard";

const BATCH_LIMIT = 50;

async function main() {
  const runtime = await loadAndAssertShopPhase2QaExpiryEnvironment();
  const expired = await expireShopOrderReservations(new Date(), BATCH_LIMIT);
  console.info(JSON.stringify({
    event: "shop.stock.expiry.completed",
    outcome: "completed",
    target: runtime.target,
    expired,
    limit: BATCH_LIMIT,
  }));
}

main()
  .catch(() => {
    console.error(JSON.stringify({
      event: "shop.stock.expiry.failed",
      outcome: "failed",
      code: "SHOP_EXPIRY_COMMAND_FAILED",
    }));
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch {
      console.error(JSON.stringify({
        event: "shop.stock.expiry.disconnect.failed",
        outcome: "failed",
        code: "DATABASE_DISCONNECT_FAILED",
      }));
      process.exitCode = 1;
    }
  });
