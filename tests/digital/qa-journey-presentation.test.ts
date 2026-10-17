import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { digitalConfirmationMessage, digitalLibraryBlockedMessage, digitalNotificationMessage } from "@/lib/digital/library-policy";
const source=(file:string)=>readFile(new URL(`../../${file}`,import.meta.url),"utf8");

test("the server-provided total appears once directly before the provider choice, not recomputed by a payment card",async()=>{
  const s=await source("components/digital-checkout.tsx"),index=s.indexOf('aria-label="Total commun aux deux moyens de paiement"');
  assert.ok(index>0&&index<s.indexOf('<fieldset className={styles.methods}'));
  assert.match(s.slice(index,index+250),/digitalMoney\(totalCents\)/);
  assert.doesNotMatch(s,/totalCents\s*[+*/-]=|setTotalCents|parseFloat/);
});
test("short secondary payment copy preserves the real PayPal component and Stripe redirect handler",async()=>{
  const s=await source("components/digital-checkout.tsx");
  assert.ok(s.includes("Carte saisie uniquement chez Stripe."));
  assert.ok(s.includes("Paiement sécurisé avec PayPal."));
  assert.ok(s.includes("<DigitalPaypalButtons ready={paymentReady}"));
  assert.ok(s.includes('onClick={()=>void payByCardOrLocal()}'));
  assert.doesNotMatch(s,/checkoutPaymentChoicePresentation\.(stripe|paypal)\.assurance/);
});
test("compact verified address saves retyping without approving an unreviewed or edited declaration",async()=>{
  const s=await source("components/digital-checkout.tsx");
  assert.ok(s.includes("compactAddress=loaded&&residenceReady&&!editingAddress"));
  assert.match(s,/const paymentReady=[^;]*&&!editingAddress/);
  assert.ok(s.includes("Modifier mon adresse"));assert.ok(s.includes("Conserver cette adresse"));
  assert.ok(s.includes('residenceReady=!!saved&&!dirty&&residence?.reviewStatus==="VERIFIED"'));
  assert.doesNotMatch(s,/setResidence\([^;]*reviewStatus\s*:\s*"VERIFIED"/);
});
test("live customer copy never describes a real purchase as a QA receipt",()=>{
  assert.doesNotMatch(digitalConfirmationMessage("GRANTED",false,"LIVE"),/QA|TEST/);
  assert.doesNotMatch(digitalLibraryBlockedMessage("PAID",false,"LIVE"),/QA|TEST/);
  assert.match(digitalLibraryBlockedMessage("PAID",false,"LIVE"),/confirmation contractuelle/);
  assert.match(digitalConfirmationMessage("PENDING",false,"LIVE"),/Aucun téléchargement débloqué/);
});
test("notification copy does not treat a captured QA email or a pending message as a delivery",()=>{
  assert.match(digitalNotificationMessage(["CAPTURED_QA"],"TEST"),/aucun envoi réel/);
  for(const state of ["PENDING","RETRY","CAPTURED_QA"]){assert.doesNotMatch(digitalNotificationMessage([state],"LIVE"),/a été envoyé|livré/);}
  assert.match(digitalNotificationMessage(["SENT"],"LIVE"),/a été envoyé/);
  assert.match(digitalNotificationMessage(["FAILED"],"LIVE"),/vérification/);
});
test("confirmation presentation cannot itself pay or grant rights and retains durable receipt and public withdrawal",async()=>{
  const s=await source("components/digital-confirmation-panel.tsx");
  assert.doesNotMatch(s,/fetch\(|prisma|\.capture\(|\.create\(|\.update\(|searchParams/);
  assert.ok(s.includes('<DigitalDocuments mode={mode}'));
  assert.ok(s.includes('paypal={status==="PENDING"&&paypalPending}'));
  assert.ok(s.includes('href={`/retractation?contrat=digital&commande=${id}`}'));
  assert.ok(s.includes('accessReady?"Votre musique vous attend."'));
});
