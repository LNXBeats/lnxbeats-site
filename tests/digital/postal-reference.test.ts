import test from "node:test";
import assert from "node:assert/strict";
import reference from "@/data/digital-postal-reference-20261018.json";
import {digitalPostalAddressCoherent,normalizeDigitalPostalCity} from "@/lib/digital/postal-reference";
import {digitalResidenceFeedback,digitalResidenceErrorMessage} from "@/lib/digital/residence-presentation";

test("local La Poste reference is pinned, metropolitan/Corse only, and contains real ordinary routing codes",()=>{
  assert.equal(reference.sourceSha256,"f921ac020ca3b9efebd8f0d01782555fb70d63d1ae36535109c67e4a74bd6e22");
  assert.equal(reference.license,"Licence Ouverte / Open Licence 2.0");
  assert.equal(Object.keys(reference.postcodes).length,6051);
  for(const [code,city] of [["75001","Paris"],["20000","Ajaccio"],["20200","Bastia"],["69001","Lyon"],["42000","Saint-Étienne"]])assert.equal(digitalPostalAddressCoherent("FR",code,city),true,code+" "+city);
});
test("postal matching accepts accents/case/hyphens/SAINT abbreviation but not arbitrary city or foreign/overseas/CEDEX code",()=>{
  assert.equal(normalizeDigitalPostalCity(" St-Étienne "),"SAINT ETIENNE");
  for(const [country,code,city] of [["FR","75001","Ajaccio"],["FR","75050","Paris"],["FR","97100","Basse-Terre"],["FR","98000","Monaco"],["BE","75001","Paris"],["FR","75001","Paris CEDEX"]])assert.equal(digitalPostalAddressCoherent(country,code,city),false);
});
test("customer feedback distinguishes automatic eligibility from manual certification and explains genuine blocks",()=>{
  assert.match(digitalResidenceFeedback({checkoutEligible:true,reviewStatus:"REVIEW"}),/poursuivre votre commande/);
  assert.doesNotMatch(digitalResidenceFeedback({checkoutEligible:true}),/identité|certifi|domicile vérifié/i);
  assert.match(digitalResidenceErrorMessage("FRANCE_ADDRESS_POSTAL_CITY_MISMATCH"),/code postal et la ville/);
  assert.match(digitalResidenceErrorMessage("PAYMENT_ALREADY_ENGAGED"),/ne recommencez pas le paiement/);
  assert.match(digitalResidenceErrorMessage("FRANCE_RESIDENCE_BILLING_CONFLICT_REVIEW_REQUIRED"),/LNX Beats/);
});
