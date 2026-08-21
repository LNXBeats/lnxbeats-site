import assert from "node:assert/strict";
import test from "node:test";

import { buildRightsDocumentSections, formatRightsCurrency, humanRightsDistributor, type RightsDocumentPresentationInput } from "@/lib/rights/document-presentation";

export const safariLicensePresentationInput: RightsDocumentPresentationInput = {
  kind: "CONTRACT",
  requestType: "PUBLICATION_LICENSE",
  workTitle: "Élégie d’été",
  orderNumber: "LNX-2072-900003",
  requestedPriceCents: 15_000,
  formData: {
    project: {
      publicationName: "Élégie d’été",
      distributor: "Distributeur fictif",
      platforms: ["SPOTIFY", "APPLE_MUSIC", "DEEZER"],
      territory: "France",
      duration: "À définir avec LNX Beats",
    },
  },
  party: {
    firstName: "Camille",
    lastName: "Navigateur",
    streetAddress: "12 rue de la Musique",
    postalCode: "75001",
    city: "Paris",
    country: "FR",
  },
  grants: [{
    kind: "PUBLICATION",
    authorized: true,
    exclusive: false,
    destination: "Publication et monétisation de la création sur les plateformes expressément autorisées.",
    platforms: ["SPOTIFY", "APPLE_MUSIC", "DEEZER"],
    territory: "France",
    duration: "2 ans",
    monetization: true,
    adaptation: false,
    advertising: false,
    audiovisualSync: false,
    contentId: false,
    sublicense: false,
    credit: "LNX Beats — création musicale",
    restrictions: "Aucune utilisation publicitaire, synchronisation audiovisuelle, Content ID, adaptation ou sous-licence sans autorisation contractuelle distincte de LNX Beats.",
  }],
  contributions: [{
    kind: "STORY_BRIEF_ONLY",
    description: "Histoire fictive fournie pour orienter la création.",
    claimedPercentage: null,
  }],
  aiAssessment: "NOT_REVIEWED",
};

test("contract presentation uses the Admin RightsGrant as its contractual source of truth", () => {
  const sections = buildRightsDocumentSections(safariLicensePresentationInput);
  const rendered = sections.flatMap((section) => [section.title, ...section.paragraphs]).join("\n");

  assert.deepEqual(sections.map(({ title }) => title), [
    "1. Parties",
    "2. Œuvre concernée",
    "3. Objet de la licence",
    "4. Droits expressément accordés",
    "5. Supports / plateformes",
    "6. Territoire",
    "7. Durée",
    "8. Monétisation",
    "9. Crédit",
    "10. Restrictions",
    "11. Prix / rémunération",
    "12. Contributions déclarées",
    "13. SACEM / gestion collective",
    "14. Entrée en vigueur",
    "15. Rétractation / règles à valider",
    "16. Statut DRAFT / validation juridique",
  ]);
  assert.match(rendered, /Durée contractuelle : 2 ans\./);
  assert.doesNotMatch(rendered, /À définir avec LNX Beats/);
  assert.match(rendered, /Spotify, Apple Music, Deezer/);
  assert.match(rendered, /Histoire \/ brief uniquement/);
  assert.match(rendered, /Publication et monétisation de la création sur les plateformes expressément autorisées/);
  assert.match(rendered, /LNX Beats — création musicale/);
  assert.match(rendered, /Aucune utilisation publicitaire, synchronisation audiovisuelle, Content ID, adaptation ou sous-licence/);
  assert.match(rendered, /monétisation : oui/);
  assert.match(rendered, /adaptation : non/);
  assert.match(rendered, /publicité : non/);
  assert.match(rendered, /synchronisation audiovisuelle : non/);
  assert.match(rendered, /Content ID : non/);
  assert.match(rendered, /sous-licence : non/);
  assert.match(rendered, /Aucune répartition n’est promise\. Aucune déclaration SACEM n’est effectuée/);
  assert.match(rendered, /Prix envisagé de la licence : 150 €\./);
  assert.match(rendered, /Aucun paiement au titre de cette licence n’est ouvert à ce stade/);
  assert.match(rendered, /L’acceptation du présent projet ne suffit pas à rendre la licence active/);
  assert.match(rendered, /validation de LNX Beats/);
  assert.doesNotMatch(rendered, /acceptation QA|validation Admin|Montant cible futur/i);
  assert.doesNotMatch(rendered, /STORY_BRIEF_ONLY|SPOTIFY|APPLE_MUSIC|DEEZER/);
  assert.doesNotMatch(rendered, /\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/);
});

