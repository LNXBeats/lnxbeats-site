import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parseSupportContact, supportConfirmationPresentation, SUPPORT_CONFIRMATION_LEGAL } from "@/lib/support/contact";
import { supportEmailTemplate } from "@/lib/support/notification-template";
const value = { id: "qa-reference", amountCents: 300, provider: "STRIPE", createdAt: new Date("2026-10-05T12:00:00Z"), supporterEmail: "qa@example.invalid", supporterMessage: "<script>bad</script>\nMerci LNX" };
test("optional email/message: absent, each alone and both; normalization", () => {
  assert.deepEqual(parseSupportContact({}), { supporterEmail: null, supporterMessage: null });
  assert.deepEqual(parseSupportContact({ email: "  QA@Example.invalid " }), { supporterEmail: "qa@example.invalid", supporterMessage: null });
  assert.deepEqual(parseSupportContact({ message: " Merci\r\nLNX " }), { supporterEmail: null, supporterMessage: "Merci\nLNX" });
  assert.deepEqual(parseSupportContact({ email: "qa@example.invalid", message: "Merci" }), { supporterEmail: "qa@example.invalid", supporterMessage: "Merci" });
});
test("invalid email, header injection, long message and controls rejected", () => {
  for (const email of ["bad", "a@b", "a@b.fr\nBcc:c@d.fr", "a".repeat(255)+"@b.fr", {}, "a@b.fr<>" ]) assert.throws(() => parseSupportContact({ email }));
  for (const message of ["a".repeat(501), "bad\0", "bad\u202e", {}]) assert.throws(() => parseSupportContact({ message }));
  assert.equal(parseSupportContact({ message: "<b>plain text</b>" }).supporterMessage, "<b>plain text</b>");
});
test("confirmed cannot expose reconciliation; pending/unknown/review can", () => {
  for (const status of ["SUCCEEDED", "PAID"]) assert.deepEqual(supportConfirmationPresentation(status, true), { confirmed: true, actionable: false });
  for (const status of ["PENDING", "UNKNOWN", "REQUIRES_REVIEW", "CREATED"]) assert.equal(supportConfirmationPresentation(status).actionable, true);
  for (const status of ["REFUNDED", "FAILED"]) assert.equal(supportConfirmationPresentation(status).actionable, false);
});
test("supporter and Admin template uses amount/date only, escapes user HTML and has no fiscal receipt", () => {
  for (const audience of ["SUPPORTER", "ADMIN"]) {
    const template = supportEmailTemplate(value, audience);
    assert.match(template.text, /3,00/); assert.ok(template.text.includes(SUPPORT_CONFIRMATION_LEGAL));
    assert.doesNotMatch(template.html, /<script>/); assert.match(template.html, /&lt;script&gt;/);
    assert.doesNotMatch(template.text, /payment_intent|client_secret|checkout.stripe/);
    assert.equal(template.text.includes("E-mail :"), audience === "ADMIN");
  }
});
test("confirmed UI only promises an email after sender acceptance; no public email/message", async () => {
  const component = await readFile(new URL("../../components/support-confirmation.tsx", import.meta.url), "utf8");
  const service = await readFile(new URL("../../lib/support/service.ts", import.meta.url), "utf8");
  assert.match(component, /confirmationEmailStatus === "SENT"/);
  assert.match(component, /MERCI/); assert.match(component, /Revenir à l’accueil/);
  const statusFunction = service.split("export async function getSupportStatus")[1].split("export function supportEvidenceMatches")[0];
  assert.doesNotMatch(statusFunction, /supporterEmail:|supporterMessage:/);
  assert.match(statusFunction, /emailProvided: !!value.supporterEmail/);
  assert.match(statusFunction, /messageProvided: !!value.supporterMessage/);
});
test("contact never enters Stripe/PayPal parameters; existing provider code remains unchanged", async () => {
  const providers = await readFile(new URL("../../lib/support/providers.ts", import.meta.url), "utf8");
  assert.doesNotMatch(providers, /supporterEmail|supporterMessage/);
});
test("notification worker uses persistent unique keys, fenced lease, retry cutoff and no backfill", async () => {
  const source = await readFile(new URL("../../lib/support/notifications.ts", import.meta.url), "utf8");
  assert.match(source, /skipDuplicates: true/); assert.match(source, /automaticNotificationRetryIsSafe/);
  assert.match(source, /leaseToken: claim.leaseToken/);
  assert.match(source, /notificationSuppression.findUnique/);
  assert.doesNotMatch(source, /supportContribution.findMany/);
  assert.match(source, /configuration.ownerRecipient/);
});
