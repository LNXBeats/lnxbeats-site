import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const backLinks = new Map([
  ["app/admin/commandes/page.tsx", "/admin"],
  ["app/admin/commandes/[orderNumber]/page.tsx", "/admin/commandes"],
  ["app/admin/catalogue/page.tsx", "/admin"],
  ["app/admin/catalogue/nouveau/page.tsx", "/admin/catalogue"],
  ["app/admin/catalogue/[slug]/page.tsx", "/admin/catalogue"],
  ["app/admin/droits/page.tsx", "/admin"],
  ["app/admin/droits/[requestNumber]/page.tsx", "/admin/droits"],
  ["app/admin/membres/page.tsx", "/admin"],
  ["app/admin/notifications/page.tsx", "/admin"],
]);

test("every Admin subpage has one deterministic parent link while the root has none", () => {
  const component = readFileSync("components/admin-back-link.tsx", "utf8");
  assert.match(component, /href: "\/admin" \| `\/admin\/\$\{string\}`/);
  assert.match(component, /<Link className="admin-back-link" href=\{href\}>/);
  assert.doesNotMatch(component, /router\.back|history\.back/);

  for (const [path, href] of backLinks) {
    const page = readFileSync(path, "utf8");
    assert.match(page, new RegExp(`<AdminBackLink href="${href.replaceAll("/", "\\/")}">`), path);
    assert.equal(page.match(/<AdminBackLink\b/g)?.length, 1, path);
    assert.doesNotMatch(page, /router\.back|history\.back/, path);
  }

  assert.doesNotMatch(readFileSync("app/admin/page.tsx", "utf8"), /AdminBackLink/);
});

test("Admin mobile navigation is keyboard-safe and horizontally compact", () => {
  const navigation = readFileSync("components/admin-navigation.tsx", "utf8");
  const css = readFileSync("app/admin/admin.css", "utf8");

  assert.match(navigation, /className="admin-header__nav"/);
  assert.match(navigation, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(css, /\.admin-back-link \{[\s\S]*?min-height: 44px;/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.admin-header__nav \{[\s\S]*?overflow-x: auto;/);
  assert.match(css, /\.admin-header__nav a \{[\s\S]*?min-height: 44px;/);
});
