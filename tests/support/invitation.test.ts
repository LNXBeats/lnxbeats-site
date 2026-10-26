import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { remainingSupportInvitationDelay, supportInvitationDismissed, supportInvitationPathAllowed, SUPPORT_INVITATION_DELAY_MS, SUPPORT_INVITATION_DISMISS_KEY, SUPPORT_INVITATION_DISMISS_MS, SUPPORT_INVITATION_RETRY_MS } from "@/lib/support/invitation-policy";
import { supportInvitationMessages } from "@/lib/i18n/messages-support-invitation";
import { brandSafeTranslation } from "@/lib/i18n/protected-content";

test("support invitation starts after one minute of visible discovery, not before", () => {
  assert.equal(SUPPORT_INVITATION_DELAY_MS, 60_000);
  assert.equal(remainingSupportInvitationDelay(SUPPORT_INVITATION_DELAY_MS, 15_000), 45_000);
  assert.equal(remainingSupportInvitationDelay(45_000, 30_000), 15_000);
  assert.equal(remainingSupportInvitationDelay(15_000, 30_000), 0);
  assert.equal(remainingSupportInvitationDelay(60_000, -1), 60_000);
  assert.equal(SUPPORT_INVITATION_RETRY_MS, 5_000);
});

test("support never interrupts support itself, purchases, accounts or administrative forms", () => {
  for (const pathname of ["/", "/discographie", "/album/vie-de-chien", "/boutique", "/boutique/t-shirt", "/creations/histoire", "/avant-premieres"]) assert.equal(supportInvitationPathAllowed(pathname), true, pathname);
  for (const pathname of ["/admin", "/admin/musique", "/compte", "/soutenir", "/soutenir/confirmation", "/connexion", "/inscription", "/commander", "/contact", "/musique/panier", "/musique/checkout", "/boutique/panier", "/boutique/paiement", "/boutique/confirmation", "/boutique/retour", "/confidentialite"]) assert.equal(supportInvitationPathAllowed(pathname), false, pathname);
});

test("dismissal is bounded, independent of signup and contains no identity", () => {
  const now = 1_792_686_607_000;
  assert.equal(SUPPORT_INVITATION_DISMISS_MS, 30 * 24 * 60 * 60_000);
  assert.notEqual(SUPPORT_INVITATION_DISMISS_KEY, "lnx-member-invitation-dismissed-until-v1");
  assert.equal(supportInvitationDismissed(String(now + SUPPORT_INVITATION_DISMISS_MS), now), true);
  for (const value of [null, "", "NaN", "Infinity", String(now), String(now - 1), String(now + SUPPORT_INVITATION_DISMISS_MS + 1)]) assert.equal(supportInvitationDismissed(value, now), false, String(value));
});

test("all six invitation languages are available and preserve the LNX Beats brand", () => {
  for (const [source, translations] of Object.entries(supportInvitationMessages)) {
    assert.equal(translations.length, 5);
    for (const translation of translations) {
      assert.ok(translation.trim());
      if (source.includes("LNX Beats")) assert.ok(brandSafeTranslation(source, translation).includes("LNX Beats"));
    }
  }
});

test("support is the first shop card without changing product order or payment configuration", async () => {
  const source = await readFile(new URL("../../app/boutique/page.tsx", import.meta.url), "utf8");
  const collection = source.slice(source.indexOf('<div className="shop-product-grid">', source.indexOf("shop-products-title")));
  assert.ok(collection.indexOf("<ShopSupportCard />") < collection.indexOf("{collection.map("));
  assert.match(source, /supportAvailable = isSupportEnabled\(\)/);
  assert.match(source, /left\.position - right\.position/);
  assert.doesNotMatch(source, /(?:create|capture|confirm)(?:Payment|Order|Session)\(/);
});

test("non-modal support yields to signup, consent, focused fields and hidden tabs", async () => {
  const source = await readFile(new URL("../../components/support-invitation.tsx", import.meta.url), "utf8");
  assert.match(source, /\[role="dialog"\]/);
  assert.match(source, /fc-consent-root/);
  assert.match(source, /getClientRects\(\)\.length > 0/);
  assert.match(source, /activeElement\?\.matches/);
  assert.match(source, /document\.visibilityState !== "visible"/);
  assert.match(source, /setTimeout\(offer, SUPPORT_INVITATION_RETRY_MS\)/);
  assert.match(source, /addEventListener\("visibilitychange", schedule\)/);
  assert.match(source, /removeEventListener\("visibilitychange", schedule\)/);
  assert.match(source, /aria-modal="false"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /previousFocus\.current\?\.focus/);
  assert.match(source, /href="\/soutenir"/);
  assert.doesNotMatch(source, /fetch\(|<iframe|<form|stripe|paypal|authClient|dangerouslySetInnerHTML/i);
});

test("invitation has no tracking request or forced focus and honors reduced motion", async () => {
  const component = await readFile(new URL("../../components/support-invitation.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../../components/support-invitation.module.css", import.meta.url), "utf8");
  assert.match(component, /localStorage\.setItem\(SUPPORT_INVITATION_DISMISS_KEY/);
  assert.doesNotMatch(component, /autoFocus|\.focus\(\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /max-height:calc\(100dvh/);
  assert.match(css, /:focus-visible/);
});

test("signup and support both yield to the other non-modal dialog, including delayed signup auth", async () => {
  const member = await readFile(new URL("../../components/member-invitation.tsx", import.meta.url), "utf8");
  const support = await readFile(new URL("../../components/support-invitation.tsx", import.meta.url), "utf8");
  for (const source of [member, support]) {
    assert.match(source, /\[role="dialog"\]/);
    assert.match(source, /getClientRects\(\)\.length > 0/);
    assert.match(source, /aria-modal="false"/);
  }
  assert.match(member, /if \(modalVisible \|\| document\.activeElement\?\.matches/);
  assert.match(member, /setTimeout\(offer, MEMBER_INVITATION_RETRY_MS\)/);
});

test("a closed header dialog cannot make support invisible on desktop or mobile", async () => {
  const header = await readFile(new URL("../../components/site-header.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../../components/support-invitation.module.css", import.meta.url), "utf8");
  assert.match(header,/id="mobile-navigation"/);
  assert.match(header,/aria-modal="true"/);
  assert.match(css,/:global\(body:has\(dialog\[open\]\)\) \.invitation\{display:none\}/);
  assert.doesNotMatch(css,/:has\(\[aria-modal="true"\]\)/);
});