test("the client contract contains no internal development vocabulary", () => {
  const rendered = buildRightsDocumentSections(safariLicensePresentationInput)
    .flatMap((section) => [section.title, ...section.paragraphs])
    .join("\n");
  const forbidden = [
    "QA",
    "fixture",
    "mock",
    "seed",
    "staging",
    "test account",
    "test user",
    "browser QA",
    "technical fixture",
    "debug",
    "runtime",
    "localhost",
    "Prisma",
    "PGlite",
    "Turbopack",
    "R2",
    "RightsGrant",
    "RightsRequest",
    "ContractDocument",
    "Asset",
    "enum",
    "payload",
    "expectedVersion",
    "STORY_BRIEF_ONLY",
    "APPLE_MUSIC",
    "PUBLICATION_LICENSE",
    "CONTRACT_PREPARATION",
    "Stripe Test",
    "PaymentIntent",
    "Server Action",
  ];
  for (const term of forbidden) assert.doesNotMatch(rendered, new RegExp(`\\b${term.replaceAll(" ", "\\s+")}\\b`, "i"));
});

test("unknown technical platform codes never leak into a client document", () => {
  const sections = buildRightsDocumentSections({
    ...safariLicensePresentationInput,
    grants: [{ ...safariLicensePresentationInput.grants[0]!, platforms: ["FUTURE_TECHNICAL_PLATFORM"] }],
  });
  const rendered = sections.flatMap((section) => section.paragraphs).join("\n");
  assert.match(rendered, /Autre plateforme/);
  assert.doesNotMatch(rendered, /FUTURE_TECHNICAL_PLATFORM/);
});

test("rights currency formatting uses PDF-safe ASCII grouping for every supported amount", () => {
  assert.deepEqual([
    formatRightsCurrency(5_000),
    formatRightsCurrency(9_000),
    formatRightsCurrency(15_000),
    formatRightsCurrency(150_000),
    formatRightsCurrency(100_000),
    formatRightsCurrency(1_000_000),
    formatRightsCurrency(150_050),
  ], ["50 €", "90 €", "150 €", "1 500 €", "1 000 €", "10 000 €", "1 500,50 €"]);
  for (const amount of [5_000, 9_000, 15_000, 150_000, 100_000, 1_000_000, 150_050]) {
    assert.doesNotMatch(formatRightsCurrency(amount), /[\u00a0\u202f/]/);
  }
});

test("client-facing distributor labels humanize known services without changing unknown values", () => {
  assert.equal(humanRightsDistributor("distrokid"), "DistroKid");
  assert.equal(humanRightsDistributor("DistroKid"), "DistroKid");
  assert.equal(humanRightsDistributor("Distributeur indépendant"), "Distributeur indépendant");
});

export const partnershipPreauthorizationInput: RightsDocumentPresentationInput = {
  kind: "PREAUTHORIZATION",
  requestType: "EXPLOITATION_PARTNERSHIP",
  workTitle: "Élégie d’été",
  orderNumber: "LNX-2072-900003",
  requestedPriceCents: 150_000,
  formData: {
    project: {
      publicationName: "Élégie d’été",
      artistName: "Camille Navigateur",
      distributor: "distrokid",
      platforms: ["SPOTIFY", "APPLE_MUSIC", "DEEZER"],
      otherPlatforms: "",
      targetDate: "",
      territory: "France",
      duration: "À définir avec LNX Beats",
      monetized: true,
      advertising: false,
      contentId: false,
      clips: "",
      socialNetworks: "TikTok et Instagram",
      modifications: "Aucune modification envisagée sans accord préalable de LNX Beats.",
      credits: "LNX Beats — création musicale",
    },
    partnership: {
      lyricsAuthor: "LNX Beats",
      lyricsProvided: "J’ai fourni l’histoire, le thème et les intentions générales du projet. Je n’ai pas fourni les paroles finales.",
      lyricRewrites: "",
      toolsUsed: "Échanges avec LNX Beats pour définir le brief, le thème et les intentions du projet.",
      humanCreativeContribution: "J’ai imaginé l’histoire de départ, le sujet et les intentions générales. LNX Beats a réalisé le travail de création musicale et la mise en forme artistique finale.",
      aiKnown: false,
      sacemMember: false,
      sacemIdentifier: "",
      otherCollective: "",
      relatedWorks: "",
      desiredSplit: "Je souhaite que la répartition éventuelle soit étudiée par LNX Beats selon les contributions créatives réellement reconnues.",
    },
  },
  party: {
    firstName: "Camille",
    lastName: "Navigateur",
    streetAddress: "12 rue de la Musique",
    postalCode: "75001",
    city: "Paris",
    country: "FR",
  },
  grants: [],
  contributions: [{
    kind: "STORY_BRIEF_ONLY",
    description: "J’ai fourni l’histoire et les intentions du projet.",
    claimedPercentage: null,
  }],
  splitProposal: null,
  aiAssessment: "NOT_REVIEWED",
};

