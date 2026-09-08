import type { AdminCleanupClassification } from "@/lib/admin/cleanup-classification";

export const ADMIN_CLEANUP_CONFIRMATION = "CONFIRM_ADMIN_TEST_CLEANUP";

export type AdminManagedRecordType = "MUSIC_ORDER" | "SHOP_ORDER" | "RIGHTS_REQUEST";

export type AdminCleanupCandidate = Readonly<{
  type: AdminManagedRecordType;
  id: string;
  reference: string;
  label: string;
  createdAt: Date;
  status: string;
  classification: AdminCleanupClassification;
  reason: string;
  archived: boolean;
}>;
