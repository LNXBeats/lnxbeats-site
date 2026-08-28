import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import sharp from "sharp";

import { createInternalAuthUser } from "@/lib/auth/internal-user";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { prisma } from "@/lib/prisma";
import { adminProductEditorPayload } from "@/lib/shop/product-admin-form";
import { replaceAdminProductImage } from "@/lib/shop/product-image";
import { createAdminProduct, publishAdminProduct } from "@/lib/shop/product-service";
import { createShopOrder, quoteShopOrderShipping } from "@/lib/shop/order-service";
import { ensurePhase5AQaShippingRate } from "@/lib/shop/shipping-service";

const QA_TARGET = "lnx-studio-v110-logistics-preview-test";
const QA_DATABASE = "template1";
const MEMBER_EMAIL = "lnx-v110-phase5a-member@example.invalid";
const ADMIN_EMAIL = "lnx-v110-phase5a-admin@example.invalid";
const PRODUCT_SLUGS = ["lnx-v110-phase5a-qa-cd-or", "lnx-v110-phase5a-qa-cd-noir"] as const;
const CREATION_TOKEN = "51050000-0000-4000-8000-000000000001";

const PRODUCTS = [
  {
    slug: PRODUCT_SLUGS[0], title: "CD QA Or — Logistique", price: "25,00", stock: "3",
    shippingPrice: "9,99", shippingWeightGrams: "120", position: "30",
    description: "Produit fictif local pour vérifier le devis de livraison versionné Phase 5A.",
    alt: "Pochette dorée fictive de la QA logistique locale", background: { r: 112, g: 74, b: 29 },
  },
  {
    slug: PRODUCT_SLUGS[1], title: "CD QA Noir — Logistique", price: "30,00", stock: "2",
    shippingPrice: "8,88", shippingWeightGrams: "380", position: "40",
    description: "Second produit fictif local pour contrôler poids, panier et historique des devis.",
    alt: "Pochette noire fictive de la QA logistique locale", background: { r: 18, g: 24, b: 38 },
  },
] as const;

async function assertLocalFixtureTarget() {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.LNX_DATABASE_TARGET, QA_TARGET);
  assert.ok(!process.env.RAILWAY_ENVIRONMENT && !process.env.RAILWAY_ENVIRONMENT_NAME);
  assert.equal(process.env.SHOP_ENABLED, "true");
  assert.equal(process.env.SHOP_SHIPPING_ENABLED, "true");
  assert.equal(process.env.SHOP_SHIPPING_QA_CONFIRM, "enable-internal-shop-shipping-qa");
  assert.equal(process.env.EMAIL_PROVIDER, "capture");
  assert.equal(process.env.MEDIA_STORAGE_DRIVER, "local");
  for (const key of [
    "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET",
    "RESEND_API_KEY", "MEDIA_S3_ACCESS_KEY_ID", "MEDIA_S3_SECRET_ACCESS_KEY",
  ]) assert.ok(!process.env[key], `${key} is forbidden in the logistics fixture.`);

  const databaseUrl = assertSafeLocalPostgresUrl(process.env.DATABASE_URL ?? "");
  assert.equal(decodeURIComponent(databaseUrl.pathname.slice(1)), QA_DATABASE);
  const proofPath = process.env.LNX_PRISMA_DEV_SERVER_FILE;
  assert.ok(proofPath);
  assert.match(proofPath, /[/\\]prisma-dev-nodejs[/\\]lnx-studio-v110-logistics-preview-test[/\\]server\.json$/);
  const proof = JSON.parse(await readFile(proofPath, "utf8")) as {
    name?: string;
    pid?: number;
    exports?: { database?: { connectionString?: string } };
  };
  assert.equal(proof.name, QA_TARGET);
  const proofDatabaseUrl = assertSafeLocalPostgresUrl(proof.exports?.database?.connectionString ?? "");
  assert.equal(proofDatabaseUrl.hostname, databaseUrl.hostname);
  assert.equal(proofDatabaseUrl.port, databaseUrl.port);
  process.kill(Number(proof.pid), 0);
}

function input(definition: typeof PRODUCTS[number]) {
  return adminProductEditorPayload({
    slug: definition.slug,
    title: definition.title,
    description: definition.description,
    price: definition.price,
    currency: "EUR",
    trackInventory: "on",
    stock: definition.stock,
    shippingRequired: "on",
    shippingPrice: definition.shippingPrice,
    shippingWeightGrams: definition.shippingWeightGrams,
    position: definition.position,
  });
}

