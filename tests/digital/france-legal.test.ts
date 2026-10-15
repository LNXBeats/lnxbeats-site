import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { approvedLegalDocuments, approvedLegalNotices, approvedWithdrawalNotice, consumerMediatorInformation } from "@/data/legal";
import { digitalMusicTermsDraft, DIGITAL_MUSIC_TERMS_DRAFT_TEXT_HASH } from "@/lib/digital/digital-legal";
import { digitalFranceTermsDraft, DIGITAL_FRANCE_TERMS_TEXT, DIGITAL_FRANCE_TERMS_TEXT_HASH, DIGITAL_FRANCE_TERMS_VERSION,
  DIGITAL_FRANCE_PROPOSED_SCOPE, DIGITAL_FRANCE_IMMEDIATE_SUPPLY_DRAFT, DIGITAL_FRANCE_WITHDRAWAL_ACKNOWLEDGEMENT_DRAFT } from "@/lib/digital/france-legal";

test("France terms are a separate non-approved immutable draft, never a territory or fiscal activation", () => {
  const draft = digitalFranceTermsDraft;
  assert.equal(draft.status, "DRAFT"); assert.equal(draft.version, DIGITAL_FRANCE_TERMS_VERSION);
  for (const value of [draft.effectiveAt, draft.approvedAt, draft.approvedBy, draft.legalReviewReference, draft.fiscalReviewReference]) assert.equal(value, null);
  assert.equal(draft.approvedForLive, false); assert.equal(draft.userApprovalRecorded, false); assert.equal(draft.userApprovalScope, "TERMS_TEXT_ONLY");
  assert.equal(DIGITAL_FRANCE_PROPOSED_SCOPE.commercialScopeUserConfirmed, true); assert.equal(DIGITAL_FRANCE_PROPOSED_SCOPE.approvedForLive, false);
  assert.equal(DIGITAL_FRANCE_PROPOSED_SCOPE.legalGeographicRestrictionApproved, false);
  assert.ok(Object.isFrozen(draft)); assert.ok(Object.isFrozen(draft.sections)); assert.ok(draft.sections.every(section => Object.isFrozen(section.paragraphs)));
  assert.notEqual(draft.version, digitalMusicTermsDraft.version); assert.notEqual(draft.hashSha256, digitalMusicTermsDraft.hashSha256);
});

