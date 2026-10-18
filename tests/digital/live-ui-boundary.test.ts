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
test("DCN checkout has two unselected confirmations, distinct terms and delivery/withdrawal facts, and an accessible terms link", async () => {
  const checkout=await source("components/digital-checkout.tsx");
  for (const state of ["termsAccepted", "deliveryConsent"]) {
    assert.match(checkout,new RegExp(`\\[${state},set[A-Za-z]+\\]=useState\\(false\\)`));
    assert.match(checkout,new RegExp(`checked=\\{${state}\\}`));
  }
  const confirmations=checkout.slice(checkout.indexOf('aria-labelledby="digital-consent-heading"'),checkout.indexOf('aria-labelledby="digital-payment-heading"'));
  assert.equal((confirmations.match(/type="checkbox"/g)??[]).length,2,"Exactly two legal confirmation controls, not one combined contract checkbox");
  assert.doesNotMatch(confirmations,/defaultChecked|checked=\{true\}/);
  assert.match(checkout,/<Link[^>]*href="\/musique\/conditions#dcn-france-terms"[^>]*target="_blank"[^>]*rel="noopener"/);
  assert.ok(checkout.includes("— nouvel onglet"));
  assert.ok(confirmations.includes("J’accepte les CGV numériques."));
  assert.ok(confirmations.includes("{DIGITAL_CHECKOUT_IMMEDIATE_CONSENT_TEXT}"));
  assert.ok(checkout.includes("earlyDelivery:deliveryConsent,withdrawalAcknowledged:deliveryConsent"));
  assert.ok(checkout.includes("consentPresentation:DIGITAL_CHECKOUT_CONSENT_PRESENTATION"));
  assert.match(checkout,/const paymentReady=[^;]*contractReady&&salesReady&&residenceReady&&residenceConfirmed&&billingReady&&termsAccepted&&deliveryConsent/);
  assert.match(checkout,/if\(!paymentReady\|\|!saved\)throw Error/);
  assert.ok(checkout.includes("localReviewAllowed=!copy.live&&localReview"));
  assert.ok(checkout.includes("contractReady=!copy.live||contractApproved"));
  assert.ok(checkout.includes("salesReady=!copy.live||newSalesOpen"));
  assert.ok(checkout.includes("disabled={!paymentReady||busy}"));
  const consents=await source("lib/digital/checkout-consents.ts");
  assert.ok(consents.includes("avant la fin des 14 jours"));assert.ok(consents.includes("je reconnais perdre mon droit de rétractation lorsque les conditions légales sont réunies"));
  assert.ok(consents.includes('DIGITAL_CHECKOUT_CONSENT_PRESENTATION = "DCN_TWO_CHECKBOXES_20261016_1"'));
  const commerce=await source("lib/digital/commerce.ts"),free=await source("lib/digital/free-completion.ts");
  for(const pathSource of[commerce,free]){assert.match(pathSource,/input\.earlyDelivery\s*!==\s*true/);assert.match(pathSource,/input\.withdrawalAcknowledged\s*!==\s*true/);}
  const snapshot=await source("lib/digital/fulfillment-policy.ts");
  assert.ok(snapshot.includes("...(presentation?{checkoutConsentPresentation:presentation}:{})"));
  assert.ok(snapshot.includes('earlyDelivery:{expresslyRequested:true,text:document.consents.immediateSupply}'));
  assert.ok(snapshot.includes('withdrawal:{expresslyAcknowledged:true,text:document.consents.withdrawalAcknowledgement}'));
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
test("digital payment uses Commander's visual cards but retains its own endpoints and the official PayPal SDK",async()=>{
  const checkout=await source("components/digital-checkout.tsx");
  for(const name of ["payment-methods__actions","payment-methods__choice--stripe","payment-methods__choice--paypal","payment-methods__choice-heading","payment-methods__choice-icon","payment-methods__paypal-logo","form-button form-button--primary"]){assert.ok(checkout.includes(name));}
  assert.ok(checkout.includes('src="/brands/paypal-white.svg"'));
  assert.ok(checkout.includes('checkoutPaymentCtaLabel("stripe",totalCents)'));
  assert.ok(checkout.includes('DigitalPaypalButtons ready={paymentReady}'));
  assert.ok(checkout.includes('aria-busy={busy}'));
  assert.doesNotMatch(checkout,/StripeCheckoutAction|PaypalCheckoutAction|type="radio"|\/api\/orders\//);
  assert.ok(checkout.includes('"/api/digital/checkout"'));
});
test("billing defaults to the full declared address, while residence and legal choices remain explicit",async()=>{
  const checkout=await source("components/digital-checkout.tsx");
  assert.ok(checkout.includes("[billingAddressSameAsResidence,setBillingAddressSameAsResidence]=useState(true)"));
  assert.ok(checkout.includes("checked={billingAddressSameAsResidence}"));
  assert.ok(checkout.includes("Mon adresse de facturation est identique."));
  assert.ok(checkout.includes("Une adresse de facturation différente nécessite une vérification avant paiement."));
  assert.ok(checkout.includes('billingReady=!copy.live||billingAddressSameAsResidence'));
  assert.ok(checkout.includes("...(copy.live?{billingAddressSameAsResidence,"));
  assert.ok(checkout.includes('billingAddress:{countryCode:"FR",line1:billingLine1,city:billingCity,postalCode:billingPostalCode}'));
  assert.ok(checkout.includes("effectiveBillingPostalCode=billingAddressSameAsResidence?residencePostalCode:billingPostalCode"));
  assert.match(checkout,/const dirty=[^;]*saved\.address\.line1!==line1[^;]*saved\.address\.city!==city[^;]*saved\.address\.postalCode!==residencePostalCode[^;]*saved\.billingPostalCode!==effectiveBillingPostalCode/);
  assert.ok(checkout.includes('residenceReady=!!saved&&!dirty&&(residence?.checkoutEligible===true||residence?.reviewStatus==="VERIFIED")'));
  assert.doesNotMatch(checkout,/function changed\(\)\{[^}]*setBillingAddressSameAsResidence\(false\)/);
  assert.match(checkout,/function changed\(\)\{[^}]*setResidenceConfirmed\(false\)/);
  assert.match(checkout,/function hydrate\([^)]*preserveConfirmation=false\)\{if\(!preserveConfirmation\)setResidenceConfirmed\(false\)/);
  assert.ok(checkout.includes("hydrate(value,true)"),"Saving does not discard the buyer's explicit confirmation");
  assert.ok(checkout.includes("if(!preserveConfirmation){const same=value.declaration.address.postalCode===value.declaration.billingPostalCode"));
  const policy=await source("lib/digital/billing-address-policy.ts");
  assert.ok(policy.includes('throw new DigitalError("FRANCE_BILLING_ADDRESS_DIFFERENT_REQUIRES_REVIEW", 409)'));
  assert.ok(policy.includes("billingSnapshotHash(address) !== billingSnapshotHash(residenceAddress)"));
});
test("checkout cannot change address, either legal confirmation or payment method while a provider operation is busy",async()=>{
  const checkout=await source("components/digital-checkout.tsx");
  assert.match(checkout,/checked=\{termsAccepted\} disabled=\{busy\|\|!contractReady\}/);
  assert.match(checkout,/checked=\{deliveryConsent\} disabled=\{busy\}/);
  assert.match(checkout,/checked=\{billingAddressSameAsResidence\} disabled=\{busy\|\|saving\|\|!loaded\}/);
  assert.match(checkout,/checked=\{residenceConfirmed\} disabled=\{busy\|\|saving\|\|!loaded\}/);
  assert.ok(checkout.includes("fieldset disabled={busy||saving||!loaded}"));
  assert.ok(checkout.includes("fieldset disabled={busy||saving}"));
  assert.ok(checkout.includes("fieldset className={styles.methods} disabled={busy}"));
  assert.match(checkout,/async function saveResidence\(\)\{if\(saving\|\|busy\)return/);
  assert.match(checkout,/async function refreshResidence\(\)\{if\(saving\|\|busy\)return/);
  assert.match(checkout,/async function payByCardOrLocal\(\)\{if\(!operation\.current\.claim\("STRIPE"\)\)return;setBusy\(true\)/);
  assert.match(checkout,/async function createPaypalOrder\(\)\{if\(!operation\.current\.claim\("PAYPAL"\)\)throw Error/);
  assert.ok(checkout.includes('function endPaypalOperation(){if(operation.current.isOwnedBy("STRIPE"))return false;'));
  assert.equal((checkout.match(/if\(!endPaypalOperation\(\)\)return;/g)??[]).length,2);
});
test("DCN document and library labels come from the immutable acquired order mode", async () => {
  const library=await source("components/digital-library.tsx"), confirmation=await source("app/musique/confirmation/[id]/page.tsx"),panel=await source("components/digital-confirmation-panel.tsx");
  assert.ok(library.includes("digitalUiCopy(o.mode).purchase"));
  assert.ok(library.includes('mode={digitalUiIsLive(o.mode)?"LIVE":"TEST"}'));
  assert.ok(confirmation.includes('mode=digitalUiIsLive(order.mode)?"LIVE":"TEST"'));
  assert.ok(confirmation.includes("<DigitalConfirmationPanel"));
  assert.ok(panel.includes("<DigitalDocuments mode={mode}"));
  assert.ok(!library.includes("process.env.DCN_MODE"));
});
test("known PayPal cancellations/errors cannot reopen a remembered Order with editable checkout data",async()=>{
  const checkout=await source("components/digital-checkout.tsx");
  assert.ok(checkout.includes("[attemptNeedsReview,setAttemptNeedsReview]=useState(false)"));
  assert.match(checkout,/const paymentReady=[^;]*!attemptNeedsReview/);
  assert.ok(checkout.includes('startedOrder.current=value.orderId;setPendingOrderId(value.orderId)'));
  assert.ok(checkout.includes('if(order){setPendingOrderId(order.orderId);setAttemptNeedsReview(true);}'));
  assert.ok(checkout.includes('if(startedOrder.current)setAttemptNeedsReview(true)'));
  assert.ok(checkout.includes('DigitalPaypalButtons ready={paymentReady}'));
  assert.doesNotMatch(checkout,/const paymentReady=[^;]*!busy/);
  assert.ok(checkout.includes('Consulter le suivi de ma commande'));
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
