import "server-only";

import { dispatchOrderNotification } from "@/lib/notifications/service";
import {
  assertOwnerEmailSmokeEnvironment,
  databaseOwnerEmailSmokeRepository,
  type OwnerEmailSmokeRepository,
  type OwnerEmailSmokeStatus,
} from "@/lib/notifications/owner-email-smoke";
import { notificationWorkerAuthorized } from "@/lib/notifications/worker-auth";

const MAXIMUM_BODY_BYTES = 64;
const NO_STORE = { "Cache-Control": "no-store" } as const;

export type OwnerEmailSmokeRouteDependencies = Readonly<{
  environment: Record<string, string | undefined>;
  repository: OwnerEmailSmokeRepository;
  dispatchTarget(notificationId: string): Promise<Readonly<{ delivered: boolean; skipped: boolean }>>;
}>;

const dependencies: OwnerEmailSmokeRouteDependencies = {
  environment: process.env,
  repository: databaseOwnerEmailSmokeRepository,
  dispatchTarget: dispatchOrderNotification,
};

async function readBoundedBody(request: Request) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAXIMUM_BODY_BYTES) throw new Error("Body too large.");
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

function statusBody(status: OwnerEmailSmokeStatus) {
  return {
    notificationId: status.notificationId,
    status: status.status,
    attempts: status.attempts,
    provider: status.provider,
    providerMessageIdPresent: status.providerMessageIdPresent,
    sentAtPresent: status.sentAtPresent,
    deliveredAtPresent: status.deliveredAtPresent,
    failedAtPresent: status.failedAtPresent,
    lastErrorCode: status.lastErrorCode,
    eventTypes: status.eventTypes,
    suppressionActive: status.suppressionActive,
  };
}

type AuthenticationResult =
  | Readonly<{ ok: false; response: Response }>
  | Readonly<{ ok: true; recipient: string }>;

function authenticate(request: Request, injected: OwnerEmailSmokeRouteDependencies): AuthenticationResult {
  let configuration;
  try {
    configuration = assertOwnerEmailSmokeEnvironment(injected.environment);
  } catch {
    return { ok: false, response: Response.json({ ok: false }, { status: 404, headers: NO_STORE }) };
  }
  if (!notificationWorkerAuthorized(request.headers.get("authorization"), configuration.workerSecret)) {
    return { ok: false, response: Response.json({ ok: false }, { status: 401, headers: NO_STORE }) };
  }
  return { ok: true, recipient: configuration.ownerRecipient! };
}

async function hasExactEmptyJsonBody(request: Request) {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return false;
  try {
    const parsed = JSON.parse(await readBoundedBody(request));
    return Boolean(parsed) && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length === 0;
  } catch {
    return false;
  }
}

function hasNoQueryParameters(request: Request) {
  return Array.from(new URL(request.url).searchParams.keys()).length === 0;
}

export async function handleOwnerEmailSmokeCreate(
  request: Request,
  injected: OwnerEmailSmokeRouteDependencies = dependencies,
) {
  const authenticated = authenticate(request, injected);
  if (!authenticated.ok) return authenticated.response;
  if (!hasNoQueryParameters(request)) return Response.json({ ok: false }, { status: 400, headers: NO_STORE });
  if (!await hasExactEmptyJsonBody(request)) return Response.json({ ok: false }, { status: 400, headers: NO_STORE });
  try {
    const result = await injected.repository.create(authenticated.recipient);
    return Response.json({ ok: true, ...result }, { status: 200, headers: NO_STORE });
  } catch {
    return Response.json({ ok: false }, { status: 500, headers: NO_STORE });
  }
}

export async function handleOwnerEmailSmokeRead(
  request: Request,
  injected: OwnerEmailSmokeRouteDependencies = dependencies,
) {
  const authenticated = authenticate(request, injected);
  if (!authenticated.ok) return authenticated.response;
  if (!hasNoQueryParameters(request)) return Response.json({ ok: false }, { status: 400, headers: NO_STORE });
  try {
    const status = await injected.repository.read(authenticated.recipient);
    if (!status) return Response.json({ ok: false }, { status: 404, headers: NO_STORE });
    return Response.json({ ok: true, ...statusBody(status) }, { status: 200, headers: NO_STORE });
  } catch {
    return Response.json({ ok: false }, { status: 500, headers: NO_STORE });
  }
}

export async function handleOwnerEmailSmokeDispatch(
  request: Request,
  injected: OwnerEmailSmokeRouteDependencies = dependencies,
) {
  const authenticated = authenticate(request, injected);
  if (!authenticated.ok) return authenticated.response;
  if (!hasNoQueryParameters(request)) return Response.json({ ok: false }, { status: 400, headers: NO_STORE });
  if (!await hasExactEmptyJsonBody(request)) return Response.json({ ok: false }, { status: 400, headers: NO_STORE });
  try {
    const before = await injected.repository.read(authenticated.recipient);
    if (!before) return Response.json({ ok: false }, { status: 404, headers: NO_STORE });
    if (before.status !== "PENDING" || before.attempts !== 0 || before.providerMessageIdPresent) {
      return Response.json({ ok: true, dispatched: false, ...statusBody(before) }, { status: 200, headers: NO_STORE });
    }
    const result = await injected.dispatchTarget(before.notificationId);
    if (!result.delivered && !result.skipped) {
      await injected.repository.finalizeFailedAttempt(before.notificationId, authenticated.recipient);
    }
    const after = await injected.repository.read(authenticated.recipient);
    if (!after || after.notificationId !== before.notificationId) throw new Error("Owner email smoke status is unavailable.");
    return Response.json({ ok: true, dispatched: result.delivered, ...statusBody(after) }, { status: 200, headers: NO_STORE });
  } catch {
    return Response.json({ ok: false }, { status: 500, headers: NO_STORE });
  }
}
