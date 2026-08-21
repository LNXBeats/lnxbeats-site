import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import test from "node:test";

import { buildRightsDocumentSections } from "@/lib/rights/document-presentation";
import { contractDraftWatermark, generateContractPdf } from "@/lib/rights/pdf";

const simpleInput = {
  contractNumber: "LNX-LIC-2026-000001",
  requestNumber: "LNX-LIC-2026-000001",
  orderNumber: "LNX-2026-000001",
  title: "Projet de préautorisation - Élégie d’été",
  statusLabel: "Projet de préautorisation",
  templateVersion: 1,
  generatedAt: new Date("2026-08-20T12:00:00.000Z"),
  legalTemplateApproved: false,
  kind: "PREAUTHORIZATION" as const,
  sections: [
    { title: "Parties", paragraphs: ["LNX Beats et Client Exemple, 1 rue de l’Été, 75000 Paris."] },
    { title: "Objet", paragraphs: ["Demande de publication sur Spotify, Apple Music et Deezer. Aucun droit n’est accordé par ce projet."] },
    { title: "Limites", paragraphs: ["Aucun transfert de la qualité d’auteur, aucun calcul automatique SACEM et aucun paiement à cette étape."] },
  ],
};

function safariContractSections() {
  return buildRightsDocumentSections({
    kind: "CONTRACT",
    requestType: "PUBLICATION_LICENSE",
    workTitle: "Élégie d’été",
    orderNumber: "LNX-2072-900003",
    requestedPriceCents: 15_000,
    formData: { project: { publicationName: "Élégie d’été", distributor: "Distributeur fictif", platforms: ["SPOTIFY", "APPLE_MUSIC", "DEEZER"], territory: "France", duration: "À définir avec LNX Beats" } },
    party: { firstName: "Camille", lastName: "Navigateur", streetAddress: "12 rue de la Musique", postalCode: "75001", city: "Paris", country: "FR" },
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
    contributions: [{ kind: "STORY_BRIEF_ONLY", description: "Histoire fictive fournie pour orienter la création.", claimedPercentage: null }],
    aiAssessment: "NOT_REVIEWED",
  });
}

function partnershipPreauthorizationSections() {
  return buildRightsDocumentSections({
    kind: "PREAUTHORIZATION",
    requestType: "EXPLOITATION_PARTNERSHIP",
    workTitle: "Élégie d’été",
    orderNumber: "LNX-2072-900003",
    requestedPriceCents: 150_000,
    formData: {
      project: { publicationName: "Élégie d’été", artistName: "Camille Navigateur", distributor: "distrokid", platforms: ["SPOTIFY", "APPLE_MUSIC", "DEEZER"], territory: "France", duration: "À définir avec LNX Beats", monetized: true, advertising: false, contentId: false, socialNetworks: "TikTok et Instagram", modifications: "Aucune modification envisagée sans accord préalable de LNX Beats.", credits: "LNX Beats — création musicale" },
      partnership: { lyricsAuthor: "LNX Beats", lyricsProvided: "J’ai fourni l’histoire et les intentions générales, mais pas les paroles finales.", toolsUsed: "Échanges avec LNX Beats pour définir le brief.", humanCreativeContribution: "J’ai imaginé l’histoire de départ et les intentions générales.", aiKnown: false, sacemMember: false, desiredSplit: "Répartition à étudier selon les contributions reconnues." },
    },
    party: { firstName: "Camille", lastName: "Navigateur", streetAddress: "12 rue de la Musique", postalCode: "75001", city: "Paris", country: "FR" },
    grants: [],
    contributions: [{ kind: "STORY_BRIEF_ONLY", description: "J’ai fourni l’histoire et les intentions du projet.", claimedPercentage: null }],
    splitProposal: null,
    aiAssessment: "NOT_REVIEWED",
  });
}

