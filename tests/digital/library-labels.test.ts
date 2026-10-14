import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { digitalLibraryPurchaseReference, digitalLibraryPaymentLabel, digitalConfirmationMessage } from "@/lib/digital/library-policy";

test("DCN library distinguishes the two real QA purchases without presenting a short reference as an identity check", () => {
  assert.equal(digitalLibraryPurchaseReference("cf2ce039-e806-48c1-a62f-33e2a51ecb82"), "…A51ECB82");
  assert.equal(digitalLibraryPurchaseReference("c03bd7e9-f9c6-40f2-b8d9-d949034cace1"), "…034CACE1");
});

test("DCN partial-refund wording explains the purchase without promising every title or ZIP remains downloadable", () => {
  const message = "Remboursement partiel confirmé. Le détail de vos téléchargements et vos justificatifs figurent ci-dessous.";
  assert.equal(digitalLibraryPaymentLabel("PARTIALLY_REFUNDED", true), message);
  assert.equal(digitalLibraryPaymentLabel("PARTIALLY_REFUNDED", false), message);
  assert.ok(!message.includes("tous les titres"));
  assert.ok(!message.includes("ZIP"));
});

test("DCN partial-refund confirmation points to documents and per-title access, not another payment", () => {
  const message = digitalConfirmationMessage("PARTIALLY_REFUNDED", false);
  assert.equal(message, "Une partie de votre paiement a été remboursée. Consultez vos justificatifs ici et l’état de vos téléchargements dans Ma musique.");
  assert.equal(digitalConfirmationMessage("PARTIALLY_REFUNDED", true), message);
});

test("DCN abbreviated reference changes no order identity, navigation, download gate or purchased history", async () => {
  const source = await readFile(new URL("../../components/digital-library.tsx", import.meta.url), "utf8");
  assert.ok(source.includes("orders.map(o=>"));
  assert.ok(source.includes("key={o.id}"));
  assert.ok(source.includes("Réf. abrégée {digitalLibraryPurchaseReference(o.id)}"));
  assert.ok(source.includes("href={`/musique/confirmation/${o.id}`}"));
  assert.ok(source.includes('canDownload=o.accessReady&&["PAID","PARTIALLY_REFUNDED","REFUNDED"].includes(o.status)&&active.length>0'));
  assert.ok(source.includes("active.length===l.acquiredTrackCount"));
});