test("France text and document hashes deterministically bind the exact candidate", () => {
  const { hashSha256, ...payload } = digitalFranceTermsDraft;
  assert.equal(hashSha256, createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex"));
  assert.equal(DIGITAL_FRANCE_TERMS_TEXT_HASH, createHash("sha256").update(DIGITAL_FRANCE_TERMS_TEXT, "utf8").digest("hex"));
});

test("seller, existing mediator and historical digital/legal proofs are reused without replacement", () => {
  const refs = digitalFranceTermsDraft.existingProofReferences;
  assert.deepEqual(refs.seller, { version: approvedLegalNotices.version, hashSha256: approvedLegalNotices.hashSha256 });
  assert.equal(refs.withdrawalInformation.hashSha256, approvedWithdrawalNotice.hashSha256);
  assert.deepEqual(refs.previousDigitalDraft, { version: digitalMusicTermsDraft.version, hashSha256: digitalMusicTermsDraft.hashSha256, textHashSha256: DIGITAL_MUSIC_TERMS_DRAFT_TEXT_HASH });
  assert.ok(DIGITAL_FRANCE_TERMS_TEXT.includes(consumerMediatorInformation.website)); assert.ok(DIGITAL_FRANCE_TERMS_TEXT.includes(consumerMediatorInformation.name));
  assert.match(DIGITAL_FRANCE_TERMS_TEXT, /aucune nouvelle adhésion/i);
  for (const paragraph of approvedLegalNotices.sections.find(section => section.title === "Éditeur du service")!.paragraphs.slice(0, 3)) assert.ok(DIGITAL_FRANCE_TERMS_TEXT.includes(paragraph));
  assert.ok(approvedLegalDocuments.every(document => document.status === "APPROVED" && document.approvedAt && document.effectiveAt === null));
});

test("user-confirmed metropolitan/Corse commercial scope is not generic FR or a legally approved nationality/IP/card-country blockade", () => {
  assert.equal(DIGITAL_FRANCE_PROPOSED_SCOPE.marketCode, "FR-MET"); assert.equal(DIGITAL_FRANCE_PROPOSED_SCOPE.marketCodeIsInternal, true);
  assert.deepEqual(DIGITAL_FRANCE_PROPOSED_SCOPE.excludes, ["OVERSEAS", "FOREIGN_MARKETS", "B2B"]);
  assert.match(DIGITAL_FRANCE_TERMS_TEXT, /Corse comprise/); assert.match(DIGITAL_FRANCE_TERMS_TEXT, /n’est pas un code pays officiel/);
  assert.match(DIGITAL_FRANCE_TERMS_TEXT, /Cette décision de lancement est confirmée/);
  assert.match(DIGITAL_FRANCE_TERMS_TEXT, /sans filtrage par nationalité ou adresse IP/);
  assert.ok(digitalFranceTermsDraft.reviewRequired.includes("FR_GEOGRAPHIC_RESTRICTION_NON_DISCRIMINATION"));
});

test("customer draft describes WAV/MP3 and two ZIPs without imposing a universal twelve-track album or a buyer-selected price", () => {
  assert.match(DIGITAL_FRANCE_TERMS_TEXT, /ZIP WAV et ZIP MP3/); assert.match(DIGITAL_FRANCE_TERMS_TEXT, /soixante secondes/);
  assert.match(DIGITAL_FRANCE_TERMS_TEXT, /aucun nombre fixe de pistes/); assert.doesNotMatch(DIGITAL_FRANCE_TERMS_TEXT, /12 pistes|douze pistes/);
  assert.match(DIGITAL_FRANCE_TERMS_TEXT, /fixés librement par LNX Beats/); assert.match(DIGITAL_FRANCE_TERMS_TEXT, /client ne choisit pas un montant libre/);
  assert.match(DIGITAL_FRANCE_TERMS_TEXT, /sommes réellement payées et non remboursées/); assert.match(DIGITAL_FRANCE_TERMS_TEXT, /Une même acquisition ne peut servir deux fois/);
});

test("withdrawal contains all four cumulative conditions and preserves guarantees and the ordinary fourteen-day right", () => {
  for (const expected of ["quatorze jours à compter de la conclusion", "consentement exprès préalable", "reconnaissance de la perte", "confirmation de cet accord sur un support durable", "fourniture a commencé", "L. 221-28, 13°", "L. 221-13"]) assert.ok(DIGITAL_FRANCE_TERMS_TEXT.includes(expected), expected);
  assert.ok(DIGITAL_FRANCE_TERMS_TEXT.includes(DIGITAL_FRANCE_IMMEDIATE_SUPPLY_DRAFT)); assert.ok(DIGITAL_FRANCE_TERMS_TEXT.includes(DIGITAL_FRANCE_WITHDRAWAL_ACKNOWLEDGEMENT_DRAFT));
  assert.match(DIGITAL_FRANCE_TERMS_TEXT, /L’acceptation des CGV ou le seul paiement ne remplace pas/);
  assert.match(DIGITAL_FRANCE_TERMS_TEXT, /garanties légales demeurent applicables même/);
  assert.match(DIGITAL_FRANCE_TERMS_TEXT, /modèle de notification de rétractation/);
});

test("withdrawal reference is an existing route, not a false claim of current digital support or an obsolete ODR URL", async () => {
  assert.equal(digitalFranceTermsDraft.existingProofReferences.withdrawalInformation.informationPath, "/retractation");
  const page = await readFile("app/retractation/page.tsx", "utf8"); assert.match(page, /WithdrawalForm/);
  assert.match(DIGITAL_FRANCE_TERMS_TEXT, /prise en charge explicite des achats numériques doit être raccordée et vérifiée/);
  assert.ok(digitalFranceTermsDraft.reviewRequired.includes("FR_DIGITAL_WITHDRAWAL_ONLINE_ROUTE"));
  assert.doesNotMatch(DIGITAL_FRANCE_TERMS_TEXT, /ec\.europa\.eu\/consumers\/odr|webgate\.ec\.europa/);
});

test("digital conformity distinguishes two-year liability from twelve-month presumption and retains the statutory-box review", () => {
  assert.match(DIGITAL_FRANCE_TERMS_TEXT, /deux ans qui la suivent/); assert.match(DIGITAL_FRANCE_TERMS_TEXT, /douze premiers mois/);
  assert.match(DIGITAL_FRANCE_TERMS_TEXT, /sans frais, sans retard injustifié et sans inconvénient majeur/);
  assert.match(DIGITAL_FRANCE_TERMS_TEXT, /D\. 211-3 et son annexe/);
  assert.ok(digitalFranceTermsDraft.reviewRequired.includes("FR_D211_3_STATUTORY_GUARANTEE_BOX"));
  assert.match(DIGITAL_FRANCE_TERMS_TEXT, /mises à jour légalement nécessaires/);
});

test("no tax rate, default exemption or historical-policy rewrite is introduced", () => {
  assert.match(DIGITAL_FRANCE_TERMS_TEXT, /Aucun taux de TVA, exemption ou mention fiscale/);
  assert.doesNotMatch(DIGITAL_FRANCE_TERMS_TEXT, /293\s*B|TVA\s*(?:à|=)\s*0|TVA non applicable/);
  assert.match(DIGITAL_FRANCE_TERMS_TEXT, /Stripe et PayPal/); assert.match(DIGITAL_FRANCE_TERMS_TEXT, /sans devenir automatiquement vendeurs/);
  assert.match(DIGITAL_FRANCE_TERMS_TEXT, /nouveau master, une réédition ou un remaster n’est pas ajouté automatiquement/);
  assert.match(DIGITAL_FRANCE_TERMS_TEXT, /ne modifie pas une acquisition déjà confirmée/);
  assert.match(DIGITAL_FRANCE_TERMS_TEXT, /historique restent conservés/);
});

test("confirmed private licence, collaboration controls and individual change-of-mind review are not invented legal approval", () => {
  const decisions = digitalFranceTermsDraft.commercialDecisions;
  assert.equal(decisions.provenance, "USER_CONFIRMED"); assert.equal(decisions.privateUseOnly, true);
  assert.equal(decisions.separatePublicOrCommercialAuthorisationRequired, true); assert.equal(decisions.collaborationRightsVerifiedBeforeSale, true);
  assert.equal(decisions.collaborationProofsPrivateAdminOnly, true); assert.equal(decisions.changeOfMindRefundIndividualReview, true);
  assert.equal(decisions.automaticCommercialRefundAfterValidImmediateSupply, false); assert.equal(decisions.mandatoryConsumerRightsPreserved, true); assert.equal(decisions.legallyApproved, false);
  assert.match(DIGITAL_FRANCE_TERMS_TEXT, /exclusivement l’écoute, le téléchargement et la conservation des fichiers acquis pour un usage privé/);
  assert.match(DIGITAL_FRANCE_TERMS_TEXT, /aucune diffusion publique, redistribution, publication/);
  assert.match(DIGITAL_FRANCE_TERMS_TEXT, /autorisations spécifiques séparées/);
  assert.match(DIGITAL_FRANCE_TERMS_TEXT, /justificatifs restent privés dans l’Admin/);
  assert.match(DIGITAL_FRANCE_TERMS_TEXT, /état de droits non validé bloque la commercialisation/);
  assert.match(DIGITAL_FRANCE_TERMS_TEXT, /simple changement d’avis fait l’objet d’un examen individuel/);
  assert.match(DIGITAL_FRANCE_TERMS_TEXT, /aucun remboursement commercial automatique/);
  assert.match(DIGITAL_FRANCE_TERMS_TEXT, /Cette politique ne limite ni le droit de rétractation lorsqu’il subsiste, ni les garanties légales/);
});
