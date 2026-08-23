import "server-only";

import { sendAuthEmail } from "@/lib/email/auth-email";
import { verificationEmailTemplate } from "@/lib/email/templates";
import { authEmailIdempotencyKey } from "@/lib/email/provider-policy";

export async function issueEmailVerification(input: { email: string; token: string }) {
  const baseUrl = new URL(process.env.AUTH_URL ?? "http://localhost:3000");
  const link = new URL("/verifier-email", baseUrl);
  link.hash = `token=${encodeURIComponent(input.token)}`;

  await sendAuthEmail({
    idempotencyKey: authEmailIdempotencyKey("verification", input.token),
    kind: "verification",
    to: input.email,
    link: link.toString(),
    template: verificationEmailTemplate(link.toString()),
  });
}
