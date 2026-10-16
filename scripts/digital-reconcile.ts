import "server-only";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { prisma } from "@/lib/prisma";
import { DigitalError, requireDigitalEnvironment } from "@/lib/digital/domain";
import { reconcileDigitalOrder } from "@/lib/digital/commerce";
import { processDigitalInbox } from "@/lib/digital/inbox";
import { processDigitalRefund } from "@/lib/digital/finance";
import { digitalFinanceGateway } from "@/lib/digital/finance-providers";
import { createDigitalWorkerCycle, type DigitalWorkerDependencies } from "@/lib/digital/worker-cycle";

/** Provider READ recovery only. A worker cannot execute an Admin refund request. */
export const digitalReconciliationDependencies: Pick<DigitalWorkerDependencies,
  "inbox" | "pendingOrders" | "recoverOrder" | "pendingRefunds" | "recoverRefund"> = {
  inbox: limit => processDigitalInbox(limit),
  async pendingOrders(mode, take, afterId) {
    return prisma.digitalOrder.findMany({ where: { mode, status: { in: ["PENDING", "REQUIRES_REVIEW"] },
      ...(afterId ? { id: { gt: afterId } } : {}) }, orderBy: { id: "asc" }, take, select: { id: true, mode: true } });
  },
  recoverOrder: id => reconcileDigitalOrder(id),
  async pendingRefunds(mode, take, afterId) {
    const rows = await prisma.digitalRefund.findMany({ where: { order: { mode }, status: { in: ["PENDING", "REQUIRES_REVIEW"] },
      ...(afterId ? { id: { gt: afterId } } : {}) }, orderBy: { id: "asc" }, take,
      select: { id: true, status: true, order: { select: { mode: true } } } });
    return rows.map(row => ({ id: row.id, status: row.status, mode: row.order.mode }));
  },
  async recoverRefund(id) {
    const mode = requireDigitalEnvironment();
    const row = await prisma.digitalRefund.findFirst({ where: { id, order: { mode }, status: { in: ["PENDING", "REQUIRES_REVIEW"] } },
      select: { provider: true } });
    if (!row) return;
    const gateway = digitalFinanceGateway(row.provider, mode);
    await processDigitalRefund(id, { ...gateway, async refund() { throw new DigitalError("WORKER_REFUND_MUTATION_FORBIDDEN", 409); } });
  },
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const noop = async () => undefined;
  const cycle = createDigitalWorkerCycle({ ...digitalReconciliationDependencies, documents: noop, notifications: noop, media: noop });
  try { console.log(JSON.stringify(await cycle(undefined, true))); }
  finally { await prisma.$disconnect(); }
}
