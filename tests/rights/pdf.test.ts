import assert from "node:assert/strict";
import test from "node:test";

import { contractDraftWatermark, generateContractPdf } from "@/lib/rights/pdf";

const input = {
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

test("PDF output is deterministic, private-ready, and carries the legal watermark", async () => {
  const first = await generateContractPdf(input);
  const second = await generateContractPdf(input);
  assert.equal(first.sha256, second.sha256);
  assert.deepEqual(first.bytes, second.bytes);
  assert.match(first.sha256, /^[a-f0-9]{64}$/);
  assert.ok(first.bytes.length > 2_000);
  assert.match(contractDraftWatermark, /NON ACTIF/);
});

test("PDF generation rejects control characters and malformed numbers", async () => {
  await assert.rejects(generateContractPdf({ ...input, title: "bad\u0000title" }), /invalid/);
  await assert.rejects(generateContractPdf({ ...input, templateVersion: 0 }), /invalid/);
});
