import test from "node:test";
import assert from "node:assert/strict";
import { memberInvitationPathAllowed, memberInvitationDismissed, MEMBER_INVITATION_DISMISS_MS, MEMBER_INVITATION_DELAY_MS, MEMBER_INVITATION_RETRY_MS } from "@/lib/members/invitation-policy";
import { isAllowedRegistrationCompletionPayload } from "@/lib/auth/input";
import { DEFAULT_RELEASE_ALERT_CHOICES } from "@/lib/release-notifications/domain";
import { memberMessages } from "@/lib/i18n/messages-members";
import { brandSafeTranslation } from "@/lib/i18n/protected-content";
import { readFile } from "node:fs/promises";

test("invitation is limited to discovery and never interrupts account/admin/payment/forms", () => {
  for (const path of ["/", "/discographie", "/album/vie-de-chien", "/creations/actualite", "/boutique/t-shirt"]) assert.equal(memberInvitationPathAllowed(path),true,path);
  for (const path of ["/admin", "/admin/membres", "/compte", "/inscription", "/connexion", "/commander", "/contact", "/musique/checkout", "/boutique/panier", "/boutique/confirmation", "/boutique/paiement", "/confidentialite"]) assert.equal(memberInvitationPathAllowed(path),false,path);
});
test("an explicit dismissal lasts at most thirty days and never stores an identity", () => {
  const now=1792686607000;
  assert.equal(memberInvitationDismissed(String(now+MEMBER_INVITATION_DISMISS_MS),now),true);
  for(const value of [null,"", "NaN", "Infinity", String(now-1), String(now+MEMBER_INVITATION_DISMISS_MS+1)]) assert.equal(memberInvitationDismissed(value,now),false);
});
test("a closed mobile menu is not an active modal and returning to the tab re-arms the invitation", async () => {
  const source = await readFile(new URL("../../components/member-invitation.tsx", import.meta.url), "utf8");
  assert.match(source, /getClientRects\(\)\.length > 0/);
  assert.match(source, /addEventListener\("visibilitychange", schedule\)/);
  assert.match(source, /removeEventListener\("visibilitychange", schedule\)/);
  assert.match(source, /aria-modal="false"/);
});
test("a visible dialog or focused form defers signup instead of consuming its only attempt", async () => {
  const source = await readFile(new URL("../../components/member-invitation.tsx", import.meta.url), "utf8");
  assert.equal(MEMBER_INVITATION_DELAY_MS,12_000);
  assert.equal(MEMBER_INVITATION_RETRY_MS,1_000);
  assert.match(source,/const offer = \(\) =>/);
  assert.match(source,/if \(modalVisible \|\| document\.activeElement\?\.matches/);
  assert.match(source,/setTimeout\(offer, MEMBER_INVITATION_RETRY_MS\)/);
  assert.match(source,/setTimeout\(offer, MEMBER_INVITATION_DELAY_MS\)/);
  assert.ok(source.indexOf("setTimeout(offer, MEMBER_INVITATION_RETRY_MS)") < source.indexOf("offered.current = true; setOpen(true)"));
  assert.match(source,/if \(!allowed \|\| isPending \|\| error \|\| session\?\.user \|\| offered\.current\) return/);
});
const passwords = {firstName:"Marie",lastName:"Dupont",password:"A synthetic phrase only 2026!",passwordConfirmation:"A synthetic phrase only 2026!"};
test("account creation remains possible without optional release alerts", () => {
  assert.equal(isAllowedRegistrationCompletionPayload(passwords),true);
  assert.equal(isAllowedRegistrationCompletionPayload({...passwords,releaseAlerts:DEFAULT_RELEASE_ALERT_CHOICES}),true);
  assert.deepEqual(DEFAULT_RELEASE_ALERT_CHOICES,{music:false,shop:false,editorial:false,locale:"fr"});
});
test("signup accepts only explicit boolean category choices, no checkbox-looking coercion", () => {
  assert.equal(isAllowedRegistrationCompletionPayload({...passwords,releaseAlerts:{music:true,shop:false,editorial:true,locale:"ja"}}),true);
  for(const releaseAlerts of [null,[],{},true,{music:"on",shop:false,editorial:false,locale:"fr"},{music:true,shop:false,editorial:false,locale:"de"},{...DEFAULT_RELEASE_ALERT_CHOICES,userId:"someone-else"}])
    assert.equal(isAllowedRegistrationCompletionPayload({...passwords,releaseAlerts}),false);
  assert.equal(isAllowedRegistrationCompletionPayload({...passwords,role:"ADMIN"}),false);
});
test("new invitation/premiere UI supports all six languages without translating LNX Beats", () => {
  for(const [source,translations] of Object.entries(memberMessages)) {
    assert.equal(translations.length,5);
    for(const translation of translations) { assert.ok(translation.trim()); if(source.includes("LNX Beats")) assert.ok(brandSafeTranslation(source,translation).includes("LNX Beats")); }
  }
});
