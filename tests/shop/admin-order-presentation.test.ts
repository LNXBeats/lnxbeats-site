import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Admin exposes ShopOrders through dedicated read-only routes", async () => {
  const [listPage, detailPage] = await Promise.all([
    readFile(new URL("../../app/admin/boutique/commandes/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/boutique/commandes/[orderNumber]/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(listPage, /await requireAdmin\(\)/);
  assert.match(listPage, /listAdminShopOrders/);
  assert.match(listPage, /Commandes Boutique/);
  assert.match(listPage, /lecture seule/);
  assert.match(detailPage, /await requireAdmin\(\)/);
  assert.match(detailPage, /getAdminShopOrder/);
  assert.match(detailPage, /if \(!order\) notFound\(\)/);
  assert.match(detailPage, /Stock réservé/);
  assert.match(detailPage, /Adresse snapshotée/);
  assert.match(detailPage, /admin-rights-timeline/);
  assert.match(detailPage, /AWAITING_PAYMENT/);
  assert.match(detailPage, /elle ne réduit plus la disponibilité/);
  assert.match(detailPage, /Aucun mouvement de stock physique n’a été nécessaire/);
  assert.doesNotMatch(detailPage, /stock correspondant doit être libéré/);
  assert.doesNotMatch(`${listPage}\n${detailPage}`, /@\/lib\/payments|PaymentCheckout|Stripe|PayPal|payer maintenant/i);
});

test("Admin navigation selects only the longest matching route and mobile orders stack", async () => {
  const [navigation, css] = await Promise.all([
    readFile(new URL("../../components/admin-navigation.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/admin.css", import.meta.url), "utf8"),
  ]);

  assert.match(navigation, /href: "\/admin\/boutique\/commandes"/);
  assert.match(navigation, /item\.href\.length > longest\.length/);
  assert.match(navigation, /const active = activeHref === item\.href/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*\.admin-order-list a \{ grid-template-columns: 1fr 20px/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.admin-rights-timeline li \{ grid-template-columns: 1fr/);
});
