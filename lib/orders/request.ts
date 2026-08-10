import "server-only";

import { auth } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/auth/origin";
import { isActiveStatus, isUserRole } from "@/lib/auth/roles";
import type { OrderActor } from "@/lib/orders/domain";
import { assertDatabaseConfigured } from "@/lib/prisma";

const maxOrderJsonBytes = 128 * 1024;

export class OrderRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = "OrderRequestError";
  }
}

export async function readOrderJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > maxOrderJsonBytes) {
    throw new OrderRequestError("Le brief transmis est trop volumineux.", 413, "PAYLOAD_TOO_LARGE");
  }
  if (!request.body) throw new OrderRequestError("Le brief transmis est invalide.", 400, "INVALID_JSON");

  const chunks: Uint8Array[] = [];
  const reader = request.body.getReader();
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxOrderJsonBytes) {
      await reader.cancel();
      throw new OrderRequestError("Le brief transmis est trop volumineux.", 413, "PAYLOAD_TOO_LARGE");
    }
    chunks.push(value);
  }

  try {
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new OrderRequestError("Le brief transmis est invalide.", 400, "INVALID_JSON");
  }
}

export async function orderActorFromHeaders(headers: Headers): Promise<OrderActor | null> {
  assertDatabaseConfigured();
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  if (!isActiveStatus(session.user.status) || !isUserRole(session.user.role) || session.user.emailVerified !== true) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    status: "ACTIVE",
    emailVerified: true,
  };
}

export function isAllowedOrderMutation(request: Request) {
  const trustedBaseUrl = process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://localhost:3000";
  return isSameOriginMutation(request, trustedBaseUrl);
}
