import "server-only";

import { timingSafeEqual } from "node:crypto";

export function notificationWorkerAuthorized(authorization: string | null, expectedSecret: string | null) {
  if (!authorization?.startsWith("Bearer ") || !expectedSecret) return false;
  const candidate = authorization.slice("Bearer ".length);
  const actual = Buffer.from(candidate);
  const expected = Buffer.from(expectedSecret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
