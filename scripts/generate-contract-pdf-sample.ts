import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildRightsDocumentSections } from "@/lib/rights/document-presentation";
import { generateContractPdf } from "@/lib/rights/pdf";

const output = path.resolve(process.env.LNX_CONTRACT_PDF_SAMPLE_PATH || "/private/tmp/lnx-v072-partnership-c02-render.pdf");
await mkdir(path.dirname(output), { recursive: true });

const result = await generateContractPdf({
  contractNumber: "LNX-PART-2026-999999-C02",
  requestNumber: "LNX-PART-2026-999999",
  orderNumber: "LNX-2072-999999",
  title: "Conditions particulières - Élégie d’été",
  statusLabel: "Projet de contrat - non actif",
  templateVersion: 1,
  generatedAt: new Date("2026-08-20T12:00:00.000Z"),
  legalTemplateApproved: false,
  kind: "CONTRACT",
  sections: buildRightsDocumentSections({
    kind: "CONTRACT",
    requestType: "EXPLOITATION_PARTNERSHIP",
    workTitle: "Élégie d’été",
    orderNumber: "LNX-2072-999999",
    requestedPriceCents: 150_000,
    formData: {
      project: { publicationName: "Élégie d’été", distributor: "distrokid", platforms: ["SPOTIFY", "APPLE_MUSIC", "DEEZER"], territory: "France", duration: "À définir avec LNX Beats" },
      partnership: { humanCreativeContribution: "Le client a imaginé l’histoire de départ, le thème et les intentions générales." },
    },
    party: { firstName: "Camille", lastName: "Navigateur", streetAddress: "12 rue de la Musique", postalCode: "75001", city: "Paris", country: "FR" },
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
    contributions: [{ kind: "STORY_BRIEF_ONLY", description: "Le client a fourni l’histoire de départ, le thème et les intentions générales.", claimedPercentage: null }],
    splitProposal: {
      version: 1,
      clientSharePercent: 30,
      lnxSharePercent: 70,
      nature: "Proposition de répartition contractuelle à étudier",
      contributionRationale: "Le client a fourni le concept initial. LNX Beats a réalisé la création musicale, la mise en forme artistique finale et la production artistique.",
      proposedRoles: ["Apport narratif et concept initial", "création musicale", "production artistique"],
      comment: "Proposition commerciale non contraignante, soumise à validation contractuelle et juridique.",
    },
    aiAssessment: "HUMAN_CONTRIBUTION_DOCUMENTED",
  }),
});

await writeFile(output, result.bytes, { mode: 0o600 });
process.stdout.write(`PDF_SAMPLE_OK bytes=${result.bytes.length} pages=${result.pageCount}\n`);
