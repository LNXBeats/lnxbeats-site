import "server-only";

import { randomUUID } from "node:crypto";
import { CREATION_WORK_STATUSES, DEADLINE_NOTE_PREFIX, VISIBILITY_NOTE_PREFIX, WORK_NOTE_PREFIX, isWorkHidden, parseParisDeadline, parseWorkNote } from "@/lib/admin/creation-work-policy";
import { prisma } from "@/lib/prisma";

const LIMIT = 200;

export async function getCreationWorkQueue() {
  const orders = await prisma.order.findMany({
    where: { OR: [
      { status: { in: CREATION_WORK_STATUSES } },
      { events: { some: { visibility: "INTERNAL", actorUserId: { not: null }, note: { startsWith: VISIBILITY_NOTE_PREFIX } } } },
    ] },
    select: {
      id: true, orderNumber: true, title: true, status: true, updatedAt: true, createdAt: true, submittedAt: true,
      events: { where: { toStatus: { in: ["ACCEPTED", "IN_PROGRESS"] }, OR: [{ note: null }, { NOT: { note: { startsWith: WORK_NOTE_PREFIX } } }] }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 1, select: { createdAt: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: LIMIT + 1,
  });
  const shown = orders.slice(0, LIMIT);
  const ids = shown.map(({ id }) => id);
  const notes = await prisma.orderEvent.findMany({
    where: { orderId: { in: ids }, visibility: "INTERNAL", actorUserId: { not: null }, note: { startsWith: DEADLINE_NOTE_PREFIX } },
    distinct: ["orderId"], orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { orderId: true, id: true, note: true },
  });
  const visibility = await prisma.orderEvent.findMany({
    where: { orderId: { in: ids }, visibility: "INTERNAL", actorUserId: { not: null }, note: { startsWith: VISIBILITY_NOTE_PREFIX } },
    distinct: ["orderId"], orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { orderId: true, id: true, note: true },
  });
  const items = shown.map((order) => {
    const note = notes.find(({ orderId }) => orderId === order.id);
    const hiddenNote = visibility.find(({ orderId }) => orderId === order.id);
    const parsed = parseWorkNote(note?.note ?? null, "DEADLINE");
    const deadline = parsed?.orderId === order.id ? parsed : null;
    return {
      id: order.id, orderNumber: order.orderNumber, title: order.title || "Création personnalisée", status: order.status,
      updatedAt: order.updatedAt.toISOString(),
      startedAt: deadline?.startedAt ?? (order.events[0]?.createdAt ?? order.submittedAt ?? order.createdAt).toISOString(),
      dueAt: deadline?.dueAt ?? null, deadlineRevision: note?.id ?? "", visibilityRevision: hiddenNote?.id ?? "",
      deadlineRequestId: randomUUID(), visibilityRequestId: randomUUID(),
      hidden: isWorkHidden(parseWorkNote(hiddenNote?.note ?? null, "VISIBILITY"), order),
    };
  });
  return {
    items: items.filter((item) => !item.hidden && CREATION_WORK_STATUSES.includes(item.status))
      .sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999") || a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id)),
    hidden: items.filter((item) => item.hidden), limited: orders.length > LIMIT, now: new Date().toISOString(),
  };
}

export async function updateCreationWork(input: {
  orderNumber: string; actorUserId: string; requestId: string; expectedUpdatedAt: string;
  expectedRevision: string; kind: "DEADLINE" | "HIDE" | "RESTORE"; deadline?: string; confirmedTest?: boolean;
}) {
  if (!["DEADLINE", "HIDE", "RESTORE"].includes(input.kind) || !/^LNX-\d{4}-\d{6}$/.test(input.orderNumber) || !/^[0-9a-f-]{36}$/i.test(input.requestId)) throw new Error("Requête invalide.");
  return prisma.$transaction(async (tx) => {
    // Same lock as the existing lifecycle and payments engines. No external
    // call, status update, refund, cancellation or global archive operation.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`payments:order:${input.orderNumber}`})) IS NULL AS locked`;
    const admin = await tx.user.findFirst({ where: { id: input.actorUserId, role: "ADMIN", status: "ACTIVE" }, select: { id: true } });
    if (!admin) throw new Error("Accès administrateur requis.");
    const order = await tx.order.findUnique({ where: { orderNumber: input.orderNumber }, select: {
      id: true, status: true, updatedAt: true, submittedAt: true, createdAt: true,
      events: { where: { toStatus: { in: ["ACCEPTED", "IN_PROGRESS"] }, OR: [{ note: null }, { NOT: { note: { startsWith: WORK_NOTE_PREFIX } } }] }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 1, select: { createdAt: true } },
    } });
    if (!order) throw new Error("Commande introuvable.");
    const prefix = input.kind === "DEADLINE" ? DEADLINE_NOTE_PREFIX : VISIBILITY_NOTE_PREFIX;
    const previous = await tx.orderEvent.findFirst({ where: { orderId: order.id, visibility: "INTERNAL", actorUserId: { not: null }, note: { startsWith: prefix } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, note: true, createdAt: true } });
    const replay = await tx.orderEvent.findFirst({ where: { orderId: order.id, visibility: "INTERNAL", note: { startsWith: prefix, contains: `"requestId":"${input.requestId}"` } }, select: { id: true } });
    if (replay) return replay.id;
    if (order.updatedAt.toISOString() !== input.expectedUpdatedAt || (previous?.id ?? "") !== input.expectedRevision) throw new Error("Le dossier a changé. Rechargez le Centre d’action.");
    let payload;
    if (input.kind === "DEADLINE") {
      if (!CREATION_WORK_STATUSES.includes(order.status)) throw new Error("Création inactive.");
      const dueAt = parseParisDeadline(input.deadline);
      const stored = parseWorkNote(previous?.note ?? null, "DEADLINE");
      const startedAt = stored?.orderId === order.id ? new Date(stored.startedAt) : order.events[0]?.createdAt ?? order.submittedAt ?? order.createdAt;
      if (!dueAt || dueAt <= startedAt) throw new Error("Choisissez une échéance valide, postérieure au début du suivi (heure de Paris non ambiguë).");
      payload = { orderId: order.id, requestId: input.requestId, startedAt: startedAt.toISOString(), dueAt: dueAt.toISOString() };
    } else {
      if (input.kind === "HIDE" && input.confirmedTest !== true) throw new Error("Confirmez cet essai personnel.");
      payload = { orderId: order.id, requestId: input.requestId, hidden: input.kind === "HIDE", status: order.status, updatedAt: order.updatedAt.toISOString(), reason: "OWNER_CONFIRMED_TEST" };
    }
    // Preserve audit ordering at millisecond precision even if two requests
    // acquired the same lock during one clock tick (UUIDs are not sequences).
    const createdAt = new Date(Math.max(Date.now(), (previous?.createdAt.getTime() ?? 0) + 1));
    const event = await tx.orderEvent.create({ data: { orderId: order.id, toStatus: order.status, visibility: "INTERNAL", actorUserId: admin.id, note: prefix + JSON.stringify(payload), createdAt }, select: { id: true } });
    return event.id;
  });
}
