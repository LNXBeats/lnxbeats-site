import "server-only";

import { appendFile, chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Resend } from "resend";

import type { AuthEmailTemplate } from "@/lib/email/templates";
import { configuredAdminEmail, isLoopbackUrl, isPersistentLocalPreview } from "@/lib/auth/environment";
import { assertResendPreviewDelivery, configuredEmailProvider } from "@/lib/email/provider-policy";

export type AuthEmailKind = "registration-code" | "verification" | "password-reset";

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

export async function sendAuthEmail(input: {
  idempotencyKey?: string;
  kind: AuthEmailKind;
  to: string;
  link?: string;
  template: AuthEmailTemplate;
}) {
  const provider = configuredEmailProvider(process.env);

  if (provider === "resend") {
    assertResendPreviewDelivery({
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

    const client = new Resend(process.env.RESEND_API_KEY);
    const result = await client.emails.send({
      from: process.env.EMAIL_FROM!,
      to: input.to,
      replyTo: process.env.EMAIL_REPLY_TO!,
      subject: input.template.subject,
      text: input.template.text,
      html: input.template.html,
    }, input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined);
    if (result.error || !result.data?.id) {
      throw new Error("Transactional email delivery was not accepted.");
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