test("partnership preauthorization renders 19 factual sections without internal vocabulary or invented rights", () => {
  const sections = buildRightsDocumentSections(partnershipPreauthorizationInput);
  const rendered = sections.flatMap((section) => [section.title, ...section.paragraphs]).join("\n");
  assert.equal(sections.length, 19);
  assert.deepEqual(sections.map(({ title }) => title), [
    "1. Parties",
    "2. Création concernée",
    "3. Objet de la préautorisation",
    "4. Projet d’exploitation envisagé",
    "5. Plateformes et supports souhaités",
    "6. Territoire et durée souhaités",
    "7. Monétisation et usages envisagés",
    "8. Contributions déclarées par le client",
    "9. Éléments créatifs fournis",
    "10. Outils et processus déclarés",
    "11. Apport créatif humain déclaré",
    "12. Intelligence artificielle et outils génératifs",
    "13. SACEM et gestion collective",
    "14. Proposition de répartition non contraignante",
    "15. Prix envisagé et absence de paiement",
    "16. Limites de la préautorisation",
    "17. Entrée en vigueur",
    "18. Rétractation et commencement anticipé",
    "19. Statut DRAFT et revue juridique",
  ]);
  assert.match(rendered, /Plateformes souhaitées par le client : Spotify, Apple Music, Deezer/);
  assert.match(rendered, /Territoire souhaité par le client : France/);
  assert.match(rendered, /Durée souhaitée par le client : À définir avec LNX Beats/);
  assert.match(rendered, /Histoire \/ brief uniquement/);
  assert.match(rendered, /J’ai fourni l’histoire et les intentions du projet/);
  assert.match(rendered, /Je n’ai pas fourni les paroles finales/);
  assert.match(rendered, /Échanges avec LNX Beats pour définir le brief/);
  assert.match(rendered, /Intervention d’IA connue déclarée par le client : Non/);
  assert.match(rendered, /Adhésion SACEM déclarée par le client : Non/);
  assert.match(rendered, /Prix envisagé du partenariat : 1 500 €/);
  assert.match(rendered, /Aucun paiement au titre de ce partenariat n’est ouvert à ce stade/);
  assert.match(rendered, /Aucune répartition n’est arrêtée à ce stade/);
  assert.doesNotMatch(rendered, /70\s*\/\s*30|70 % client|30 % LNX/);
  assert.doesNotMatch(rendered, /STORY_BRIEF_ONLY|SPOTIFY|APPLE_MUSIC|DEEZER|Checkout Stripe|PaymentIntent|validation Admin/);
  assert.doesNotMatch(rendered, /1\/500/);
});

test("partnership preauthorization distinguishes Admin study parameters from client wishes", () => {
  const sections = buildRightsDocumentSections({
    ...partnershipPreauthorizationInput,
    grants: [{
      kind: "PUBLICATION",
      authorized: true,
      exclusive: false,
      destination: "Étude de publication",
      platforms: ["SPOTIFY"],
      territory: "Union européenne",
      duration: "3 ans",
      monetization: true,
      adaptation: false,
      advertising: false,
      audiovisualSync: false,
      contentId: false,
      sublicense: false,
      credit: null,
      restrictions: null,
    }],
  });
  const rendered = sections.flatMap((section) => section.paragraphs).join("\n");
  assert.match(rendered, /Plateformes retenues par LNX Beats pour la poursuite de l’étude : Spotify/);
  assert.match(rendered, /Territoire retenu par LNX Beats pour la poursuite de l’étude : Union européenne/);
  assert.match(rendered, /Durée retenue par LNX Beats pour la poursuite de l’étude : 3 ans/);
  assert.doesNotMatch(rendered, /Durée souhaitée par le client : À définir avec LNX Beats/);
});

