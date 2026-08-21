import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  adminClientRightsWishes,
  adminRightsNotice,
  adminRightsAuditTimestamp,
  adminRightsDocumentVersionLabel,
  adminRightsLatestDocumentLabel,
  adminRightsGrantPrefill,
  adminRightsProjectSummary,
  adminRightsRequestedFieldLabels,
  formatAdminRightsValue,
  formatAdminRightsDateTime,
  rightsDocumentActionLabel,
} from "@/lib/rights/admin-presentation";

const formData = {
  project: {
    workTitle: "Élégie d’été",
    publicationName: "Élégie d’été",
    artistName: "Camille Navigateur",
    distributor: "distrokid",
    platforms: ["SPOTIFY", "APPLE_MUSIC", "DEEZER"],
    otherPlatforms: "",
    monetized: true,
    territory: "France",
    duration: "À définir avec LNX Beats",
    clips: "Clip promotionnel éventuel sur YouTube",
    socialNetworks: "TikTok · Instagram",
    advertising: false,
    contentId: false,
    modifications: "Aucune modification prévue",
    credits: "LNX Beats — création musicale",
  },
};

test("admin rights presentation turns the stored form into human-readable facts", () => {
  const rows = Object.fromEntries(adminRightsProjectSummary(formData, "Titre de secours").map((row) => [row.label, row.value]));
  assert.equal(rows.Titre, "Élégie d’été");
  assert.equal(rows.Plateformes, "Spotify · Apple Music · Deezer");
  assert.equal(rows.Monétisation, "Oui");
  assert.equal(rows["Publicité / sponsoring"], "Non");
  assert.equal(rows["Content ID"], "Non");
  assert.equal(rows.Distributeur, "DistroKid");
  assert.equal(formatAdminRightsValue(undefined), "Non renseigné");
  assert.equal(formatAdminRightsValue(""), "Non renseigné");
});

test("client wishes prefill only working fields and never grant a right", () => {
  assert.deepEqual(adminClientRightsWishes(formData), {
    platforms: ["Spotify", "Apple Music", "Deezer"],
    platformsInput: "Spotify, Apple Music, Deezer",
    territory: "France",
    duration: "À définir avec LNX Beats",
    monetization: true,
  });
  assert.deepEqual(adminRightsGrantPrefill(formData), {
    platforms: "Spotify, Apple Music, Deezer",
    territory: "France",
    duration: "À définir avec LNX Beats",
    authorized: false,
    exclusive: false,
    monetization: true,
    adaptation: false,
    advertising: false,
    audiovisualSync: false,
    contentId: false,
    sublicense: false,
  });
});

test("document CTA is contextual", () => {
  assert.equal(rightsDocumentActionLabel(0), "PRÉPARER LE PROJET DE CONTRAT");
  assert.equal(rightsDocumentActionLabel(1), "GÉNÉRER UNE NOUVELLE VERSION");
  assert.equal(rightsDocumentActionLabel(4), "GÉNÉRER UNE NOUVELLE VERSION");
});

test("generation feedback is accented, understandable, and never exposes technical detail", () => {
  assert.equal(adminRightsNotice("generation-refusee"), "Génération refusée. Aucun document n’a été créé.");
  assert.match(adminRightsNotice("generation-page-obsolete"), /Rechargez/);
  assert.match(adminRightsNotice("projet-draft-genere"), /DRAFT.*filigrané.*non actif.*non payable.*non acceptable/);
  assert.doesNotMatch(adminRightsNotice("generation-indisponible"), /SQL|stack|R2|storageKey|secret/i);
});

test("dates, requested fields, and immutable document versions have explicit human separators", () => {
  const timestamp = adminRightsAuditTimestamp(new Date("2026-08-20T18:26:45.000Z"));
  assert.deepEqual(timestamp, {
    iso: "2026-08-20T18:26:45.000Z",
    date: "20/08/2026",
    time: "20:26:45",
    display: "20/08/2026 · 20:26:45",
  });
  assert.equal(formatAdminRightsDateTime(new Date("2026-08-20T18:26:45.000Z")), "20/08/2026 · 20:26:45");
  assert.equal(formatAdminRightsDateTime(null), "—");
  assert.deepEqual(adminRightsRequestedFieldLabels(["duration", "credits", "duration", "unknown"]), ["Durée", "Crédits"]);
  assert.equal(adminRightsDocumentVersionLabel("LNX-LIC-2026-000001-C03", 3), "Version 3 — C03");
  assert.equal(adminRightsLatestDocumentLabel("PREAUTHORIZATION"), "Dernière préautorisation");
  assert.equal(adminRightsLatestDocumentLabel("CONTRACT"), "Dernier projet de contrat");
});

test("admin detail contains no raw JSON and uses a responsive non-absolute audit layout", async () => {
  const [page, styles, form] = await Promise.all([
    readFile("app/admin/droits/[requestNumber]/page.tsx", "utf8"),
    readFile("app/admin/admin.css", "utf8"),
    readFile("components/admin-rights-grant-form.tsx", "utf8"),
  ]);
  assert.doesNotMatch(page, /admin-json|JSON\.stringify|<pre/);
  assert.match(page, /adminRightsProjectSummary/);
  assert.match(page, /className="admin-rights-timeline"/);
  assert.match(page, /admin-rights-timeline__when/);
  assert.match(page, /rightsDocumentActionLabel/);
  assert.match(page, /canStartRightsReview\(request\.status\) \?/);
  assert.match(page, /timestamp\.display/);
  assert.match(page, /Champs demandés :/);
  assert.match(page, /isAdminRequest \? "Demande :" : "Réponse :"/);
  assert.match(page, /AdminPrivateDocumentHeading/);
  assert.doesNotMatch(page, /Version la plus récente/);
  assert.match(page, /Empreinte/);
  assert.match(page, /expectedDocumentVersion/);
  assert.match(page, /Le PDF restera DRAFT, filigrané, non actif, non payable et non acceptable/);
  assert.match(form, /REPRENDRE LES SOUHAITS DU CLIENT/);
  assert.match(form, /Préremplissage de travail uniquement/);

  const timelineStyles = styles.slice(styles.indexOf(".admin-rights-timeline {"), styles.indexOf(".admin-timeline {", styles.indexOf(".admin-rights-timeline {")));
  assert.match(timelineStyles, /grid-template-columns/);
  assert.match(timelineStyles, /overflow-wrap: anywhere/);
  assert.doesNotMatch(timelineStyles, /position:\s*absolute/);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*\.admin-rights-timeline li \{ grid-template-columns: 1fr/);
  assert.match(styles, /\.admin-message-list__meta \{[^}]*justify-content: flex-start/);
  assert.match(styles, /\.admin-message-list__fields/);
  assert.match(styles, /\.admin-private-document--latest/);
  assert.match(styles, /\.admin-private-document__heading \{[^}]*display: grid[^}]*gap:/);
  assert.match(styles, /\.admin-private-document__badge/);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*\.admin-private-document__heading \{ grid-template-columns: minmax\(0, 1fr\)/);

  const tenEvents = Array.from({ length: 10 }, (_, index) => adminRightsAuditTimestamp(new Date(Date.UTC(2026, 7, 20, 12, 0, index))));
  assert.equal(tenEvents.length, 10);
  assert.equal(new Set(tenEvents.map((event) => event.iso)).size, 10);
  assert.ok(tenEvents.every((event) => event.date && event.time && event.display.includes(" · ")));
});
