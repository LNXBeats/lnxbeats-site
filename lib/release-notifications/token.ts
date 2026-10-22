import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function signature(userId: string, secret: string) {
  if (secret.length < 32) throw new Error("RELEASE_ALERT_TOKEN_UNAVAILABLE");
  return createHmac("sha256", secret).update(`release-alerts-unsubscribe-v1\0${userId}`).digest("base64url");
}
/** Scope permits only withdrawal of marketing consent; never login or account edits. */
export function releaseAlertUnsubscribeToken(userId: string, secret = process.env.AUTH_SECRET ?? "") {
  if (!UUID.test(userId)) throw new Error("INVALID_USER");
  return `${userId}.${signature(userId, secret)}`;
}
export function releaseAlertUnsubscribeUser(token: unknown, secret = process.env.AUTH_SECRET ?? "") {
  if (typeof token !== "string" || token.length > 100) return null;
  const [id, proof, extra] = token.split(".");
  if (!UUID.test(id ?? "") || !proof || extra !== undefined || !/^[A-Za-z0-9_-]{43}$/.test(proof)) return null;
  try {
    const expected = Buffer.from(signature(id, secret));
    const actual = Buffer.from(proof);
    return actual.length === expected.length && timingSafeEqual(actual, expected) ? id : null;
  } catch { return null; }
}
