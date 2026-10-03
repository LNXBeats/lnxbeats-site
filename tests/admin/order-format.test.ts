import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

import { orderIllustrationFormatLabel, orderIllustrationFormatOptions } from "@/data/order-illustration";
import { orderIllustrationFormats, parseOrderDraftInput } from "@/lib/orders/domain";
import { getOrderProductionSummary } from "@/lib/orders/production-summary";

const execute = promisify(execFile);

test("every actual client illustration choice retains its label and custom precision for Admin", () => {
  assert.deepEqual(orderIllustrationFormatOptions.map(({ value }) => value), [...orderIllustrationFormats]);
  const expectedLabels = {
    SQUARE: "Carré — 1:1",
    VERTICAL: "Vertical — 9:16",
    LANDSCAPE: "Paysage — 16:9",
    PORTRAIT: "Portrait — 4:5",
    CUSTOM: "Autre format — Bannière 21:9",
  } as const;
  for (const format of orderIllustrationFormats) {
    const parsed = parseOrderDraftInput({
      coverIncluded: true,
      illustrationFormat: format,
      illustrationFormatCustom: format === "CUSTOM" ? "  Bannière 21:9  " : "",
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) continue;
    const production = getOrderProductionSummary(parsed.value);
    assert.equal(production.illustrationLabel, "Demandée");
    assert.equal(production.formatLabel, expectedLabels[format]);
    assert.equal(production.historicalFormatLabel, null);
    assert.ok(production.formatLabel?.startsWith(orderIllustrationFormatLabel(format)));
  }
});

test("missing, unknown and incomplete CUSTOM choices never become an invented default", () => {
  for (const format of [null, undefined, ""]) {
    assert.equal(getOrderProductionSummary({ coverIncluded: true, illustrationFormat: format }).formatLabel, "Non précisé à la commande");
  }
  for (const format of ["LEGACY_UNKNOWN", "MP3", "WAV", "CHOOSE_FOR_ME"]) {
    const result = getOrderProductionSummary({ coverIncluded: true, illustrationFormat: format, illustrationFormatCustom: "Carré" });
    assert.equal(result.formatLabel, "Non reconnu dans cette commande");
    assert.doesNotMatch(result.formatLabel!, /Autre format|Carré|MP3|WAV/);
  }
  for (const precision of [null, undefined, "", "   "]) {
    assert.equal(getOrderProductionSummary({ coverIncluded: true, illustrationFormat: "CUSTOM", illustrationFormatCustom: precision }).formatLabel, "Autre format — précision non renseignée");
  }
  const delegated = "Je laisse LNX Beats choisir le format";
  assert.equal(getOrderProductionSummary({ coverIncluded: true, illustrationFormat: "CUSTOM", illustrationFormatCustom: delegated }).formatLabel, `Autre format — ${delegated}`);
});

test("an unpurchased illustration can only expose a saved format as historical, without changing data", () => {
  for (const format of [...orderIllustrationFormats, "LEGACY_UNKNOWN"]) {
    const order = Object.freeze({ coverIncluded: false, illustrationFormat: format, illustrationFormatCustom: "Bannière 21:9" });
    const before = JSON.stringify(order);
    const production = getOrderProductionSummary(order);
    assert.equal(production.illustrationLabel, "Non demandée");
    assert.equal(production.formatLabel, null);
    assert.ok(production.historicalFormatLabel);
    assert.equal(JSON.stringify(order), before);
  }
  assert.deepEqual(getOrderProductionSummary({ coverIncluded: false, illustrationFormat: null, illustrationFormatCustom: "" }), {
    illustrationLabel: "Non demandée",
    formatLabel: null,
    historicalFormatLabel: null,
  });
});

test("list, top summary and brief share the same saved-choice presentation with no extra list relations", async () => {
  const [list, detail, component, service, css] = await Promise.all([
    readFile(new URL("../../app/admin/commandes/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/commandes/[orderNumber]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../components/admin-order-production-summary.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../lib/admin/service.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/admin.css", import.meta.url), "utf8"),
  ]);
  for (const surface of [list, detail, component]) {
    assert.match(surface, /getOrderProductionSummary\(order\)/);
    assert.match(surface, /production\.formatLabel/);
  }
  assert.match(list, /Format de l’illustration : \{production\.formatLabel\}/);
  assert.ok(detail.indexOf("<AdminOrderProductionSummary") < detail.indexOf('className="admin-order-detail__grid"'));
  assert.match(detail, /const referencePhotos = order\.assets\.filter\(\(\{ role, asset \}\) => role === "REFERENCE" && asset\.type === "IMAGE"\)/);
  assert.match(detail, /referencePhotoCount=\{referencePhotos\.length\}/);
  assert.match(detail, /referencePhotos\.map\(\(\{ asset, position \}\)/);
  assert.match(detail, /\?download=1/);
  assert.match(detail, /await requireAdmin\(\)/);
  assert.match(list, /await requireAdmin\(\)/);
  const listProjection = service.slice(service.indexOf("export async function listAdminOrders"), service.indexOf("export async function getAdminOrder"));
  for (const field of ["coverIncluded", "illustrationFormat", "illustrationFormatCustom"]) {
    assert.match(listProjection, new RegExp(`${field}: true`));
  }
  assert.doesNotMatch(listProjection, /brief:\s*true|assets:\s*\{|commercialLicenses:|auditEvents:/);
  assert.doesNotMatch(list, /getAdminOrder\(|prisma\./);
  assert.match(css, /\.admin-order-hero--production \{[^}]*min-height: 0/);
  assert.match(css, /\.admin-order-production dd \{[^}]*overflow-wrap: anywhere/);
  assert.match(css, /@media \(max-width: 680px\) \{\s*\.admin-order-hero--production/);
});

test("SSR shows exact custom text safely, stored photo counts and a non-applicable historical disclosure", async () => {
  const script = String.raw`
    import React from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import { AdminOrderProductionSummary } from "./components/admin-order-production-summary.tsx";
    const render = (order, count) => renderToStaticMarkup(React.createElement(AdminOrderProductionSummary, { order, referencePhotoCount: count }));
    const current = { coverIncluded: true, illustrationFormat: "CUSTOM", illustrationFormatCustom: "Bannière 21:9 <img src=x onerror=alert(1)>" };
    console.log(JSON.stringify({
      current: render(current, 4),
      absent: render({ coverIncluded: false, illustrationFormat: null }, 0),
      legacy: render({ coverIncluded: true, illustrationFormat: null }, 1),
      historical: render({ ...current, coverIncluded: false }, 1),
    }));
  `;
  const { stdout } = await execute(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: new URL("../..", import.meta.url),
    env: { ...process.env, NODE_OPTIONS: "" },
  });
  const rendered = JSON.parse(stdout) as Record<string, string>;
  assert.match(rendered.current, /Format de l’illustration/);
  assert.match(rendered.current, /Autre format — Bannière 21:9 &lt;img/);
  assert.match(rendered.current, /4 enregistrées/);
  assert.doesNotMatch(rendered.current, /<img|<script/);
  assert.match(rendered.absent, /Non demandée/);
  assert.match(rendered.absent, /0 enregistrées/);
  assert.doesNotMatch(rendered.absent, /Format de l’illustration|<details|MP3|WAV/);
  assert.match(rendered.legacy, /Non précisé à la commande/);
  assert.match(rendered.legacy, /1 enregistrée</);
  assert.doesNotMatch(rendered.legacy, /Autre format/);
  assert.match(rendered.historical, /<details[^>]*><summary>Ancien choix d’illustration — non applicable/);
  assert.match(rendered.historical, /ce choix historique n’est pas un livrable dû/);
  assert.doesNotMatch(rendered.historical.split("</dl>")[0], /Bannière|Format de l’illustration/);
});
