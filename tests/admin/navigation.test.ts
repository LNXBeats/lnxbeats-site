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

test("Admin mobile and tablet navigation is an accessible grouped disclosure", () => {
  const navigation = readFileSync("components/admin-navigation.tsx", "utf8");
  const css = readFileSync("app/admin/admin.css", "utf8");

  assert.match(navigation, /aria-controls="admin-primary-navigation"/);
  assert.match(navigation, /aria-expanded=\{navigationOpen\}/);
  assert.match(navigation, /event\.key !== "Escape"/);
  assert.match(navigation, /menuButtonRef\.current\?\.focus\(\)/);
  assert.match(navigation, /adminNavigationGroups = \["Pilotage", "Commerce", "Finance", "Droits", "Contenu", "Comptes"\]/);
  assert.match(navigation, /href: "\/admin\/nettoyage", label: "Nettoyage & archives", group: "Pilotage"/);
  assert.match(navigation, /href: "\/admin\/boutique\/logistique", label: "Logistique", group: "Commerce"/);
  assert.match(navigation, /href: "\/admin\/tarifs", label: "Tarifs", group: "Commerce"/);
  assert.match(navigation, /href: "\/admin\/facturation", label: "Facturation", group: "Finance"/);
  assert.match(navigation, /href: "\/admin\/droits", label: "Droits & contrats", group: "Droits"/);
  assert.match(navigation, /href: "\/admin\/catalogue", label: "Catalogue", group: "Contenu"/);
  assert.match(navigation, /href: "\/admin\/membres", label: "Membres", group: "Comptes"/);
  assert.match(navigation, /export type AdminNavigationActionCounts/);
  assert.match(navigation, /actionRequiredCounts\?: AdminNavigationActionCounts/);
  assert.match(navigation, /criticalActionRequiredCounts\?: AdminNavigationActionCounts/);
  assert.match(navigation, /admin-header__nav-badge/);
  assert.match(navigation, /data-priority=\{criticalCount > 0 \? "critical" : "attention"\}/);
  assert.match(css, /\.admin-header__nav-badge \{[^}]*rgba\(214, 179, 106,/);
  assert.match(css, /\.admin-header__nav-badge\[data-priority="critical"\] \{[^}]*rgba\(157, 63, 48,/);
  assert.match(navigation, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(css, /\.admin-back-link \{[\s\S]*?min-height: 44px;/);
  assert.match(css, /@media \(max-width: 1120px\)[\s\S]*?\.admin-header__menu-button \{[\s\S]*?min-height: 44px;/);
  assert.match(css, /@media \(max-width: 1120px\)[\s\S]*?\.admin-header__nav \{[\s\S]*?display: none;/);
  assert.match(css, /\.admin-header__nav--open \{ display: grid; \}/);
  assert.match(css, /\.admin-header__nav-group-label/);
  assert.match(css, /\.admin-header__nav a \{[\s\S]*?min-height: 44px;/);
});

test("Admin member identities can wrap without widening the viewport", () => {
  const css = readFileSync("app/admin/admin.css", "utf8");
  assert.match(css, /\.admin-member-list > li > div \{ display: grid; min-width: 0;/);
  assert.match(css, /\.admin-member-list a \{[^}]*overflow-wrap: anywhere;[^}]*word-break: break-word;/);
});

test("cleanup and archive surfaces keep safe actions readable on narrow screens", () => {
  const css = readFileSync("app/admin/admin.css", "utf8");
  assert.match(css, /\.admin-cleanup-summary \{[^}]*grid-template-columns: repeat\(auto-fit,/);
  assert.match(css, /\.admin-cleanup-list > li\[data-classification="DELETE_SAFE"\]/);
  assert.match(css, /\.admin-confirmation-check \{[^}]*min-height: 44px;/);
  assert.match(css, /\.admin-archive-list > li :is\(strong, span, p\) \{[^}]*overflow-wrap: anywhere;/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*?\.admin-cleanup-list > li,[\s\S]*?\.admin-archive-list > li \{ grid-template-columns: 1fr; \}/);
});

test("Admin operational states remain structured and readable on narrow screens", () => {
  const [page, css] = [
    readFileSync("app/admin/boutique/page.tsx", "utf8"),
    readFileSync("app/admin/admin.css", "utf8"),
  ];
  assert.match(page, /className="admin-operations-strip"/);
  assert.match(css, /\.admin-operations-strip \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.admin-operations-strip > div \{[^}]*display: grid;[^}]*gap: \.3rem;/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*?\.admin-operations-strip \{ grid-template-columns: 1fr 1fr; \}/);
});
