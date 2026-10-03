import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Next image optimization keeps a cold allocator-configured process at concurrency one", async () => {
  const config = await readFile(new URL("../../next.config.ts", import.meta.url), "utf8");

  assert.match(config, /experimental:\s*\{[\s\S]*imgOptOperationCache:\s*false/);
  assert.match(config, /imgOptConcurrency:\s*1/);
});

test("shop and catalogue images publish layout-accurate responsive sizes", async () => {
  const [catalogue, product, cart, adminCatalogue] = await Promise.all([
    readFile(new URL("../../app/boutique/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/boutique/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../components/shop-cart.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/catalogue/[slug]/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(
    catalogue,
    /sizes="\(max-width: 620px\) calc\(50vw - 28px\), \(max-width: 900px\) calc\(50vw - 40px\), \(max-width: 1440px\) calc\(33vw - 48px\), 340px"/,
  );
  assert.match(
    product,
    /sizes="\(max-width: 900px\) min\(calc\(100vw - 40px\), 600px\), \(max-width: 1440px\) 45vw, 640px"/,
  );
  assert.match(adminCatalogue, /width=\{320\} height=\{320\} sizes="240px"/);
  assert.match(
    cart,
    /<Image[\s\S]*?alt=\{product\.image\.alt\}[\s\S]*?height=\{64\}[\s\S]*?src=\{`\/media\/boutique\/\$\{product\.image\.id\}`\}[\s\S]*?width=\{64\}/,
  );
});