async function createProduct(definition: typeof PRODUCTS[number], adminId: string) {
  const created = await createAdminProduct(input(definition), adminId);
  const bytes = await sharp({
    create: { width: 1_000, height: 1_000, channels: 3, background: definition.background },
  }).png({ compressionLevel: 9 }).toBuffer();
  await replaceAdminProductImage({
    productId: created.id,
    expectedLockVersion: created.lockVersion,
    expectedAssetId: null,
    file: new File([bytes], `${definition.slug}.png`, { type: "image/png" }),
    alt: definition.alt,
    rightsConfirmed: true,
    actorAdminId: adminId,
  });
  const withImage = await prisma.product.findUniqueOrThrow({
    where: { id: created.id }, select: { lockVersion: true },
  });
  return publishAdminProduct(created.id, withImage.lockVersion, adminId);
}

async function assertFixtureScopeIsFree() {
  const [users, products, order] = await Promise.all([
    prisma.user.count({ where: { email: { in: [MEMBER_EMAIL, ADMIN_EMAIL] } } }),
    prisma.product.count({ where: { slug: { in: [...PRODUCT_SLUGS] } } }),
    prisma.shopOrder.count({ where: { creationToken: CREATION_TOKEN } }),
  ]);
  assert.deepEqual({ users, products, order }, { users: 0, products: 0, order: 0 }, "Phase 5A fixture identities already exist.");
}

async function run() {
  await assertLocalFixtureTarget();
  await assertFixtureScopeIsFree();
  const memberPassword = process.env.LNX_AUTH_QA_MEMBER_PASSWORD;
  const adminPassword = process.env.LNX_AUTH_QA_ADMIN_PASSWORD;
  assert.ok(memberPassword && memberPassword.length >= 12 && memberPassword.length <= 128);
  assert.ok(adminPassword && adminPassword.length >= 12 && adminPassword.length <= 128);
  assert.notEqual(memberPassword, adminPassword);

  const [member, admin] = await Promise.all([
    createInternalAuthUser({ email: MEMBER_EMAIL, password: memberPassword, displayName: "Membre fictif Logistique Phase 5A", role: "MEMBER" }),
    createInternalAuthUser({ email: ADMIN_EMAIL, password: adminPassword, displayName: "Admin fictif Logistique Phase 5A", role: "ADMIN" }),
  ]);
  const products = [];
  for (const definition of PRODUCTS) products.push(await createProduct(definition, admin.id));
  const rate = await ensurePhase5AQaShippingRate();
  const baseIntent = {
    items: products.map((product) => ({ productId: product.id, quantity: 1, observedLockVersion: product.lockVersion })),
    shippingAddress: {
      firstName: "Membre", lastName: "QA Logistique", addressLine1: "5 rue du Test local",
      addressLine2: null, postalCode: "75005", city: "Paris", countryCode: "FR",
    },
    shippingQuoteVersion: null,
  } as const;
  const actor = { id: member.id, role: "MEMBER" as const };
  const quote = await quoteShopOrderShipping(actor, baseIntent);
  const order = await createShopOrder(actor, { ...baseIntent, shippingQuoteVersion: quote.shippingQuoteVersion }, CREATION_TOKEN);
  assert.equal(order.paymentStatus, "AWAITING_PAYMENT");
  assert.equal(order.shippingCents, quote.shippingCents);
  assert.equal(order.shippingQuoteVersion, rate.version);
  assert.equal(order.items.every((item) => item.lineShippingCents === 0), true);

  console.info(JSON.stringify({
    event: "shop.logistics.qa-fixture.ready",
    outcome: "passed",
    memberEmail: MEMBER_EMAIL,
    adminEmail: ADMIN_EMAIL,
    orderNumber: order.orderNumber,
    quoteVersion: quote.shippingQuoteVersion,
    shippingCents: quote.shippingCents,
    totalCents: order.totalCents,
    products: PRODUCT_SLUGS,
  }));
}

run()
  .catch((error: unknown) => {
    console.error(JSON.stringify({ event: "shop.logistics.qa-fixture.failed", outcome: "failed" }));
    if (error instanceof Error) console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
