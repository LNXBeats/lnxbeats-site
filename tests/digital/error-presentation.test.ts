import test from "node:test";
import assert from "node:assert/strict";
import {digitalErrorMessage} from "../../lib/digital/error-presentation";

test("exact owned edition points to library without proposing a duplicate purchase",()=>{
  assert.match(digitalErrorMessage("ALREADY_OWNED"),/déjà dans Ma musique/);
  assert.doesNotMatch(digitalErrorMessage("ALREADY_OWNED"),/provisoire|paiement nécessite/);
});
test("completion blockers distinguish a credit calculation from a captured payment",()=>{
  for(const code of ["COMPLETION_SOURCE_REQUIRES_REVIEW","COMPLETION_REFUND_REQUIRES_REVIEW","COMPLETION_CREDIT_ALREADY_USED","COMPLETION_SOURCE_CHANGED"]){
    assert.match(digitalErrorMessage(code),/acquisitions, remboursements ou crédits réservés/);
    assert.doesNotMatch(digitalErrorMessage(code),/Ce paiement nécessite|Aucun paiement n’a/);
  }
  assert.match(digitalErrorMessage("COMPLETION_ZERO_REQUIRES_REVIEW"),/attribution sans paiement reste à valider/);
});
test("owned title explanation does not restore the obsolete blanket album prohibition",()=>{
  assert.match(digitalErrorMessage("ALBUM_PARTIALLY_OWNED",["QA — Piste 01"]),/QA — Piste 01/);
  assert.doesNotMatch(digitalErrorMessage("ALBUM_PARTIALLY_OWNED",["QA — Piste 01"]),/blocage de l’album est provisoire/);
});
test("new-sale audio failure distinguishes existing acquisitions",()=>{
  assert.match(digitalErrorMessage("NO_READY_MASTER"),/nouvelle vente/);
  assert.match(digitalErrorMessage("NO_READY_MASTER"),/déjà acquis ne sont pas remplacés/);
});
test("financial review and unrelated safe public explanations stay fail-closed",()=>{
  assert.match(digitalErrorMessage("PAYMENT_REQUIRES_REVIEW"),/Ne recommencez pas/);
  assert.match(digitalErrorMessage("PRICE_CHANGED"),/prix a changé/);
  assert.match(digitalErrorMessage("COUNTRY_DISABLED"),/territoire/);
  assert.match(digitalErrorMessage("PROVIDER_SECRET_INTERNAL_FAILURE"),/Vérifiez votre connexion/);
  assert.doesNotMatch(digitalErrorMessage("PROVIDER_SECRET_INTERNAL_FAILURE"),/SECRET/);
});
