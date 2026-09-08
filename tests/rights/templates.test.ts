import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("publication template carries the locked 150 euro contract decisions", () => {
  const rendered = renderContractTemplate(publicationLicenseDraftTemplate, values);
  for (const term of ["non exclusive", "monde entier", "cinq ans", "150,00 EUR", "distributeur numérique", "transférer ni revendre", "adaptation substantielle", "Content ID exclusif", "paiement confirmé", "reproduction", "communication au public", "délai légal de rétractation", "Aucun commencement anticipé", "reste sans effet pendant toute la période", "mise en demeure", "droit français", "CM2C", "VALIDATION JURIDIQUE RÉFÉRENCÉE REQUISE"]) {
    assert.match(rendered, new RegExp(term, "i"));
  }
  assert.doesNotMatch(rendered, /1[ .]?500|partenariat d’exploitation|tarif SACEM/i);
});

test("the additive v2 migration seeds a draft without approving or rewriting history", async () => {
  const migration = await readFile("prisma/migrations/20260909120000_publication_license_template_v2/migration.sql", "utf8");
  assert.match(migration, /'PUBLICATION_LICENSE',[\s\S]*?\n\s*2,[\s\S]*?'DRAFT'/);
  assert.match(migration, /WHERE NOT EXISTS/);
  assert.doesNotMatch(migration, /\b(?:UPDATE|DELETE|APPROVED)\b/i);
  assert.doesNotMatch(migration, /1[ .]?500|EXPLOITATION_PARTNERSHIP/i);
});
