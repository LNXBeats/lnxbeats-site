import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { DigitalError } from "./domain";
import { assertDigitalExcerptApprovals } from "./excerpt-commerce";
import type { DigitalExcerptMaster } from "./excerpt-policy";
import { digitalCommercialAudioReady } from "./formats";
import { assertDigitalRightsReviews } from "./rights-review-service";

type PublicPreviewMaster = DigitalExcerptMaster & {
  previewAsset: (NonNullable<DigitalExcerptMaster["previewAsset"]> & { rightsStatus: string }) | null;
};

/** Public listening is independent of an active sale, but never of the exact
 * edition's rights and artistic approvals. Admin audition and acquired private
 * downloads deliberately do not use this new-publication gate.
 */
export async function digitalPublicPreviewAllowed(db: Prisma.TransactionClient, master: PublicPreviewMaster | null | undefined) {
  if (!master || master.previewAsset?.rightsStatus !== "CLEARED" || !digitalCommercialAudioReady(master)) return false;
  try {
    await assertDigitalRightsReviews(db, [master.id]);
    await assertDigitalExcerptApprovals(db, [master]);
    return true;
  } catch (error) {
    if (error instanceof DigitalError) return false;
    throw error;
  }
}
