import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { deleteMediaObject } from "@/lib/media/storage";
import { prisma } from "@/lib/prisma";
import { replaceAdminExternalProductImage } from "@/lib/shop/external-product-image";
import {
  createAdminExternalProduct,
  listPublicExternalProducts,
  publishAdminExternalProduct,
  unpublishAdminExternalProduct,
  updateAdminExternalProduct,
} from "@/lib/shop/external-product-service";

const REVIEW_EMAIL = "external-shop-review-admin@example.invalid";
const REVIEW_TITLE = "Vie de chien — Mug céramique";
const REVIEW_URL = "https://direct.distrokid.com/lnxbeats2/product/1407201-vie-de-chien-ceramic-mug";
const REVIEW_ASSET = new URL("../tests/fixtures/shop/vie-de-chien-mug.png", import.meta.url);

function assertEnvironment() {
  const value = process.env.DATABASE_URL;
  assert.ok(value, "DATABASE_URL is required.");
  const url = assertSafeLocalPostgresUrl(value, "DATABASE_URL");
  assert.match(url.pathname, /_test$/, "The review fixture requires an explicit *_test database.");
  assert.equal(process.env.EXTERNAL_SHOP_REVIEW_FIXTURE, "I_UNDERSTAND_THIS_IS_SYNTHETIC_QA");
}

async function cleanup() {
  const product = await prisma.externalShopProduct.findFirst({
    where: { externalUrl: REVIEW_URL },
    include: { image: true },
  });
  if (product) {
    assert.equal(product.title, REVIEW_TITLE, "The review URL is occupied by an unexpected record.");
    await prisma.$transaction(async (transaction) => {
      await transaction.externalShopProductAuditEvent.deleteMany({ where: { externalShopProductId: product.id } });
      await transaction.externalShopProduct.delete({ where: { id: product.id } });
      if (product.image) await transaction.asset.delete({ where: { id: product.image.id } });
    });
    if (product.image) await deleteMediaObject(product.image).catch(() => undefined);
  }
  await prisma.user.deleteMany({ where: { email: REVIEW_EMAIL } });
}

async function setup() {
  await cleanup();
  const actor = await prisma.user.create({
    data: { email: REVIEW_EMAIL, displayName: "Admin fixture produit externe", role: "ADMIN", status: "ACTIVE", emailVerified: true, emailVerifiedAt: new Date() },
  });
  const product = await createAdminExternalProduct({
    title: REVIEW_TITLE,
    providerLabel: "PRODUIT DÉRIVÉ · DISTROKID",
    externalUrl: REVIEW_URL,
    priceCents: 1700,
    currency: "EUR",
    position: 30,
  }, actor.id);
  const ordered = await updateAdminExternalProduct(product.id, product.lockVersion, {
    title: REVIEW_TITLE,
    providerLabel: "PRODUIT DÉRIVÉ · DISTROKID",
    externalUrl: REVIEW_URL,
    priceCents: 1700,
    currency: "EUR",
    position: 3,
  }, actor.id);
  const bytes = await readFile(REVIEW_ASSET);
  await replaceAdminExternalProductImage({
    productId: product.id,
    expectedLockVersion: ordered.lockVersion,
    expectedAssetId: null,
    file: new File([bytes], "vie-de-chien-mug.png", { type: "image/png" }),
    alt: "Mug Vie de chien avec six chiens devant un coucher de soleil",
    rightsConfirmed: true,
    actorAdminId: actor.id,
  });
  const ready = await prisma.externalShopProduct.findUniqueOrThrow({ where: { id: product.id } });
  const firstPublication = await publishAdminExternalProduct(product.id, ready.lockVersion, actor.id);
  const hidden = await unpublishAdminExternalProduct(product.id, firstPublication.lockVersion, actor.id);
  assert.equal(hidden.status, "DRAFT");
  assert.equal((await listPublicExternalProducts()).some(({ id }) => id === product.id), false);
  const published = await publishAdminExternalProduct(product.id, hidden.lockVersion, actor.id);
  assert.equal(published.status, "PUBLISHED");
  assert.equal((await prisma.shopOrder.count()), 0, "The isolated review database unexpectedly contains a Shop order.");
  console.log(JSON.stringify({ fixture: "PASS", title: published.title, position: published.position, priceCents: published.priceCents, provider: published.provider }));
}

assertEnvironment();
const mode = process.argv[2];
try {
  if (mode === "setup") await setup();
  else if (mode === "cleanup") { await cleanup(); console.log(JSON.stringify({ cleanup: "PASS" })); }
  else throw new Error("Use setup or cleanup.");
} finally {
  await prisma.$disconnect();
}
