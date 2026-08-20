import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { generateContractPdf } from "@/lib/rights/pdf";

const output = path.resolve("output/pdf/v072-preauthorization-sample.pdf");
await mkdir(path.dirname(output), { recursive: true });

const result = await generateContractPdf({
  contractNumber: "LNX-LIC-2026-000001",
  requestNumber: "LNX-LIC-2026-000001",
  orderNumber: "LNX-2026-000001",
  title: "Projet de préautorisation - Élégie d’été",
  statusLabel: "Projet de préautorisation",
  templateVersion: 1,
  generatedAt: new Date("2026-08-20T12:00:00.000Z"),
  legalTemplateApproved: false,
  kind: "PREAUTHORIZATION",
  sections: [
    {
      title: "Parties et création",
      paragraphs: [
        "LNX Beats et Client Exemple, 1 rue de l’Été, 75000 Paris, France.",
        "Création concernée : Élégie d’été. Référence de commande LNX-2026-000001.",
      ],
    },
    {
      title: "Demande préparée",
      paragraphs: [
        "Licence de publication envisagée pour Spotify, Apple Music et Deezer, sur le territoire français, pour une durée restant à définir par LNX Beats après revue.",
        "Montant cible futur : 150 €. Aucun paiement n’est proposé ni effectué dans cette version.",
      ],
    },
    {
      title: "Limites et gestion collective",
      paragraphs: [
        "Ce document n’accorde aucun droit tant qu’il n’a pas été approuvé, accepté et, dans une version ultérieure, payé.",
        "Il ne transfère pas la qualité d’auteur, les droits moraux, la propriété de l’œuvre ou une quote-part SACEM. Aucune déclaration n’est effectuée automatiquement.",
      ],
    },
    {
      title: "Rétractation et revue juridique",
      paragraphs: [
        "Les règles de rétractation, de commencement anticipé et d’éventuelle perte du droit restent à valider juridiquement selon la qualification du service. Aucune renonciation n’est précochée.",
      ],
    },
  ],
});

await writeFile(output, result.bytes, { mode: 0o600 });
process.stdout.write(`PDF_SAMPLE_OK bytes=${result.bytes.length} pages=verify-with-poppler\n`);