function partnershipContractSections() {
  return buildRightsDocumentSections({
    kind: "CONTRACT",
    requestType: "EXPLOITATION_PARTNERSHIP",
    workTitle: "Élégie d’été",
    orderNumber: "LNX-2072-999999",
    requestedPriceCents: 150_000,
    formData: {
      project: { publicationName: "Élégie d’été", artistName: "Camille Navigateur", distributor: "distrokid", platforms: ["SPOTIFY", "APPLE_MUSIC", "DEEZER"], territory: "France", duration: "À définir avec LNX Beats", monetized: true },
      partnership: { humanCreativeContribution: "Le client a imaginé l’histoire de départ, le thème et les intentions générales." },
    },
    party: { firstName: "Camille", lastName: "Navigateur", streetAddress: "12 rue de la Musique", postalCode: "75001", city: "Paris", country: "FR" },
    grants: [{
      kind: "PUBLICATION", authorized: true, exclusive: false,
      destination: "Publication et monétisation de la création sur Spotify, Apple Music et Deezer.",
      platforms: ["Spotify", "Apple Music", "Deezer"], territory: "France", duration: "2 ans",
      monetization: true, adaptation: false, advertising: false, audiovisualSync: false, contentId: false, sublicense: false,
      credit: "LNX Beats — création musicale",
      restrictions: "Aucune utilisation publicitaire, synchronisation audiovisuelle, Content ID, adaptation ou sous-licence sans autorisation contractuelle distincte de LNX Beats.",
    }],
    contributions: [{ kind: "STORY_BRIEF_ONLY", description: "Le client a fourni l’histoire de départ, le thème et les intentions générales.", claimedPercentage: null }],
    splitProposal: {
      version: 1, clientSharePercent: 30, lnxSharePercent: 70,
      nature: "Proposition de répartition contractuelle à étudier",
      contributionRationale: "Le client a fourni le concept initial. LNX Beats a réalisé la création musicale, la mise en forme artistique finale et la production artistique.",
      proposedRoles: ["Apport narratif et concept initial", "création musicale", "production artistique"],
      comment: "Proposition commerciale non contraignante, soumise à validation contractuelle et juridique.",
    },
    aiAssessment: "HUMAN_CONTRIBUTION_DOCUMENTED",
  });
}

function decodedPdfPageText(bytes: Buffer): string[] {
  const source = bytes.toString("latin1");
  const objects = new Map<number, string>();
  for (const match of source.matchAll(/(\d+)\s+0\s+obj\b([\s\S]*?)endobj/g)) {
    objects.set(Number(match[1]), match[2]!);
  }
  const pageObjects = [...objects.entries()]
    .filter(([, body]) => /\/Type\s*\/Page(?!s)\b/.test(body))
    .sort(([left], [right]) => left - right);
  const decoder = new TextDecoder("windows-1252");
  return pageObjects.map(([, page]) => {
    const contents = page.match(/\/Contents\s+(\d+)\s+0\s+R/);
    assert.ok(contents, "A PDF page must reference its content stream.");
    const object = objects.get(Number(contents[1]));
    assert.ok(object, "The referenced PDF content stream must exist.");
    const stream = object.match(/stream\r?\n([\s\S]*?)\r?\nendstream/);
    assert.ok(stream, "The PDF page content stream must be readable.");
    const compressed = Buffer.from(stream[1]!, "latin1");
    const content = /\/FlateDecode/.test(object) ? inflateSync(compressed).toString("latin1") : compressed.toString("latin1");
    const lines: string[] = [];
    for (const textArray of content.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
      const parts = [...textArray[1]!.matchAll(/<([0-9A-Fa-f]+)>/g)].map((part) => decoder.decode(Buffer.from(part[1]!, "hex")));
      if (parts.length) lines.push(parts.join(""));
    }
    for (const textValue of content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      lines.push(decoder.decode(Buffer.from(textValue[1]!, "hex")));
    }
    return lines.join("\n");
  });
}

