/** Internal bounded job, never a public diagnostic endpoint. May be scheduled
 * by the operator independently of browsers/webhooks. No payment POSTs. */
import { prisma } from "@/lib/prisma";
import { requireSupportTestEnvironment } from "@/lib/support/config";
import { reconcileSupportContribution } from "@/lib/support/service";
requireSupportTestEnvironment();
let checked = 0, pending = 0;
try {
  const values = await prisma.supportContribution.findMany({ where: { mode: "TEST", status: { in: ["CREATED", "PENDING", "REFUND_PENDING"] },
    attempts: { some: { OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(Date.now() - 300000) } }] } } },
    select: { id: true }, take: 50, orderBy: { updatedAt: "asc" } });
  for (const value of values) { try { await reconcileSupportContribution(value.id); checked++; } catch { pending++; } }
  console.log(JSON.stringify({ checked, pending, providerMode: "TEST", mutations: "ledger-only; provider GET-only" }));
} finally { await prisma.$disconnect(); }
