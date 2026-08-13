import { canAccessOrder } from "@/lib/orders/domain";

type MediaActor = {
  id: string;
  role: "ADMIN" | "MEMBER" | "CUSTOMER";
  status: "ACTIVE" | "PENDING" | "SUSPENDED" | "DEACTIVATED";
  emailVerified: boolean;
};

export function canReadOrderMedia(actor: MediaActor, orderOwnerId: string | null) {
  return actor.status === "ACTIVE" && actor.emailVerified && canAccessOrder(actor, orderOwnerId);
}

export function canManageProjectMedia(actor: Pick<MediaActor, "role" | "status" | "emailVerified">) {
  return actor.role === "ADMIN" && actor.status === "ACTIVE" && actor.emailVerified;
}