test("PDF output is deterministic, private-ready, and carries the legal watermark", async () => {
  const first = await generateContractPdf(simpleInput);
  const second = await generateContractPdf(simpleInput);
  assert.equal(first.sha256, second.sha256);
  assert.deepEqual(first.bytes, second.bytes);
  assert.match(first.sha256, /^[a-f0-9]{64}$/);
  assert.ok(first.bytes.length > 2_000);
  assert.equal(first.pageCount, 1);
  assert.match(contractDraftWatermark, /NON ACTIF/);
});

test("the Safari C03 licence PDF uses final grants, client vocabulary, and balanced pages", async () => {
  const result = await generateContractPdf({
    ...simpleInput,
    contractNumber: "LNX-LIC-2026-000001-C03",
    requestNumber: "LNX-LIC-2026-000001",
    orderNumber: "LNX-2072-900003",
    title: "Conditions particulières - Élégie d’été",
    statusLabel: "Projet de contrat - non actif",
    kind: "CONTRACT",
    sections: safariContractSections(),
  });
  const pages = decodedPdfPageText(result.bytes);
  const rendered = pages.join("\n");
  const source = result.bytes.toString("latin1");

  assert.equal(result.pageCount, pages.length);
  assert.equal(result.pageCount, 2);
  assert.match(rendered, /Durée contractuelle : 2 ans\./);
  assert.doesNotMatch(rendered, /À définir avec LNX Beats/);
  assert.match(rendered, /Spotify, Apple Music, Deezer/);
  assert.doesNotMatch(rendered, /SPOTIFY|APPLE_MUSIC|DEEZER/);
  assert.match(rendered, /Histoire \/ brief uniquement/);
  assert.doesNotMatch(rendered, /STORY_BRIEF_ONLY/);
  assert.match(rendered, /Élégie d’été/);
  assert.match(rendered, /LNX Beats — création musicale/);
  assert.match(rendered, /PROJET - NON ACTIF - VALIDATION JURIDIQUE REQUISE/);
  assert.match(rendered, /Aucune répartition n’est promise/);
  assert.match(rendered, /Aucune déclaration SACEM n’est effectuée/);
  assert.match(rendered, /Prix envisagé de la licence : 150 €\./);
  assert.doesNotMatch(rendered, /Montant cible futur/);
  assert.match(rendered, /L’acceptation du présent projet ne suffit pas à rendre la licence active/);
  assert.doesNotMatch(rendered, /acceptation QA|validation Admin/i);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  const forbidden = [
    "QA", "fixture", "mock", "seed", "staging", "test account", "test user", "browser QA", "technical fixture", "debug",
    "runtime", "localhost", "Prisma", "PGlite", "Turbopack", "R2", "RightsGrant", "RightsRequest", "ContractDocument",
    "Asset", "enum", "payload", "expectedVersion", "STORY_BRIEF_ONLY", "APPLE_MUSIC", "PUBLICATION_LICENSE",
    "CONTRACT_PREPARATION", "Stripe Test", "PaymentIntent", "Server Action",
  ];
  for (const term of forbidden) assert.doesNotMatch(rendered, new RegExp(`\\b${term.replaceAll(" ", "\\s+")}\\b`, "i"));
  for (const [index, page] of pages.entries()) {
    assert.match(page, /LNX STUDIO/);
    assert.match(page, new RegExp(`Page ${index + 1} / ${pages.length}`));
    assert.match(page, /Document privé - [A-F0-9]{12}/);
    const body = page.replace(/LNX STUDIO|LNX-LIC-2026-000001-C03|Page \d+ \/ \d+|Document privé - [A-F0-9]{12}/g, "").trim();
    assert.ok(body.length >= 500, `Page ${index + 1} must contain a substantial document body.`);
  }
  assert.equal((source.match(/\/MediaBox \[0 0 595\.28 841\.89\]/g) ?? []).length, 2);
  assert.doesNotMatch(source, /\/JavaScript\b|\/JS\b|\/URI\b|https?:\/\//i);
});

test("the partnership P02 PDF keeps 1 500 euros readable and contains the factual dossier", async () => {
  const result = await generateContractPdf({
    ...simpleInput,
    contractNumber: "LNX-PART-2026-000020-P02",
    requestNumber: "LNX-PART-2026-000020",
    orderNumber: "LNX-2072-900003",
    title: "Projet de préautorisation - Élégie d’été",
    kind: "PREAUTHORIZATION",
    sections: partnershipPreauthorizationSections(),
  });
  const pages = decodedPdfPageText(result.bytes);
  const rendered = pages.join("\n");
  assert.equal(result.pageCount, pages.length);
  assert.ok(result.pageCount >= 2 && result.pageCount <= 6);
  for (const page of pages) assert.match(page, /LNX STUDIO/);
  assert.match(rendered, /Prix envisagé du partenariat : 1 500 €/);
  assert.doesNotMatch(rendered, /1\s*\/\s*500/);
  assert.match(rendered, /Spotify, Apple Music, Deezer/);
  assert.match(rendered, /Histoire \/ brief uniquement/);
  assert.match(rendered, /Apport créatif humain déclaré/);
  assert.match(rendered, /Intervention d’IA connue déclarée par le client : Non/);
  assert.match(rendered, /Aucune répartition n’est arrêtée à ce stade/);
  assert.match(rendered, /PROJET - NON ACTIF - VALIDATION JURIDIQUE REQUISE/);
  assert.doesNotMatch(rendered, /STORY_BRIEF_ONLY|SPOTIFY|APPLE_MUSIC|DEEZER|70 % client|30 % LNX|Checkout Stripe|PaymentIntent|validation Admin/);
});

test("the partnership C02 PDF is a readable private draft with commercial split and no internal leak", async () => {
  const result = await generateContractPdf({
    ...simpleInput,
    contractNumber: "LNX-PART-2026-999999-C02",
    requestNumber: "LNX-PART-2026-999999",
    orderNumber: "LNX-2072-999999",
    title: "Conditions particulières - Élégie d’été",
    statusLabel: "Projet de contrat - non actif",
    kind: "CONTRACT",
    sections: partnershipContractSections(),
  });
  const pages = decodedPdfPageText(result.bytes);
  const rendered = pages.join("\n");
  const source = result.bytes.toString("latin1");
  assert.equal(result.pageCount, pages.length);
  assert.ok(result.pageCount >= 2 && result.pageCount <= 6);
  for (const [index, page] of pages.entries()) {
    assert.match(page, /LNX STUDIO/);
    assert.match(page, new RegExp(`Page ${index + 1} / ${pages.length}`));
    assert.match(page, /Document privé - [A-F0-9]{12}/);
  }
  for (const expected of [
    "Partenariat d’exploitation", "1 500 €", "Spotify", "Apple Music", "Deezer", "DistroKid",
    "France", "2 ans", "LNX Beats — création musicale", "30 %", "70 %", "PROJET", "NON ACTIF",
    "VALIDATION JURIDIQUE REQUISE", "SACEM", "proposition commerciale",
  ]) assert.match(rendered, new RegExp(expected, "i"));
  assert.doesNotMatch(rendered, /Prix envisagé de la licence|1\s*\/\s*500/);
  assert.doesNotMatch(rendered, /QA|runtime|fixture|Prisma|Turbopack|PaymentIntent|RightsRequest|RightsGrant|ContractDocument|PostgreSQL|serverExternalPackages|storageKey|R2 key|Server Action/i);
  assert.doesNotMatch(source, /\/JavaScript\b|\/JS\b|\/URI\b|https?:\/\//i);
});

test("PDF generation rejects control characters and malformed numbers", async () => {
  await assert.rejects(generateContractPdf({ ...simpleInput, title: "bad\u0000title" }), /invalid/);
  await assert.rejects(generateContractPdf({ ...simpleInput, templateVersion: 0 }), /invalid/);
});
