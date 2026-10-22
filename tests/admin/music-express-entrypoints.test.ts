import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { adminMusicEditorHref, shouldUseExpressCatalogCreation } from "@/lib/catalog/admin-music-entry";

test("ordinary singles and albums open the same project in Express without title matching", () => {
  for (const type of ["ALBUM", "SINGLE"]) {
    assert.equal(adminMusicEditorHref({ id: "existing-id", slug: "existing-slug", type }), "/admin/musique/express?projet=existing-id");
  }
  assert.equal(adminMusicEditorHref({ id: "id", slug: "particular-project", type: "PROJECT" }), "/admin/catalogue/particular-project");
});

test("ordinary creation defaults to Express while advanced creation and errors remain available", () => {
  assert.equal(shouldUseExpressCatalogCreation({}), true);
  assert.equal(shouldUseExpressCatalogCreation({ avance: "0" }), true);
  assert.equal(shouldUseExpressCatalogCreation({ avance: "1" }), false);
  assert.equal(shouldUseExpressCatalogCreation({ etat: "slug-occupe" }), false);
  assert.equal(shouldUseExpressCatalogCreation({ etat: "creation-refusee" }), false);
});

test("entrypoints preserve authorization, existing IDs and the advanced history routes", async () => {
  const [create, catalogue, edit, digital] = await Promise.all([
    readFile(new URL("../../app/admin/catalogue/nouveau/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/catalogue/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/catalogue/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/musique/[slug]/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.ok(create.indexOf("await requireAdmin()") < create.indexOf('redirect("/admin/musique/express")'));
  assert.match(create, /<CatalogCreateForm \/>/);
  assert.match(catalogue, /adminMusicEditorHref\(project\)/);
  assert.match(catalogue, /\/admin\/catalogue\/nouveau\?avance=1/);
  assert.match(catalogue, /Avancé \/ historique/);
  assert.match(edit, /\/admin\/musique\/express\?projet=\$\{project\.id\}/);
  assert.match(digital, /\/admin\/musique\/express\?projet=\$\{p\.id\}#audio/);
  assert.match(digital, /<DigitalBatchUpload tracks=\{tracks\} \/>/);
});
