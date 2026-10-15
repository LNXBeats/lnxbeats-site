import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { digitalContractSnapshot, verifyContractSnapshot, digitalEmailTemplate } from "@/lib/digital/fulfillment-policy";
import { DIGITAL_TERMS_TEXT, DIGITAL_TERMS_VERSION } from "@/lib/digital/domain";
import { DIGITAL_MUSIC_TERMS_DRAFT_TEXT } from "@/lib/digital/digital-legal";
import { refundTargets, stripeRefundStatus, stripeDisputeStatus, paypalDisputeStatus } from "@/lib/digital/finance-policy";
import { digitalByteRange, digitalAttachment } from "@/lib/digital/download-policy";
import { validateDigitalZip } from "@/lib/digital/zip";
import { verifiedDigitalStream } from "@/lib/digital/stream-integrity";
import { digitalLibraryPaymentLabel, digitalLibraryBlockedMessage,digitalConfirmationMessage } from "@/lib/digital/library-policy";
const hash = createHash("sha256").update(DIGITAL_MUSIC_TERMS_DRAFT_TEXT).digest("hex");
test("Historical DCN contract remains verifiable without replacing its text",()=>{
  const s={...digitalContractSnapshot({name:"QA",email:"qa@example.invalid"},new Date()),policy:"DCN-1.1-QA-EXPLICIT-RECEIPT",terms:{version:"DCN-1.0-LOCAL-REVIEW",text:DIGITAL_TERMS_TEXT}};
  assert.equal(verifyContractSnapshot(s,"DCN-1.0-LOCAL-REVIEW",createHash("sha256").update(DIGITAL_TERMS_TEXT).digest("hex")).snapshot.terms.text,DIGITAL_TERMS_TEXT);
});
test("DCN confirmation snapshots distinct express requests, terms and timestamp, without legal approval", () => {
  const s = digitalContractSnapshot({ name: "QA", email: "qa@example.invalid" }, new Date("2026-10-13T12:00:00Z"));
  assert.equal(s.licenseStatus, "PROPOSED_NOT_LIVE_APPROVED"); assert.equal(s.fiscalStatus, "LOCAL_REVIEW_ONLY");
  assert.equal(verifyContractSnapshot(s, DIGITAL_TERMS_VERSION, hash).snapshot.acceptedAt, "2026-10-13T12:00:00.000Z");
});
test("DCN rejects absent, rewritten, LIVE or incompletely acknowledged contract snapshot", () => {
  const s = digitalContractSnapshot({ name: "QA", email: "qa@example.invalid" }, new Date());
  for (const invalid of [null, {}, { ...s, mode: "LIVE" }, { ...s, earlyDelivery: { expresslyRequested: false } }, { ...s, terms: { ...s.terms, text: "Rewritten conditions" } }]) assert.throws(() => verifyContractSnapshot(invalid, DIGITAL_TERMS_VERSION, hash));
});
for (const kind of ["CONTRACT_AVAILABLE", "ACCESS_READY", "REFUND_CONFIRMED", "INCIDENT"]) test(`DCN ${kind} HTML/text email escaped and account-only; captured != delivered`, () => {
  const t = digitalEmailTemplate({ kind, orderId: randomUUID(), totalCents: 123, titles: ['<script>alert("QA")</script>'], base: "http://127.0.0.1:3140" });
  assert.ok(t.subject.startsWith("TEST")); assert.ok(t.text.includes("1,23 EUR")); assert.ok(!t.html.includes("<script>")); assert.ok(t.html.includes("&lt;script&gt;")); assert.ok(!t.text.includes("digital/masters/")); assert.ok(t.html.includes("/musique/confirmation/"));
});
test("DCN email base refuses credentials, path, query, fragment", () => {
  for (const base of ["https://a:b@example.invalid", "https://example.invalid/private", "https://example.invalid/?token=QA", "https://example.invalid/#x"]) assert.throws(() => digitalEmailTemplate({ kind: "ACCESS_READY", orderId: randomUUID(), totalCents: 1, titles: [], base }));
});
test("free completion notification never presents a grant as paid or an e-mail as durable delivery", () => {
  const mail = digitalEmailTemplate({ kind: "FREE_COMPLETION_AVAILABLE", orderId: randomUUID(), totalCents: 0, titles: ["QA album"], base: "http://127.0.0.1:3140" });
  assert.match(mail.subject, /sans paiement/); assert.match(mail.text, /sans nouveau paiement/);
  assert.match(mail.text, /Aucun prestataire de paiement n’a été appelé/); assert.match(mail.text, /aucune facture d’encaissement fictif/);
  assert.match(mail.text, /avant le commencement de la fourniture QA/); assert.match(mail.text, /seul ne prouve pas la remise/);
  assert.doesNotMatch(mail.text, /Votre paiement est confirmé/);
});
test("DCN refund targets are cents, unique line IDs and closed input shape", () => {
  const id = randomUUID(); assert.deepEqual(refundTargets([{ lineId: id, amountCents: 101 }]), [{ lineId: id, amountCents: 101 }]);
  for (const v of [[], [{ lineId: id, amountCents: 1.1 }], [{ lineId: id, amountCents: -1 }], [{ lineId: id, amountCents: 1, privilege: true }], [{ lineId: "../bad", amountCents: 1 }], [{ lineId: id, amountCents: 1 }, { lineId: id, amountCents: 1 }]]) assert.throws(() => refundTargets(v));
});
test("DCN Stripe refund accepted/pending is not succeeded; failure/cancellation remain negative", () => {
  assert.equal(stripeRefundStatus("pending"), "PENDING"); assert.equal(stripeRefundStatus("requires_action"), "PENDING"); assert.equal(stripeRefundStatus("succeeded"), "SUCCEEDED"); assert.equal(stripeRefundStatus("failed"), "FAILED"); assert.equal(stripeRefundStatus("canceled"), "FAILED");
});
test("DCN dispute outcome must be conclusive; a warning closure is not automatically won", () => {
  assert.equal(stripeDisputeStatus("under_review"), "OPEN"); assert.equal(stripeDisputeStatus("won"), "WON"); assert.equal(stripeDisputeStatus("lost"), "LOST"); assert.equal(stripeDisputeStatus("warning_closed"), "REQUIRES_REVIEW");
  assert.equal(paypalDisputeStatus("RESOLVED", "RESOLVED_SELLER_FAVOUR"), "WON"); assert.equal(paypalDisputeStatus("RESOLVED", "RESOLVED_BUYER_FAVOUR"), "LOST"); assert.equal(paypalDisputeStatus("RESOLVED", "UNKNOWN"), "REQUIRES_REVIEW");
});
test("DCN Range strict, suffix bounded, zero suffix and multi-range rejected", () => {
  assert.deepEqual(digitalByteRange("bytes=0-99", 1000), { start: 0, end: 99 }); assert.deepEqual(digitalByteRange("bytes=-10", 1000), { start: 990, end: 999 }); assert.deepEqual(digitalByteRange("bytes=900-", 1000), { start: 900, end: 999 });
  for (const s of ["bytes=-0", "bytes=1000-", "bytes=2-1", "bytes=0-1,4-5", "bytes=NaN-1"]) assert.throws(() => digitalByteRange(s, 1000), { status: 416 });
});
test("DCN download filename cannot inject headers/traversal and preserves UTF8 title", () => {
  const h = digitalAttachment('../Été\r\nX-Secret: value.wav'); assert.ok(!h.includes("\r")); assert.ok(!h.includes("\n")); assert.ok(h.includes("filename*=UTF-8''")); assert.ok(h.includes("%C3%89t%C3%A9"));
});
test("DCN ZIP refuses casefold/Unicode-normalized collisions and bounds before opening files", () => {
  const entry = (name: string) => ({ name, size: 1, async open(): Promise<ReadableStream<Uint8Array>> { throw Error("Must not open"); } });
  for (const names of [["A.wav", "a.wav"], ["É.wav", "E\u0301.wav"]]) assert.throws(() => validateDigitalZip(names.map(entry)), /Duplicate ZIP name/);
  validateDigitalZip([entry("CON.wav"), entry("../safe.wav")]);
});
test("DCN ZIP source verifier rejects truncated, enlarged and corrupt bytes before READY", async () => {
  const bytes = Buffer.from("synthetic audio QA"), hash = createHash("sha256").update(bytes).digest("hex");
  const stream = (b: Uint8Array) => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(b); c.close(); } });
  assert.deepEqual(Buffer.from(await new Response(verifiedDigitalStream(stream(bytes), bytes.length, hash)).arrayBuffer()), bytes);
  for (const b of [bytes.subarray(1), Buffer.concat([bytes, bytes]), Buffer.alloc(bytes.length)]) {
    await assert.rejects(new Response(verifiedDigitalStream(stream(b), bytes.length, hash)).arrayBuffer(), { code: "ARCHIVE_INTEGRITY" });
  }
});
test("DCN library never claims an unpaid order paid, or retained price-reduction rights revoked",()=>{
  for(const state of ["PENDING","REQUIRES_REVIEW","FAILED"]){assert.ok(!digitalLibraryPaymentLabel(state,false).includes("confirmé"));assert.ok(!digitalLibraryBlockedMessage(state,false).includes("Paiement confirmé"));}
  assert.ok(digitalLibraryPaymentLabel("REFUNDED",true).includes("droits conservés"));assert.ok(digitalLibraryPaymentLabel("REFUNDED",false).includes("accès retiré"));
  for(const state of ["REFUNDED","PARTIALLY_REFUNDED","DISPUTED"])assert.ok(!digitalConfirmationMessage(state,false).includes("En attente de confirmation prestataire"));
});
