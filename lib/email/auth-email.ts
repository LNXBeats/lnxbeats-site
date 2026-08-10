import "server-only";

import { appendFile, chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { AuthEmailTemplate } from "@/lib/email/templates";

export type AuthEmailKind = "verification" | "password-reset";

const DEFAULT_CAPTURE_PATH = "/private/tmp/lnx-studio-v052-mailbox.jsonl";

function assertLocalCaptureRecipient(address: string) {
  if (!address.toLowerCase().endsWith("@example.invalid")) {
    throw new Error("The development email transport accepts fictitious recipients only.");
  }
}

function assertLocalSiteUrl(link: string) {
  const expected = new URL(process.env.AUTH_URL ?? "http://localhost:3000");
  const destination = new URL(link);
  if (destination.origin !== expected.origin) throw new Error("Authentication email links must remain same-origin.");
}

export async function sendAuthEmail(input: {
  kind: AuthEmailKind;
  to: string;
  link: string;
  template: AuthEmailTemplate;
}) {
  if (process.env.NODE_ENV === "production" || process.env.AUTH_EMAIL_TRANSPORT !== "capture") {
    throw new Error("No production transactional email transport is configured.");
  }

  assertLocalCaptureRecipient(input.to);
  assertLocalSiteUrl(input.link);

  const path = process.env.AUTH_EMAIL_CAPTURE_PATH ?? DEFAULT_CAPTURE_PATH;
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify({
    kind: input.kind,
    to: input.to.toLowerCase(),
    from: process.env.MAIL_FROM ?? "LNX Beats <no-reply@example.invalid>",
    subject: input.template.subject,
    text: input.template.text,
    html: input.template.html,
    capturedAt: new Date().toISOString(),
  })}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
}
