import "server-only";
import type {Prisma} from "@/generated/prisma/client";
import {DigitalError} from "./domain";
import {DIGITAL_RIGHTS_REVIEW_POLICY} from "./rights-review-policy";
import {assertDigitalRightsReviews} from "./rights-review-service";
import {assertDigitalOrderFormatSupplement} from "./format-supplement";

/** New checkouts stamp their contract at creation; historic contracts are not rewritten.
 * Recheck before capture/confirmation/first delivery, never on acquired re-downloads.
 */
export async function checkDigitalAcquiredRightsReview(snapshot:unknown,lines:ReadonlyArray<{trackSnapshot:unknown}>,db:Prisma.TransactionClient){
  assertDigitalOrderFormatSupplement(snapshot,lines);
  if(snapshot===null||snapshot===undefined)return;
  if(typeof snapshot!=="object"||Array.isArray(snapshot))throw new DigitalError("RIGHTS_REVIEW_POLICY_INVALID",409);
  if(!Object.prototype.hasOwnProperty.call(snapshot,"rightsReviewPolicy"))return;
  if((snapshot as Record<string,unknown>).rightsReviewPolicy!==DIGITAL_RIGHTS_REVIEW_POLICY)throw new DigitalError("RIGHTS_REVIEW_POLICY_INVALID",409);
  const ids:string[]=[];
  for(const line of lines){
    if(!Array.isArray(line.trackSnapshot)||!line.trackSnapshot.length)throw new DigitalError("RIGHTS_REVIEW_REQUIRED",409);
    for(const track of line.trackSnapshot){if(!track||typeof track.masterId!=="string")throw new DigitalError("RIGHTS_REVIEW_REQUIRED",409);ids.push(track.masterId);}
  }
  await assertDigitalRightsReviews(db,ids);
}
