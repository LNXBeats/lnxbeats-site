/** Transportable, entirely fictitious samples. Never reads a DB/customer or overwrites old PDF evidence. */
import { mkdir,writeFile } from "node:fs/promises";
import { generateInvoicePdf,generateCreditNotePdf,type InvoicePdfRecord } from "@/lib/billing/pdf";
import { billingSnapshotHash } from "@/lib/billing/domain";
import { generateDigitalContractPdf } from "@/lib/digital/documents";
import { digitalContractSnapshot,digitalEmailTemplate,DIGITAL_FISCAL_REVIEW_NOTICE } from "@/lib/digital/fulfillment-policy";
const output="output/dcn-1-2/samples";await mkdir(output,{recursive:true});
const at=new Date("2026-10-13T12:00:00.000Z"),orderId="00000000-0000-4000-8000-000000000012";
const seller={legalName:"Entreprise fictive DCN QA",legalForm:"Identité de démonstration",tradeName:"LNX Studio QA",serviceName:"Musique numérique QA",address:{line1:"Adresse fictive de démonstration",line2:null,postalCode:"00000",city:"Ville QA",countryCode:"FR"},siren:"000000000",siret:"00000000000000",ape:"0000Z",email:"seller@example.invalid",phone:"Non attribué (QA)"};
const source={invoiceNumber:"DCN-QA-EXPORT-0001",issuedAt:at,paidAt:at,orderNumberSnapshot:orderId,sellerSnapshot:seller,customerSnapshot:{type:"INDIVIDUAL",name:"Acquéreur fictif QA",email:"buyer@example.invalid"},lineItemsSnapshot:[{description:"Album numérique QA - 12 pistes synthétiques",quantity:1,unitPriceCents:990,lineTotalCents:990}],subtotalCents:990,shippingCents:0,totalCents:990,currency:"EUR",vatLegalNotice:DIGITAL_FISCAL_REVIEW_NOTICE,paymentMethodLabel:"Simulation locale - aucun paiement prestataire",termsVersion:"DCN-1.0-LOCAL-REVIEW"};
const invoice:InvoicePdfRecord={...source,snapshotHashSha256:billingSnapshotHash(source)};
await writeFile(`${output}/facture-qa.pdf`,(await generateInvoicePdf(invoice,"TEST",{digital:true})).bytes);
const credit={creditNoteNumber:"DCN-QA-AV-0001",issuedAt:at,amountCents:100,cumulativeCreditedCents:100,remainingBalanceCents:890,currency:"EUR",reasonCode:"OTHER_REVIEWED",reasonText:"Réduction QA confirmée par double local ; droits conservés.",invoice,snapshotHashSha256:billingSnapshotHash({orderId,amountCents:100})};
await writeFile(`${output}/avoir-qa.pdf`,(await generateCreditNotePdf(credit,"TEST",{digital:true})).bytes);
const contract=digitalContractSnapshot({email:"buyer@example.invalid",name:"Acquéreur fictif QA"},at);
const content=Array.from({length:12},(_,i)=>({title:`QA - Piste ${String(i+1).padStart(2,"0")}`,masterId:`qa-master-${i+1}`}));
await writeFile(`${output}/confirmation-qa.pdf`,await generateDigitalContractPdf({...source,invoice:source.invoiceNumber,contract,termsText:contract.terms.text,acquired:[{content}],versions:content.map(t=>({masterId:t.masterId,version:1,format:"WAV"}))},"DCN-QA-EXPORT-CONFIRMATION-0001"));
for(const kind of ["CONTRACT_AVAILABLE","ACCESS_READY","REFUND_CONFIRMED"]){const mail=digitalEmailTemplate({kind,orderId,totalCents:kind==="REFUND_CONFIRMED"?100:990,titles:["Album QA - 12 pistes synthétiques"],base:"https://qa.example.invalid",documentNumber:kind==="REFUND_CONFIRMED"?credit.creditNoteNumber:source.invoiceNumber});for(const ext of ["html","txt"] as const)await writeFile(`${output}/email-${kind.toLowerCase()}.${ext}`,ext==="html"?mail.html:mail.text);}
console.log("Three entirely fictitious QA PDF examples and captured email templates prepared, no DB or external calls.");
