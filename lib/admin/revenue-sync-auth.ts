import { createHash, timingSafeEqual } from "node:crypto";

export const GESTION_REVENUE_SYNC_CONFIRMATION = "I_UNDERSTAND_GESTION_CAN_READ_LIVE_RECEIPTS_AND_DOCUMENTS";

type Environment = Record<string, string | undefined>;
const digest = (value: string) => createHash("sha256").update(value).digest();

/** Dedicated read-only integration credential. It is not an Admin/browser session. */
export function isGestionRevenueSyncAuthorized(request: Request, environment: Environment = process.env) {
  if (environment.GESTION_REVENUE_SYNC_ENABLED !== "true"
    || environment.GESTION_REVENUE_SYNC_CONFIRM !== GESTION_REVENUE_SYNC_CONFIRMATION) return false;
  const expected = environment.GESTION_REVENUE_SYNC_TOKEN;
  if (!expected || expected.length < 64 || expected.length > 256 || /\s|[\u0000-\u001f\u007f]/.test(expected)) return false;
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  const candidate = authorization.slice(7);
  return candidate.length >= 64 && candidate.length <= 256 && timingSafeEqual(digest(candidate), digest(expected));
}
