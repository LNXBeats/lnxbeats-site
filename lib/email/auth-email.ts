import "server-only";

import { createHash } from "node:crypto";
import { appendFile, chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AuthEmailTemplate } from "@/lib/email/templates";
import { configuredAdminEmail, isLoopbackUrl, isPersistentLocalPreview } from "@/lib/auth/environment";
import { assertResendAuthDelivery, configuredEmailProvider } from "@/lib/email/provider-policy";
import { sendResendEmail } from "@/lib/email/resend-adapter";
import { normalizeNotificationRecipient } from "@/lib/notifications/domain";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

export type AuthEmailKind = "registration-code" | "verification" | "password-reset";
type AuthEmailDatabase = Pick<typeof prisma, "notificationSuppression" | "notificationEvent">;
type AuthEmailDependencies = Readonly<{
  database: AuthEmailDatabase;
  sendResend: typeof sendResendEmail;
}>;

const DEFAULT_CAPTURE_PATH = "/private/tmp/lnx-studio-v052-mailbox.jsonl";

function assertLocalCaptureRecipient(address: string) {
  const normalized = address.trim().toLowerCase();
  const isQaRecipient = normalized.endsWith("@example.invalid");
  const isApprovedPreviewRecipient = !isQaRecipient
    && isPersistentLocalPreview()
    && normalized === configuredAdminEmail();
  const isApprovedAdminQaRecipient = process.env.NODE_ENV === "test"
    && (process.env.LNX_DATABASE_TARGET ?? "").endsWith("-test")
    && isLoopbackUrl(process.env.AUTH_URL)
    && normalized === configuredAdminEmail();
  if (!isQaRecipient && !isApprovedPreviewRecipient && !isApprovedAdminQaRecipient) {
    throw new Error("The development email transport accepts fictitious recipients only.");
  }
}

function assertLocalSiteUrl(link: string) {
  const expected = new URL(process.env.AUTH_URL ?? "http://localhost:3000");
  const destination = new URL(link);
  if (destination.origin !== expected.origin) throw new Error("Authentication email links must remain same-origin.");
}

function authAuditEventId(idempotencyKey: string) {
  return `auth-request:${createHash("sha256").update(idempotencyKey).digest("hex")}`;
}

function authAuditCode(kind: AuthEmailKind, state: "REQUESTED" | "SENDING" | "ACCEPTED" | "FAILED") {
  return `AUTH_${kind.replaceAll("-", "_").toUpperCase()}_${state}`.slice(0, 80);
}

export async function sendAuthEmail(input: {
  idempotencyKey?: string;
  kind: AuthEmailKind;
  to: string;
  link?: string;
  template: AuthEmailTemplate;
}, dependencies: AuthEmailDependencies = { database: prisma, sendResend: sendResendEmail }) {
  const provider = configuredEmailProvider(process.env);

  if (provider === "disabled") throw new Error("Transactional email delivery is disabled.");
  if (provider === "resend") {
    assertResendAuthDelivery({
      apiKey: process.env.RESEND_API_KEY,
      environment: process.env,
      from: process.env.EMAIL_FROM,
      idempotencyKey: input.idempotencyKey,
      isPersistentLocalPreview: isPersistentLocalPreview(),
      kind: input.kind,
      replyTo: process.env.EMAIL_REPLY_TO,
      to: input.to,
    });
    if (input.link) assertLocalSiteUrl(input.link);
    const idempotencyKey = input.idempotencyKey!;
    const recipient = normalizeNotificationRecipient(input.to);
    assertDatabaseConfigured();
    const suppression = await dependencies.database.notificationSuppression.findUnique({
      where: { channel_recipient: { channel: "EMAIL", recipient } },
      select: { active: true },
    });
    if (suppression?.active) throw new Error("Transactional email recipient is suppressed.");

    const providerEventId = authAuditEventId(idempotencyKey);
    const audit = await dependencies.database.notificationEvent.upsert({
      where: { providerEventId },
      update: {},
      create: {
        providerEventId,
        providerEventType: "auth.email.requested",
        outcome: "PROCESSED",
        code: authAuditCode(input.kind, "REQUESTED"),
        occurredAt: new Date(),
      },
      select: { providerMessageId: true, code: true },
    });
    if (audit.providerMessageId && audit.code === authAuditCode(input.kind, "ACCEPTED")) return;
    const now = new Date();
    const staleSendingBefore = new Date(now.getTime() - 30_000);
    const claimed = await dependencies.database.notificationEvent.updateMany({
      where: {
        providerEventId,
        providerMessageId: null,
        OR: [
          { code: { in: [authAuditCode(input.kind, "REQUESTED"), authAuditCode(input.kind, "FAILED")] } },
          { code: authAuditCode(input.kind, "SENDING"), occurredAt: { lte: staleSendingBefore } },
        ],
      },
      data: {
        providerEventType: "auth.email.sending",
        outcome: "PROCESSED",
        code: authAuditCode(input.kind, "SENDING"),
        occurredAt: now,
      },
    });
    if (claimed.count !== 1) return;

    try {
      const providerMessageId = await dependencies.sendResend({
        apiKey: process.env.RESEND_API_KEY!,
        idempotencyKey,
        message: {
          from: process.env.EMAIL_FROM!,
          to: recipient,
          replyTo: process.env.EMAIL_REPLY_TO!,
          subject: input.template.subject,
          text: input.template.text,
          html: input.template.html,
          tags: [
            { name: "lnx_source", value: "auth" },
            { name: "lnx_kind", value: input.kind.replaceAll("-", "_") },
          ],
        },
      });
      await dependencies.database.notificationEvent.update({
        where: { providerEventId },
        data: {
          providerMessageId,
          providerEventType: "auth.email.accepted",
          outcome: "PROCESSED",
          code: authAuditCode(input.kind, "ACCEPTED"),
          occurredAt: new Date(),
        },
      });
    } catch (error) {
      await dependencies.database.notificationEvent.updateMany({
        where: { providerEventId, providerMessageId: null },
        data: { outcome: "REQUIRES_REVIEW", code: authAuditCode(input.kind, "FAILED"), occurredAt: new Date() },
      });
      throw error;
    }
    return;
  }

  assertLocalCaptureRecipient(input.to);
  if (input.link) assertLocalSiteUrl(input.link);

  const path = process.env.AUTH_EMAIL_CAPTURE_PATH ?? DEFAULT_CAPTURE_PATH;
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify({
    kind: input.kind,
    to: input.to.toLowerCase(),
    from: process.env.EMAIL_FROM ?? "LNX Beats <no-reply@example.invalid>",
    subject: input.template.subject,
    text: input.template.text,
    html: input.template.html,
    capturedAt: new Date().toISOString(),
  })}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
}
