import "server-only";

import { appendFile, chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { Resend } from "resend";

import { configuredAdminEmail, isPersistentLocalPreview } from "@/lib/auth/environment";
import { configuredEmailProvider, RESEND_PREVIEW_FROM, RESEND_PREVIEW_REPLY_TO } from "@/lib/email/provider-policy";
import { notificationChannelAvailability } from "@/lib/notifications/config";
import { orderNotificationTemplate } from "@/lib/notifications/templates";
import type { OrderNotificationMessage } from "@/lib/notifications/types";

const DEFAULT_CAPTURE_PATH = "/private/tmp/lnx-studio-v072-order-notifications.jsonl";

function validRecipient(value: string | null): value is string {
  if (!value || value.length > 320 || /[\r\n]/.test(value)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function assertIdempotencyKey(value: string) {
  if (!value || value.length > 255 || !/^[A-Za-z0-9_./:-]+$/.test(value)) {
    throw new Error("Notification idempotency is invalid.");
  }
}

function assertResendOrderNotification(message: OrderNotificationMessage) {
  if (process.env.NODE_ENV === "test" || (process.env.LNX_DATABASE_TARGET ?? "").endsWith("-test")) {
    throw new Error("Real notification email is disabled in automated QA.");
  }
  if (!isPersistentLocalPreview()) {
    throw new Error("Real notification email is restricted to the approved local preview.");
  }
  if (!process.env.RESEND_API_KEY?.trim()) throw new Error("Notification email credentials are unavailable.");
  if (process.env.EMAIL_FROM?.trim() !== RESEND_PREVIEW_FROM) throw new Error("Notification sender is not approved.");
  if (process.env.EMAIL_REPLY_TO?.trim().toLowerCase() !== RESEND_PREVIEW_REPLY_TO) {
    throw new Error("Notification reply address is not approved.");
  }
  if (message.kind.includes("RIGHTS")) {
    throw new Error("Real rights notification email is disabled pending legal and human validation.");
  }
  if (message.kind === "OWNER_NEW_ORDER") {
    if (message.recipient?.toLowerCase() !== configuredAdminEmail()) {
      throw new Error("Order owner notification recipient is not approved.");
    }
  } else if (process.env.ORDER_NOTIFICATION_CLIENT_EMAIL_ENABLED !== "true") {
    throw new Error("Customer delivery email is not enabled for the real provider.");
  }
}

function assertCaptureRecipient(message: OrderNotificationMessage) {
  const recipient = message.recipient!.toLowerCase();
  const qa = (process.env.LNX_DATABASE_TARGET ?? "").endsWith("-test") && recipient.endsWith("@example.invalid");
  const previewOwner = isPersistentLocalPreview() && recipient === configuredAdminEmail();
  if (!qa && !previewOwner) throw new Error("Captured notification recipient is not approved.");
}

export async function sendOrderNotificationEmail(message: OrderNotificationMessage) {
  if (notificationChannelAvailability().email !== "ENABLED") {
    throw new Error("Order notification email is disabled.");
  }
  if (message.channel !== "EMAIL" || !validRecipient(message.recipient)) {
    throw new Error("Order notification email recipient is unavailable.");
  }
  assertIdempotencyKey(message.idempotencyKey);
  const template = orderNotificationTemplate(message);
  const provider = configuredEmailProvider(process.env);

  if (provider === "resend") {
    assertResendOrderNotification(message);
    const client = new Resend(process.env.RESEND_API_KEY);
    const result = await client.emails.send({
      from: process.env.EMAIL_FROM!,
      to: message.recipient,
      replyTo: process.env.EMAIL_REPLY_TO!,
      subject: template.subject,
      text: template.text,
      html: template.html,
    }, { idempotencyKey: message.idempotencyKey });
    if (result.error || !result.data?.id) throw new Error("Order notification email was not accepted.");
    return;
  }

  assertCaptureRecipient(message);
  const target = process.env.ORDER_NOTIFICATION_CAPTURE_PATH ?? DEFAULT_CAPTURE_PATH;
  await mkdir(dirname(target), { recursive: true });
  await appendFile(target, `${JSON.stringify({
    kind: message.kind,
    channel: message.channel,
    recipient: message.recipient.toLowerCase(),
    idempotencyKey: message.idempotencyKey,
    subject: template.subject,
    text: template.text,
    html: template.html,
    capturedAt: new Date().toISOString(),
  })}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(target, 0o600);
}
