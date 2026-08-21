import "server-only";

import { Resend } from "resend";

import { parseNotificationConfiguration } from "@/lib/notifications/config";
import { processVerifiedResendWebhookEvent, type VerifiedResendWebhookEvent } from "@/lib/notifications/resend-webhook";

const MAXIMUM_BODY_BYTES = 256 * 1024;

async function readBoundedBody(request: Request) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAXIMUM_BODY_BYTES) throw Object.assign(new Error("Body too large."), { status: 413 });
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

function boundedHeader(request: Request, name: string) {
  const value = request.headers.get(name)?.trim() ?? "";
  if (!value || value.length > 512 || /[\r\n]/.test(value)) throw new Error("Webhook signature is invalid.");
  return value;
}

function normalizeVerifiedPayload(providerEventId: string, value: unknown): VerifiedResendWebhookEvent {
  if (!value || typeof value !== "object") throw new Error("Webhook payload is invalid.");
  const payload = value as Record<string, unknown>;
  const data = payload.data as Record<string, unknown> | undefined;
  const type = typeof payload.type === "string" ? payload.type : "";
  const occurredAt = new Date(String(payload.created_at ?? ""));
  if (!type || Number.isNaN(occurredAt.getTime())) throw new Error("Webhook payload is invalid.");
  const providerMessageId = typeof data?.email_id === "string"
    ? data.email_id
    : typeof data?.source_id === "string" ? data.source_id : null;
  const recipients = Array.isArray(data?.to) ? data.to : [];
  const recipient = typeof data?.email === "string" ? data.email : typeof recipients[0] === "string" ? recipients[0] : null;
  const suppressionOrigin = data?.origin === "bounce" || data?.origin === "complaint" || data?.origin === "manual" ? data.origin : null;
  return { providerEventId, type, occurredAt, providerMessageId, recipient, suppressionOrigin };
}

export type ResendWebhookRouteDependencies = Readonly<{
  verify(input: { payload: string; id: string; timestamp: string; signature: string; secret: string }): unknown;
  process(event: VerifiedResendWebhookEvent): Promise<{ outcome: string; duplicate: boolean }>;
}>;

const dependencies: ResendWebhookRouteDependencies = {
  verify(input) {
    return new Resend().webhooks.verify({
      payload: input.payload,
      headers: { id: input.id, timestamp: input.timestamp, signature: input.signature },
      webhookSecret: input.secret,
    });
  },
  process: processVerifiedResendWebhookEvent,
};

export async function handleResendWebhookPost(request: Request, injected: ResendWebhookRouteDependencies = dependencies) {
  let event: VerifiedResendWebhookEvent;
  try {
    const configuration = parseNotificationConfiguration();
    if (configuration.emailTransport !== "resend" || !configuration.resendWebhookSecret) {
      return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    const rawBody = await readBoundedBody(request);
    const id = boundedHeader(request, "svix-id");
    const timestamp = boundedHeader(request, "svix-timestamp");
    const signature = boundedHeader(request, "svix-signature");
    const verified = injected.verify({ payload: rawBody, id, timestamp, signature, secret: configuration.resendWebhookSecret });
    event = normalizeVerifiedPayload(id, verified);
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error && error.status === 413 ? 413 : 400;
    return Response.json({ ok: false }, { status, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const result = await injected.process(event);
    console.info(JSON.stringify({ event: "notification.webhook.processed", providerEventType: event.type, outcome: result.outcome, duplicate: result.duplicate }));
    return Response.json({ ok: true, outcome: result.outcome, duplicate: result.duplicate }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
