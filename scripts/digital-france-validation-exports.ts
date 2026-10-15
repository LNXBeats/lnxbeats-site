/** Pure exports for human professional review: no database, provider or approval. */
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {DIGITAL_FRANCE_TERMS_VERSION,DIGITAL_FRANCE_TERMS_TEXT,DIGITAL_FRANCE_TERMS_TEXT_HASH,
  DIGITAL_FRANCE_IMMEDIATE_SUPPLY_DRAFT,DIGITAL_FRANCE_WITHDRAWAL_ACKNOWLEDGEMENT_DRAFT,digitalFranceTermsDraft} from "@/lib/digital/france-legal";
import {digitalPrivacyAddendumDraft} from "@/lib/digital/digital-legal";
import {digitalContractSnapshot,verifyContractSnapshot} from "@/lib/digital/fulfillment-policy";

async function main(){
  assert.equal(process.argv.length,2);
  assert.equal(DIGITAL_FRANCE_TERMS_TEXT_HASH,"5e350e6bddb003b6ff0d2cd0236aa6876857b2d0376f8c99dd8362e8a1babe48");
  assert.equal(digitalFranceTermsDraft.hashSha256,"30c7ac06586dad083f13c334affd4763ba4c9b215b3c8f4cc28522e400ef042c");
  assert.equal(digitalFranceTermsDraft.approvedForLive,false);
  const root="output/dcn-france-validation-20261015";await mkdir(root,{recursive:true});
  const source=await readFile("components/digital-checkout.tsx","utf8");
  const terms=source.match(/<span>(J’ai lu et j’accepte les conditions France[^<]+)<\/span>/)?.[1];assert.ok(terms);
  for(const expression of["useState(false)","termsAccepted,earlyDelivery:early,withdrawalAcknowledged:withdraw,termsVersion"])
    assert.ok(source.includes(expression),"Reviewed checkout binding changed; inspect before exporting.");
  const contract=digitalContractSnapshot({name:"Client fictif pour revue",email:"revue-dcn@example.invalid"},new Date("2026-10-15T12:00:00.000Z"),DIGITAL_FRANCE_TERMS_VERSION);
  const verification=verifyContractSnapshot(contract,DIGITAL_FRANCE_TERMS_VERSION,DIGITAL_FRANCE_TERMS_TEXT_HASH);
  await writeFile(`${root}/CGV_DCN_FRANCE_DRAFT_02.txt`,DIGITAL_FRANCE_TERMS_TEXT+"\n");
  const privacy=digitalPrivacyAddendumDraft.sections.map(s=>`${s.title}\n${s.paragraphs.join("\n")}`).join("\n\n");
  await writeFile(`${root}/CONFIDENTIALITE_DCN_DRAFT_01.txt`,`DRAFT - non approuvé, non entré en vigueur\n${digitalPrivacyAddendumDraft.version}\nEmpreinte du document : ${digitalPrivacyAddendumDraft.hashSha256}\n\n${privacy}\n`);
  await writeFile(`${root}/CONSENTEMENTS_ET_CHAINE_DE_PREUVES.json`,JSON.stringify({
    scope:"EXPORT_POUR_REVUE_PAS_CONTRAT_CONCLU",mode:"TEST",approvedForLive:false,
    contract:{version:DIGITAL_FRANCE_TERMS_VERSION,textHashSha256:DIGITAL_FRANCE_TERMS_TEXT_HASH,documentHashSha256:digitalFranceTermsDraft.hashSha256,status:"DRAFT"},
    privacy:{version:digitalPrivacyAddendumDraft.version,documentHashSha256:digitalPrivacyAddendumDraft.hashSha256,status:"DRAFT"},
    checkoutChoices:[{field:"termsAccepted",initiallyChecked:false,text:terms},{field:"earlyDelivery",initiallyChecked:false,text:DIGITAL_FRANCE_IMMEDIATE_SUPPLY_DRAFT},
      {field:"withdrawalAcknowledged",initiallyChecked:false,text:DIGITAL_FRANCE_WITHDRAWAL_ACKNOWLEDGEMENT_DRAFT}],
    durableConfirmation:{example:"EXEMPLE_CONFIRMATION_QA.pdf",content:"Contenu/versions acquis, prix, texte accepté, choix, identité et dates. Exemple synthétique conservé du lot précédent, pas preuve de remise LIVE.",
      sequence:["Consentements et réservation vérifiés serveur","Paiement confirmé serveur, ou attribution gratuite prouvée sans PSP","Document privé figé et empreinte vérifiée","GET document propriétaire : flux terminé tracé, HEAD sans remise","Accusé explicite distinct du client QA après demande de téléchargement","Première fourniture revalidée puis accès bibliothèque"],
      limitations:["Fin de flux ≠ fichier conservé sur appareil","E-mail avec lien/capture QA ≠ remise durable juridiquement approuvée","Commencement/transport et libellés LIVE à valider","Attribution gratuite sans facture d'encaissement fictif"]},
    withdrawal:{path:"/retractation",kinds:["Rétractation","Non-conformité","Geste commercial"],onlineReceipt:"Contenu, date, heure UTC, empreinte, téléchargement privé",automaticRefund:false,automaticAccessRevocation:false,reviewRequired:true},
    syntheticSnapshotHash:verification.snapshotHash,
    noPersonalDataSource:true,noDatabaseCalls:true,noProviderCalls:true,noEmailsSent:true,
  },null,2)+"\n");
  const sha=createHash("sha256").update(DIGITAL_FRANCE_TERMS_TEXT+"\n").digest("hex");
  console.log(JSON.stringify({status:"PASS",contractVersion:DIGITAL_FRANCE_TERMS_VERSION,contractFrozen:true,privacyDraft:true,choices:3,termsFileSha256:sha,externalCalls:0,approvalsCreated:0}));
}
void main().catch(()=>{console.error("DCN validation export refused; no private values printed.");process.exitCode=1;});
