import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  const free=digitalErrorMessage("COMPLETION_ZERO_REQUIRES_REVIEW");
  assert.match(free,/Revenez au panier/); assert.match(free,/sans paiement dans le parcours contrôlé/);
  assert.match(free,/via \/contact/); assert.doesNotMatch(free,/reste à valider/);
});
test("unallocatable promotion and completion blockers propose a concrete contact without granting credits",()=>{
  for(const code of ["ALBUM_PARTIALLY_OWNED","COMPLETION_SOURCE_REQUIRES_REVIEW","COMPLETION_PROMOTION_ALLOCATION_REQUIRES_REVIEW","COMPLETION_REFUND_REQUIRES_REVIEW"]){
    assert.match(digitalErrorMessage(code),/via \/contact/);
    assert.match(digitalErrorMessage(code),/ne permet pas|nécessite une vérification/);
  }
  assert.match(digitalErrorMessage("ALBUM_PARTIALLY_OWNED",["QA track"]),/via \/contact/);
  assert.match(digitalErrorMessage("COMPLETION_SOURCE_REQUIRES_REVIEW"),/Aucun nouveau crédit n’est appliqué/);
});
test("catalogue, cart and checkout blocker contacts use a plain path without prefilled private data",async()=>{
  for(const path of ["components/digital-catalog.tsx","components/digital-cart.tsx","components/digital-checkout.tsx"]){
    const source=await readFile(path,"utf8");
    assert.match(source,/<Link href="\/contact" className="text-link">Contacter LNX Beats pour examiner le (?:complément|blocage)<\/Link>/);
    assert.doesNotMatch(source,/href=["']\/contact[?#]/);
  }
});
test("geographic blockers remain closed and never offer a contact as an override",()=>{
  for(const code of ["FRANCE_RESIDENCE_DECLARATION_REQUIRED","COUNTRY_DISABLED","TERRITORY_REVIEW_REQUIRED"]){
    const text=digitalErrorMessage(code);assert.match(text,/Aucun nouveau paiement n’a été lancé/);
    assert.doesNotMatch(text,/complément sans paiement|via \/contact|autorisé/);
  }
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
