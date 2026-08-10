import { createHash, randomBytes } from "node:crypto";

const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createOpaqueToken() {
  return randomBytes(32).toString("base64url");
}

export function isOpaqueToken(value: string) {
  return OPAQUE_TOKEN_PATTERN.test(value);
}

export function hashOpaqueToken(value: string) {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

export function isExpired(expiresAt: Date, now = new Date()) {
  return expiresAt.getTime() <= now.getTime();
}
