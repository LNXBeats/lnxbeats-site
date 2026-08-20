import assert from "node:assert/strict";
import test from "node:test";

import { parseRightsDraftInput } from "@/lib/rights/input";

const valid = {
  type: "PUBLICATION_LICENSE",
  party: {
    partyType: "INDIVIDUAL",
    firstName: "Alice",
    lastName: "Exemple",
    artistName: "Alice E.",
    companyName: "",
    legalForm: "",
    legalRepresentative: "",
    streetAddress: "1 rue Exemple",
    postalCode: "75000",
    city: "Paris",
    country: "FR",
    siret: "",
    vatNumber: "",
    contractEmail: "alice@example.invalid",
    phone: "",
  },
  project: {
    workTitle: "Titre",
    publicationName: "Titre public",
    artistName: "Alice E.",
    distributor: "Distributeur",
    platforms: ["SPOTIFY", "DEEZER"],
    otherPlatforms: "",
    targetDate: "2027-01-20",
    monetized: true,
    territory: "France",
    duration: "2 ans",
    clips: "Aucun",
    socialNetworks: "Instagram",
    advertising: false,
    contentId: false,
    modifications: "Aucune",
    credits: "LNX Beats",
  },
  contributions: [{ kind: "STORY_BRIEF_ONLY", description: "J’ai fourni l’histoire.", claimedPercentage: null, evidenceNote: "" }],
  partnership: null,
};

test("rights input is strict and browser prices never enter the model", () => {
  const parsed = parseRightsDraftInput(valid);
  assert.equal(parsed.type, "PUBLICATION_LICENSE");
  assert.equal(parsed.project.platforms.length, 2);
  assert.throws(() => parseRightsDraftInput({ ...valid, priceCents: 1 }), /inattendu/);
  assert.throws(() => parseRightsDraftInput({ ...valid, type: "EXPLOITATION_PARTNERSHIP" }), /invalide/);
});

test("client markup remains inert text and identity fields are normalized", () => {
  const parsed = parseRightsDraftInput({
    ...valid,
    party: { ...valid.party, firstName: "  Alice  ", city: "<img src=x onerror=alert(1)>" },
  });
  assert.equal(parsed.party.firstName, "Alice");
  assert.equal(parsed.party.city, "<img src=x onerror=alert(1)>");
});

test("other platforms and percentages are bounded", () => {
  assert.throws(() => parseRightsDraftInput({ ...valid, project: { ...valid.project, platforms: ["OTHER"], otherPlatforms: "" } }), /invalide/);
  assert.throws(() => parseRightsDraftInput({ ...valid, contributions: [{ ...valid.contributions[0], claimedPercentage: 101 }] }), /pourcentage/);
});
