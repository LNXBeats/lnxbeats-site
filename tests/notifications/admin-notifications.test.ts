import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ADMIN_NOTIFICATION_RETRY_CONFIRMATION,
  ADMIN_NOTIFICATION_SUPPRESSION_CONFIRMATION,
  isAdminNotificationRetryConfirmed,
  isAdminNotificationSuppressionConfirmed,
  maskedProviderMessageId,
  notificationKindPresentation,
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

test("les libellés Admin incluent les notifications Boutique sans enum technique", () => {
  assert.equal(notificationKindPresentation.OWNER_SHOP_ORDER_PAID, "Commande Boutique payée — propriétaire");
  assert.equal(notificationKindPresentation.CUSTOMER_SHOP_PAYMENT_CONFIRMED, "Commande Boutique confirmée — client");
  assert.equal(notificationKindPresentation.CUSTOMER_SHOP_PREPARING, "Commande Boutique en préparation — client");
  assert.equal(notificationKindPresentation.CUSTOMER_SHOP_SHIPPED, "Commande Boutique expédiée — client");
  assert.doesNotMatch(Object.values(notificationKindPresentation).join("\n"), /OWNER_SHOP|CUSTOMER_SHOP/);
});

test("la vue Admin place les opérations avant les détails et fournit des cartes mobiles", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../../app/admin/notifications/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/admin.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<th>État \/ objet<\/th><th>Ressource<\/th><th>Destination<\/th><th>Action<\/th><th>Détails<\/th>/);
  assert.match(page, /function NotificationTechnicalDetails/);
  assert.match(page, /<details className="admin-technical-details">/);
  assert.match(page, /<details className="admin-panel admin-diagnostics-panel" open=\{reviewEvents\.length > 0\}>/);
  assert.match(page, /DIAGNOSTIC TECHNIQUE/);
  assert.match(page, /Suivi opérationnel/);
  assert.match(page, /className="admin-mobile-records admin-notification-records"/);
  assert.match(page, /className="admin-check"><input required type="checkbox" name="retryConfirmation"/);
  assert.match(page, /className="admin-check"><input required type="checkbox" name="suppressionConfirmation"/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.admin-desktop-records \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.admin-mobile-records \{ display: grid;/);
});
