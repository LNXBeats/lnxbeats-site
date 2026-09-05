import "server-only";

import type { Prisma } from "@/generated/prisma/client";

type Transaction = Prisma.TransactionClient;

/** Shared historical lock boundary for a Shop SAV RefundAttempt. */
export async function lockShopRefundAttemptForMutation(
  transaction: Transaction,
  attemptId: string,
) {
  await transaction.$queryRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${`shop-after-sales:refund:${attemptId}`}, 0)) IS NULL AS locked
  `;
}
