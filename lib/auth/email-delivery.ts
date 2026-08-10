import "server-only";

import { sendAuthEmail } from "@/lib/email/auth-email";
import { resetPasswordEmailTemplate } from "@/lib/email/templates";

export async function sendPasswordResetEmail(input: { email: string; url: string }) {
  const betterAuthUrl = new URL(input.url);
  const token = betterAuthUrl.pathname.split("/").filter(Boolean).at(-1);
  if (!token || token.length < 20 || token.length > 512 || /\s/.test(token)) {
    throw new Error("Password reset email cannot be prepared.");
  }

  const link = new URL("/reinitialiser-mot-de-passe", process.env.AUTH_URL ?? "http://localhost:3000");
  link.hash = `token=${encodeURIComponent(token)}`;

  await sendAuthEmail({
    kind: "password-reset",
    to: input.email,
    link: link.toString(),
    template: resetPasswordEmailTemplate(link.toString()),
  });
}
