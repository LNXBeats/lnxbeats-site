import { digitalProviderRequestsAllowed, digitalRuntimeMode, type DigitalEnvironment, type DigitalMode } from "./runtime-policy";

/** Scheduling only. Financial mutations are deliberately absent from this API. */
export const DIGITAL_WORKER_BATCH = Object.freeze({ inbox: 5, payments: 5, refunds: 3, documents: 2, notifications: 2 });
export const DIGITAL_WORKER_RECONCILE_MS = 60_000;
export type DigitalWorkerOrder = { id: string; mode: string };
export type DigitalWorkerRefund = { id: string; status: string; mode: string };
export type DigitalWorkerDependencies = {
  inbox(limit: number): Promise<unknown>;
  pendingOrders(mode: DigitalMode, limit: number, afterId?: string): Promise<DigitalWorkerOrder[]>;
  recoverOrder(id: string): Promise<unknown>;
  pendingRefunds(mode: DigitalMode, limit: number, afterId?: string): Promise<DigitalWorkerRefund[]>;
  recoverRefund(id: string): Promise<unknown>;
  documents(limit: number): Promise<unknown>;
  notifications(limit: number): Promise<unknown>;
  media(kind: "audio" | "zip", signal: AbortSignal): Promise<unknown>;
};

export function digitalWorkerMode(env: DigitalEnvironment = process.env) {
  return env.DCN_WORKER_ENABLED === "true" ? digitalRuntimeMode(env) : null;
}

/** Audio/ZIP needs database and scoped object storage, never PSP or mail keys. */
export function digitalMediaWorkerEnvironment(env: DigitalEnvironment = process.env): NodeJS.ProcessEnv {
  const nodeEnvironment = env.NODE_ENV ?? process.env.NODE_ENV ?? "development";
  if (nodeEnvironment !== "development" && nodeEnvironment !== "test" && nodeEnvironment !== "production") throw new Error("INVALID_NODE_ENV");
  // Next's ambient ProcessEnv requires an explicit, valid NODE_ENV. LIVE
  // runtime is already gated on production; this fallback cannot enable it.
  return { ...Object.fromEntries(Object.entries(env).filter(([name]) => !/^(?:DCN_)?(?:STRIPE|PAYPAL|RESEND)(?:_|$)/i.test(name))),
    NODE_ENV: nodeEnvironment };
}

/** One sequential, non-reentrant cycle. Existing DB leases remain authoritative.
 * Closing new sales never closes inbox, document, mail or acquired ZIP work.
 */
export function createDigitalWorkerCycle(dependencies: DigitalWorkerDependencies,
  options: { env?: () => DigitalEnvironment; now?: () => number } = {}) {
  const environment = options.env ?? (() => process.env), now = options.now ?? Date.now;
  let running = false, nextReconciliationAt = 0, orderCursor: string | undefined, refundCursor: string | undefined;
  return async (signal: AbortSignal = new AbortController().signal, reconciliationOnly = false) => {
    const mode = digitalWorkerMode(environment());
    const result = { status: "DISABLED" as "DISABLED" | "BUSY" | "STOPPED" | "COMPLETED", mode,
      paymentsChecked: 0, refundsChecked: 0, stagesCompleted: 0, failures: 0 };
    if (!mode) return result;
    if (running) return { ...result, status: "BUSY" as const };
    running = true;
    const active = () => !signal.aborted && digitalWorkerMode(environment()) === mode;
    const stage = async (operation: () => Promise<unknown>) => {
      if (!active()) return;
      try { await operation(); result.stagesCompleted++; } catch { result.failures++; }
    };
    try {
      if (active() && digitalProviderRequestsAllowed(mode, environment())) {
        await stage(() => dependencies.inbox(DIGITAL_WORKER_BATCH.inbox));
        if (active() && now() >= nextReconciliationAt) {
          // Reserve the interval even after an outage: do not turn a retry into
          // an unbounded provider poll or an automatic financial operation.
          nextReconciliationAt = now() + DIGITAL_WORKER_RECONCILE_MS;
          await stage(async () => {
            const rows = await dependencies.pendingOrders(mode, DIGITAL_WORKER_BATCH.payments, orderCursor);
            if (!rows.length) orderCursor = undefined;
            for (const row of rows.slice(0, DIGITAL_WORKER_BATCH.payments)) {
              if (!active()) break;
              orderCursor = row.id;
              if (row.mode !== mode) continue;
              try { await dependencies.recoverOrder(row.id); result.paymentsChecked++; } catch { result.failures++; }
            }
          });
          await stage(async () => {
            const rows = await dependencies.pendingRefunds(mode, DIGITAL_WORKER_BATCH.refunds, refundCursor);
            if (!rows.length) refundCursor = undefined;
            for (const row of rows.slice(0, DIGITAL_WORKER_BATCH.refunds)) {
              if (!active()) break;
              refundCursor = row.id;
              // Never process REQUESTED here: that branch can POST a refund.
              if (row.mode !== mode || !["PENDING", "REQUIRES_REVIEW"].includes(row.status)) continue;
              try { await dependencies.recoverRefund(row.id); result.refundsChecked++; } catch { result.failures++; }
            }
          });
        }
      }
      if (!reconciliationOnly) {
        await stage(() => dependencies.documents(DIGITAL_WORKER_BATCH.documents));
        await stage(() => dependencies.notifications(DIGITAL_WORKER_BATCH.notifications));
        // Isolated media children run serially, never alongside each other.
        await stage(() => dependencies.media("audio", signal));
        await stage(() => dependencies.media("zip", signal));
      }
      result.status = active() ? "COMPLETED" : "STOPPED";
      return result;
    } finally { running = false; }
  };
}
