import assert from "node:assert/strict";
import test from "node:test";

import {
  publicationLicenseDraftTemplate,
  renderContractTemplate,
  validateContractTemplate,
} from "@/lib/rights/templates";

const values = {
  contractNumber: "LNX-LIC-2026-000001",
  generatedDate: "20 août 2026",
  orderNumber: "LNX-2026-000001",
  requestNumber: "LNX-LIC-2026-000001",
  workTitle: "Une œuvre <script>alert(1)</script>",
  clientName: "Client Exemple",
  clientAddress: "1 rue Exemple, 75000 Paris",
  artistName: "Artiste",
  lnxIdentity: "LNX Beats",
  platforms: "Spotify",
  territory: "France",
  duration: "À définir",
  price: "150 €",
  rightsMatrix: "Publication : envisagée",
  proposedSplit: "Aucune proposition",
} as const;

test("contract templates accept only allowlisted inert placeholders", () => {
  assert.deepEqual(validateContractTemplate(publicationLicenseDraftTemplate), { ok: true });
  assert.equal(validateContractTemplate("{{processEnv}}").ok, false);
  assert.equal(validateContractTemplate("${process.env.SECRET}").ok, false);
  assert.equal(validateContractTemplate("<script>alert(1)</script>").ok, false);
});

test("client content is escaped before deterministic rendering", () => {
  const rendered = renderContractTemplate(publicationLicenseDraftTemplate, values);
  assert.match(rendered, /Une œuvre &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(rendered, /<script>/);
  assert.doesNotMatch(rendered, /\{\{/);
});
