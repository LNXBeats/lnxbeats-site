import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { canAccessAdmin } from "@/lib/auth/roles";

test("catalogue lifecycle mutations remain server-authorized for ADMIN only", async () => {
  assert.equal(canAccessAdmin(undefined), false);
  assert.equal(canAccessAdmin("MEMBER"), false);
  assert.equal(canAccessAdmin("ADMIN"), true);

  const actions = await readFile(new URL("../../app/admin/catalogue/actions.ts", import.meta.url), "utf8");
  for (const action of ["createCatalogProjectAction", "hideCatalogProjectAction", "archiveCatalogProjectAction", "deleteCatalogProjectAction"]) {
    const body = actions.match(new RegExp(`export async function ${action}\\([^]*?\\n\\}`, "m"))?.[0] ?? "";
    assert.match(body, /await authorize\(\)/, `${action} must enforce origin and requireAdmin server-side.`);
  }
  assert.match(actions, /isSameOriginMutation/);
  assert.match(actions, /return requireAdmin\(\)/);
});

test("the Admin exposes one creation route and keeps destructive actions on the project page", async () => {
  const [list, create, edit, modal] = await Promise.all([
    readFile(new URL("../../app/admin/catalogue/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/catalogue/nouveau/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/catalogue/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../components/catalog-project-danger-zone.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(list, /href="\/admin\/catalogue\/nouveau"/);
  assert.doesNotMatch(list, /Supprimer définitivement/);
  assert.match(create, /requireAdmin\(\)/);
  assert.match(edit, /CatalogProjectDangerZone/);
  assert.match(modal, /<dialog/);
  assert.match(modal, /confirmation !== project\.slug/);
  assert.match(modal, /Conserver le projet/);
});
