import "server-only";

import { createHmac, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { isSameOriginMutation } from "@/lib/auth/origin";
import { prisma } from "@/lib/prisma";
import { requireSupportEnabled, requireSupportEnvironment, SupportError, supportBaseUrl } from "@/lib/support/config";

export const SUPPORT_COOKIE = "lnx_support_access";
export function supportOwnerToken(request: NextRequest, create = false) {
  const existing = request.cookies.get(SUPPORT_COOKIE)?.value;
  if (existing && /^[0-9a-f]{64}$/.test(existing)) return existing;
  if (create) return randomBytes(32).toString("hex");
  throw new SupportError("NOT_FOUND");
}
export function supportJson(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" } });
}
export function supportHttpError(error: unknown) {
  const code = error instanceof SupportError ? error.code : error instanceof SyntaxError ? "INVALID" : "UNAVAILABLE";
  const status = code === "NOT_FOUND" ? 404 : code === "INVALID" ? 400 : code === "CONFLICT" ? 409 : code === "RATE_LIMITED" ? 429 : 503;
  return supportJson({ error: code === "CONFLICT" ? "Ce soutien nécessite une vérification. Ne recommencez pas le paiement." : "Le soutien n’a pas pu être traité. Vous pouvez réessayer plus tard." }, status);
}
export async function boundedSupportText(request: Request, max = 8192) {
  if (Number(request.headers.get("content-length") ?? 0) > max) throw new SupportError("INVALID");
  const reader = request.body?.getReader();
  if (!reader) throw new SupportError("INVALID");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > max) { await reader.cancel(); throw new SupportError("INVALID"); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}
export async function supportMutation(request: Request, existing = false) {
  if (existing) requireSupportEnvironment(); else requireSupportEnabled();
  if (!isSameOriginMutation(request, supportBaseUrl())) return false;
  // Shared persistent fixed-window counter, atomic under concurrent requests.
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim().slice(0, 128) ?? "unknown";
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new SupportError("DISABLED");
  const key = `support:${createHmac("sha256", secret).update(address).digest("hex")}`;
  const allowed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key})) IS NULL AS locked`;
    const now = BigInt(Date.now());
    const current = await tx.rateLimit.findUnique({ where: { key } });
    if (!current || now - current.lastRequest >= 600000n) {
      await tx.rateLimit.upsert({ where: { key }, create: { key, count: 1, lastRequest: now }, update: { count: 1, lastRequest: now } });
      return true;
    }
    if (current.count >= 30) return false;
    await tx.rateLimit.update({ where: { key }, data: { count: { increment: 1 } } });
    return true;
  });
  if (!allowed) throw new SupportError("RATE_LIMITED");
  return true;
}