export const partnershipContractInput: RightsDocumentPresentationInput = {
  ...partnershipPreauthorizationInput,
  kind: "CONTRACT",
  aiAssessment: "HUMAN_CONTRIBUTION_DOCUMENTED",
  grants: [{
    kind: "PUBLICATION",
    authorized: true,
    exclusive: false,
    destination: "Publication et monétisation de la création sur Spotify, Apple Music et Deezer.",
    platforms: ["Spotify", "Apple Music", "Deezer"],
    territory: "France",
    duration: "2 ans",
    monetization: true,
    adaptation: false,
    advertising: false,
    audiovisualSync: false,
    contentId: false,
    sublicense: false,
    credit: "LNX Beats — création musicale",
    restrictions: "Aucune utilisation publicitaire, synchronisation audiovisuelle, Content ID, adaptation ou sous-licence sans autorisation contractuelle distincte de LNX Beats.",
  }],
  splitProposal: {
    version: 1,
    clientSharePercent: 30,
    lnxSharePercent: 70,
    nature: "Proposition de répartition contractuelle à étudier",
    contributionRationale: "Le client a fourni l’histoire de départ, le thème et les intentions générales du projet. LNX Beats a réalisé la création musicale, la mise en forme artistique finale et les éléments de production.",
    proposedRoles: ["Apport narratif et concept initial", "création musicale", "production artistique"],
    comment: "Proposition commerciale non contraignante, soumise à validation contractuelle et juridique.",
  },
};

test("partnership contract has its own 19-section structure and uses independent persisted decisions", () => {
  const sections = buildRightsDocumentSections(partnershipContractInput);
  const rendered = sections.flatMap((section) => [section.title, ...section.paragraphs]).join("\n");
  assert.equal(sections.length, 19);
  assert.deepEqual(sections.map(({ title }) => title), [
    "1. Parties", "2. Œuvre concernée", "3. Objet du partenariat d’exploitation",
    "4. Paramètres d’exploitation envisagés", "5. Destination", "6. Plateformes / supports",
    "7. Territoire", "8. Durée", "9. Crédit", "10. Restrictions",
    "11. Contributions déclarées", "12. Apport créatif et rôles envisagés",
    "13. Proposition commerciale de répartition", "14. Nature non contraignante de la proposition",
    "15. SACEM / gestion collective", "16. Prix envisagé du partenariat", "17. Entrée en vigueur",
    "18. Rétractation / règles à valider", "19. Statut DRAFT / validation juridique",
  ]);
  assert.match(rendered, /Distributeur envisagé : DistroKid/);
  assert.match(rendered, /Publication : envisagé comme autorisé ; non exclusif ; monétisation : oui ; adaptation : non ; publicité : non ; synchronisation audiovisuelle : non ; Content ID : non ; sous-licence : non/);
  assert.match(rendered, /Spotify, Apple Music, Deezer/);
  assert.match(rendered, /Territoire contractuel envisagé : France/);
  assert.match(rendered, /Durée contractuelle envisagée : 2 ans/);
  assert.doesNotMatch(rendered, /Durée contractuelle envisagée : À définir avec LNX Beats/);
  assert.match(rendered, /Proposition commerciale version 1 : Client : 30 %\. LNX Beats : 70 %\. Total : 100 %/);
  assert.match(rendered, /Apport narratif et concept initial/);
  assert.match(rendered, /Prix envisagé du partenariat : 1 500 €/);
  assert.doesNotMatch(rendered, /Prix envisagé de la licence/);
  assert.match(rendered, /n’est pas automatiquement une clé de répartition SACEM/);
  assert.match(rendered, /ne crée aucune quote-part ni répartition SACEM/);
  assert.match(rendered, /Aucun paiement au titre de ce partenariat n’est ouvert à ce stade\. Aucun droit n’est actif/);
  assert.match(rendered, /PROJET - NON ACTIF - VALIDATION JURIDIQUE REQUISE/);
  assert.doesNotMatch(rendered, /RightsGrant|RightsRequest|ContractDocument|EXPLOITATION_PARTNERSHIP|HUMAN_CONTRIBUTION_DOCUMENTED|1\/500/);
});

test("partnership grant, commercial split, price, and client contribution remain independent", () => {
  const withoutSplit = buildRightsDocumentSections({ ...partnershipContractInput, splitProposal: null })
    .flatMap((section) => section.paragraphs).join("\n");
  assert.match(withoutSplit, /Publication : envisagé comme autorisé/);
  assert.match(withoutSplit, /Prix envisagé du partenariat : 1 500 €/);
  assert.doesNotMatch(withoutSplit, /Client : 30 %|LNX Beats : 70 %/);

  const withoutGrant = buildRightsDocumentSections({ ...partnershipContractInput, grants: [] })
    .flatMap((section) => section.paragraphs).join("\n");
  assert.match(withoutGrant, /Client : 30 %\. LNX Beats : 70 %/);
  assert.match(withoutGrant, /Histoire \/ brief uniquement/);
  assert.doesNotMatch(withoutGrant, /Publication : envisagé comme autorisé/);
});
