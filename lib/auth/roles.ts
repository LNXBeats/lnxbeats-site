export const USER_ROLES = ["ADMIN", "MEMBER", "CUSTOMER"] as const;
export const USER_STATUSES = ["PENDING", "ACTIVE", "SUSPENDED", "DEACTIVATED"] as const;

export type UserRole = (typeof USER_ROLES)[number];
export type UserStatus = (typeof USER_STATUSES)[number];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && USER_ROLES.includes(value as UserRole);
}

export function isActiveStatus(value: unknown): value is "ACTIVE" {
  return value === "ACTIVE";
}

export function canAccessRole(role: unknown, allowedRoles: readonly UserRole[]) {
  return isUserRole(role) && allowedRoles.includes(role);
}

export function canAccessAccount(role: unknown) {
  return canAccessRole(role, USER_ROLES);
}

export function canAccessAdmin(role: unknown) {
  return canAccessRole(role, ["ADMIN"]);
}
