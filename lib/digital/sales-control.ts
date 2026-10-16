import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { OrderActor } from "@/lib/orders/domain";
import { prisma } from "@/lib/prisma";
import { DigitalError, assertDigitalUuid, requireDigitalEnvironment, type DigitalMode } from "./domain";
import { digitalNewSalesAllowed } from "./runtime-policy";

export const DIGITAL_SALES_CONTROL_EVENT = "DIGITAL_NEW_SALES_CONTROL";
type Db = Pick<Prisma.TransactionClient, "digitalEvent" | "user" | "$queryRaw">;
export type DigitalSalesControl = { eventId: string | null; enabled: boolean; reviewRequired: boolean; changedAt: string | null };

export async function digitalSalesControl(db: Db, mode: DigitalMode): Promise<DigitalSalesControl> {
  const event = await db.digitalEvent.findFirst({ where: { kind: DIGITAL_SALES_CONTROL_EVENT, details: { path: ["mode"], equals: mode } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, actorId: true, details: true, createdAt: true } });
  if (!event) return { eventId: null, enabled: true, reviewRequired: false, changedAt: null };
  const details = event.details as { policy?: string; mode?: string; enabled?: unknown } | null;
  const actor = event.actorId ? await db.user.findUnique({ where: { id: event.actorId }, select: { role: true, status: true, emailVerified: true } }) : null;
  const valid = details?.policy === "DCN_NEW_SALES_CONTROL_1" && details.mode === mode && typeof details.enabled === "boolean"
    && actor?.role === "ADMIN" && actor.status === "ACTIVE" && actor.emailVerified === true;
  return { eventId: event.id, enabled: valid && details!.enabled === true, reviewRequired: !valid, changedAt: event.createdAt.toISOString() };
}

/** The shared transaction lock orders new commitments against an Admin pause.
 * It never gates already acquired access, provider evidence or refunds.
 */
export async function assertDigitalLiveNewSale(db: Db, mode: DigitalMode) {
  if (mode !== "LIVE") return;
  await db.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${`digital-new-sales:${mode}`})) IS NULL AS locked`;
  if (!digitalNewSalesAllowed(mode) || !(await digitalSalesControl(db, mode)).enabled) throw new DigitalError("NEW_DIGITAL_PAYMENTS_CLOSED", 503);
}

export async function setDigitalSalesControl(actor: OrderActor, input: { enabled: boolean; expectedEventId: string | null; idempotencyKey: string }) {
  const mode = requireDigitalEnvironment();
  if (actor.role !== "ADMIN" || actor.status !== "ACTIVE" || !actor.emailVerified) throw new DigitalError("ADMIN_REQUIRED", 403);
  if (typeof input.enabled !== "boolean") throw new DigitalError("INVALID_BODY");
  assertDigitalUuid(input.idempotencyKey); if (input.expectedEventId !== null) assertDigitalUuid(input.expectedEventId);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-new-sales:${mode}`})) IS NULL AS locked`;
    const reviewer = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true, status: true, emailVerified: true } });
    if (reviewer?.role !== "ADMIN" || reviewer.status !== "ACTIVE" || reviewer.emailVerified !== true) throw new DigitalError("ADMIN_REQUIRED", 403);
    const externalKey = `digital-sales-control:${mode}:${input.idempotencyKey}`;
    const previous = await tx.digitalEvent.findUnique({ where: { externalKey } });
    if (previous) {
      const details = previous.details as { mode?: string; enabled?: unknown } | null;
      if (previous.actorId !== actor.id || details?.mode !== mode || details.enabled !== input.enabled) throw new DigitalError("IDEMPOTENCY_CONFLICT", 409);
      return digitalSalesControl(tx, mode);
    }
    const current = await digitalSalesControl(tx, mode);
    if (current.eventId !== input.expectedEventId) throw new DigitalError("STALE_SALES_CONTROL", 409);
    // Timestamp after the lock, not PostgreSQL's transaction-start default:
    // a request waiting for another instruction must sort after that instruction.
    const createdAt = new Date(Math.max(Date.now(), current.changedAt ? Date.parse(current.changedAt) + 1 : 0));
    await tx.digitalEvent.create({ data: { actorId: actor.id, kind: DIGITAL_SALES_CONTROL_EVENT, externalKey, createdAt,
      details: { policy: "DCN_NEW_SALES_CONTROL_1", mode, enabled: input.enabled, previousEventId: current.eventId } } });
    return digitalSalesControl(tx, mode);
  });
}
