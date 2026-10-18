import type { KnownOrderStatus } from "@/lib/orders/status";

export const CREATION_WORK_STATUSES: KnownOrderStatus[] = [
  "PAYMENT_CONFIRMED", "RECEIVED", "SUBMITTED", "REVIEWING", "ACCEPTED",
  "IN_PROGRESS", "FIRST_VERSION_READY", "REVISION_REQUESTED", "FINALIZING",
];
export const WORK_NOTE_PREFIX = "ADMIN_CREATION_WORK_V1:";
export const DEADLINE_NOTE_PREFIX = `${WORK_NOTE_PREFIX}DEADLINE:`;
export const VISIBILITY_NOTE_PREFIX = `${WORK_NOTE_PREFIX}VISIBILITY:`;

export type WorkSnapshot = { id: string; status: string; updatedAt: Date };
export type DeadlineNote = { orderId: string; requestId: string; startedAt: string; dueAt: string };
export type VisibilityNote = { orderId: string; requestId: string; hidden: boolean; status: string; updatedAt: string; reason: "OWNER_CONFIRMED_TEST" };

function validDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

export function parseWorkNote(note: string | null, kind: "DEADLINE"): DeadlineNote | null;
export function parseWorkNote(note: string | null, kind: "VISIBILITY"): VisibilityNote | null;
export function parseWorkNote(note: string | null, kind: "DEADLINE" | "VISIBILITY") {
  const prefix = kind === "DEADLINE" ? DEADLINE_NOTE_PREFIX : VISIBILITY_NOTE_PREFIX;
  if (!note?.startsWith(prefix) || note.length > 1_000) return null;
  try {
    const value = JSON.parse(note.slice(prefix.length));
    if (!value || typeof value.orderId !== "string" || !/^[0-9a-f-]{36}$/i.test(value.requestId ?? "")) return null;
    if (kind === "DEADLINE") {
      if (!validDate(value.startedAt) || !validDate(value.dueAt) || value.dueAt <= value.startedAt) return null;
      return value as DeadlineNote;
    }
    if (typeof value.hidden !== "boolean" || typeof value.status !== "string" || !validDate(value.updatedAt) || value.reason !== "OWNER_CONFIRMED_TEST") return null;
    return value as VisibilityNote;
  } catch { return null; }
}

export function isWorkHidden(note: VisibilityNote | null, order: WorkSnapshot) {
  // A new business update resurfaces the request. This preference never closes
  // financial obligations and never applies to another order or customer.
  return Boolean(note?.hidden && note.orderId === order.id && note.status === order.status && note.updatedAt === order.updatedAt.toISOString());
}

const paris = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
export function parisDateTime(value: Date) {
  const p = Object.fromEntries(paris.formatToParts(value).map(({ type, value: part }) => [type, part]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export function parseParisDeadline(raw: unknown): Date | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return null;
  const wall = Date.parse(`${raw}:00.000Z`);
  if (!Number.isFinite(wall)) return null;
  // Explicit offsets, rather than the host/browser timezone. Reject invalid
  // dates, nonexistent spring times and ambiguous autumn times.
  const candidates = [60, 120].map((minutes) => new Date(wall - minutes * 60_000))
    .filter((date) => parisDateTime(date) === raw);
  return candidates.length === 1 ? candidates[0] : null;
}

export function deadlineGauge(startedAt: string, dueAt: string | null, now: number) {
  const start = Date.parse(startedAt), due = dueAt ? Date.parse(dueAt) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(due) || due <= start) return { tone: "unplanned", percent: 0, label: "Échéance à planifier" } as const;
  const remaining = due - now;
  const fraction = Math.max(0, Math.min(1, remaining / (due - start)));
  const minutes = Math.ceil(Math.abs(remaining) / 60_000);
  const days = Math.floor(minutes / 1_440), hours = Math.floor((minutes % 1_440) / 60);
  const duration = days ? `${days} j${hours ? ` ${hours} h` : ""}` : hours ? `${hours} h ${minutes % 60} min` : `${Math.max(1, minutes)} min`;
  return {
    tone: remaining <= 0 ? "overdue" : fraction <= .1 ? "critical" : fraction <= .25 ? "urgent" : fraction <= .5 ? "watch" : "comfortable",
    percent: Math.round((1 - fraction) * 100),
    label: remaining <= 0 ? `En retard de ${duration}` : `${duration} restantes`,
  } as const;
}
