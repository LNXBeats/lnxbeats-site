import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_NOTIFICATION_RETRY_CONFIRMATION,
  ADMIN_NOTIFICATION_SUPPRESSION_CONFIRMATION,
  isAdminNotificationRetryConfirmed,
  isAdminNotificationSuppressionConfirmed,
  maskedProviderMessageId,
} from "@/lib/notifications/admin-presentation";
import { manualRetryAllowed } from "@/lib/notifications/domain";

test("le rejeu Admin exige la confirmation exacte", () => {
  assert.equal(isAdminNotificationRetryConfirmed(ADMIN_NOTIFICATION_RETRY_CONFIRMATION), true);
  assert.equal(isAdminNotificationRetryConfirmed(undefined), false);
  assert.equal(isAdminNotificationRetryConfirmed("true"), false);
  assert.equal(isAdminNotificationRetryConfirmed(`${ADMIN_NOTIFICATION_RETRY_CONFIRMATION} `), false);
});

test("la suppression manuelle Admin exige une confirmation distincte et exacte", () => {
  assert.equal(isAdminNotificationSuppressionConfirmed(ADMIN_NOTIFICATION_SUPPRESSION_CONFIRMATION), true);
  assert.equal(isAdminNotificationSuppressionConfirmed(undefined), false);
  assert.equal(isAdminNotificationSuppressionConfirmed(ADMIN_NOTIFICATION_RETRY_CONFIRMATION), false);
  assert.equal(isAdminNotificationSuppressionConfirmed(`${ADMIN_NOTIFICATION_SUPPRESSION_CONFIRMATION} `), false);
});

test("seul un échec retryable non supprimé et sous la limite est rejouable", () => {
  assert.equal(manualRetryAllowed({ status: "FAILED_RETRYABLE", suppressionActive: false, attempts: 1 }), true);
  assert.equal(manualRetryAllowed({ status: "FAILED_FINAL", suppressionActive: false, attempts: 1 }), false);
  assert.equal(manualRetryAllowed({ status: "FAILED_RETRYABLE", suppressionActive: true, attempts: 1 }), false);
  assert.equal(manualRetryAllowed({ status: "FAILED_RETRYABLE", suppressionActive: false, attempts: 5 }), false);
  assert.equal(manualRetryAllowed({ status: "DELIVERED", suppressionActive: false, attempts: 1 }), false);
});

test("les identifiants fournisseur sont masqués sans révéler leur valeur complète", () => {
  const source = "c51b87d5-1c23-4c21-b346-cdb5c4b32955";
  const masked = maskedProviderMessageId(source);
  assert.equal(masked, "c51b87••••2955");
  assert.equal(masked.includes(source), false);
  assert.equal(maskedProviderMessageId(null), "Non attribué");
  assert.equal(maskedProviderMessageId("short"), "sh••••");
});
