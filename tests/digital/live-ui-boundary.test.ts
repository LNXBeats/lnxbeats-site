import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { digitalUiCopy, digitalUiIsLive } from "@/components/digital-mode-copy";

const source = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
test("DCN presentation labels remain TEST unless the server supplies exact LIVE mode", () => {
  for (const mode of [undefined, null, "TEST", "live", "SANDBOX", true, {}, ""]) {
    assert.equal(digitalUiIsLive(mode), false);
    assert.equal(digitalUiCopy(mode).paymentHeading, "Paiement QA sécurisé");
    assert.equal(digitalUiCopy(mode).stripe, "Stripe TEST");
    assert.equal(digitalUiCopy(mode).paypal, "PayPal SANDBOX");
    assert.equal(digitalUiCopy(mode).invoice, "Facture QA");
    assert.equal(digitalUiCopy(mode).creditNote, "Avoir QA");
  }
  const live=digitalUiCopy("LIVE");
  assert.equal(live.pay, "Commander et payer");
  assert.equal(live.stripe, "Stripe");
  assert.equal(live.paypal, "PayPal");
  assert.equal(live.invoice, "Facture");
  assert.equal(live.creditNote, "Avoir");
  assert.equal(live.purchase, "Achat numérique");
});
test("DCN checkout keeps three separate unselected consents and a clear accessible terms link", async () => {
  const checkout=await source("components/digital-checkout.tsx");
  for (const state of ["termsAccepted", "early", "withdraw"]) {
    assert.match(checkout,new RegExp(`\\[${state},set[A-Za-z]+\\]=useState\\(false\\)`));
    assert.match(checkout,new RegExp(`checked=\\{${state}\\}`));
  }
  assert.match(checkout,/href="\/musique\/conditions#dcn-france-terms" target="_blank" rel="noopener" className=\{styles\.button\}/);
  assert.ok(checkout.includes("— nouvel onglet"));
  assert.ok(checkout.includes("!termsAccepted||!early||!withdraw"));
  assert.ok(checkout.includes("localReviewAllowed=!copy.live&&localReview"));
  assert.ok(checkout.includes("contractReady=!copy.live||contractApproved"));
  assert.ok(checkout.includes("salesReady=!copy.live||newSalesOpen"));
  assert.ok(checkout.includes("disabled={!contractReady||"));
});
test("DCN checkout and terms read actual seller approval, not the draft constant or client choice", async () => {
  for (const path of ["app/musique/checkout/page.tsx","app/musique/conditions/page.tsx"]) {
    const page=await source(path);
    assert.ok(page.includes("await approvedDigitalFranceContract(prisma)"));
  }
  const checkout=await source("app/musique/checkout/page.tsx");
  assert.ok(checkout.includes("termsVersion={live?DIGITAL_FRANCE_LIVE_CONTRACT_VERSION:DIGITAL_FRANCE_TERMS_VERSION}"));
  assert.ok(checkout.includes("contractApproved={contractApproved}"));
  assert.ok(checkout.includes("providers={error?[]:digitalAvailableProviders()}"));
});
test("LIVE billing address requires its own unselected full-address confirmation, reset on residence changes",async()=>{
  const checkout=await source("components/digital-checkout.tsx");
  assert.ok(checkout.includes("[billingAddressSameAsResidence,setBillingAddressSameAsResidence]=useState(false)"));
  assert.ok(checkout.includes("{copy.live?<div><label"));
  assert.ok(checkout.includes("checked={billingAddressSameAsResidence}"));
  assert.ok(checkout.includes("Mon adresse de facturation est identique à l’adresse de résidence déclarée et vérifiée."));
  assert.ok(checkout.includes("pas seulement le code postal"));
  assert.ok(checkout.includes("contactez LNX Beats pour une revue"));
  assert.ok(checkout.includes("...(copy.live?{billingAddressSameAsResidence}:{})"));
  assert.ok(checkout.includes("||(copy.live&&!billingAddressSameAsResidence)"));
  assert.match(checkout,/function changed\(\)\{[^}]*setBillingAddressSameAsResidence\(false\)/);
  assert.match(checkout,/function hydrate\([^)]*\)\{[^}]*setBillingAddressSameAsResidence\(false\)/);
});
test("DCN document and library labels come from the immutable acquired order mode", async () => {
  const library=await source("components/digital-library.tsx"), confirmation=await source("app/musique/confirmation/[id]/page.tsx");
  assert.ok(library.includes("digitalUiCopy(o.mode).purchase"));
  assert.ok(library.includes('mode={digitalUiIsLive(o.mode)?"LIVE":"TEST"}'));
  assert.ok(confirmation.includes('mode=digitalUiIsLive(order.mode)?"LIVE":"TEST"'));
  assert.ok(confirmation.includes("<DigitalDocuments mode={mode}"));
  assert.ok(!library.includes("process.env.DCN_MODE"));
});
test("DCN Admin read-recovery and financial execution keep separate capabilities without a QA-only LIVE gate", async () => {
  const refund=await source("components/digital-refund.tsx"), page=await source("app/admin/musique/achats/[id]/page.tsx");
  assert.ok(refund.includes('disabled={!reconciliationAuthorized||busy}'));
  assert.ok(refund.includes('disabled={!authorized||confirmed!==r.id||busy}'));
  assert.ok(page.includes("digitalFinanceGateway(provider,mode);reconciliationAuthorized=true"));
  assert.ok(page.includes("assertDigitalRefundOperation(mode,configuration);authorized=true"));
  assert.ok(!page.includes('authorized={process.env.DCN_EXTERNAL_TEST_AUTHORIZED'));
  assert.ok(page.includes("await requireAdmin()"));
});
