import assert from "node:assert/strict";
import { readFile, unlink } from "node:fs/promises";

import sharp from "sharp";

import { createInternalAuthUser } from "@/lib/auth/internal-user";
import { removeCatalogImage } from "@/lib/catalog/media-storage";
import { prisma } from "@/lib/prisma";
import { adminProductEditorPayload } from "@/lib/shop/product-admin-form";
import { replaceAdminProductImage } from "@/lib/shop/product-image";
import { createAdminProduct, publishAdminProduct } from "@/lib/shop/product-service";
import {
  loadAndAssertShopPhase2QaEnvironment,
  SHOP_PHASE2_QA_AUTH_CAPTURE_PATH,
  SHOP_PHASE2_QA_NOTIFICATION_CAPTURE_PATH,
  SHOP_PHASE2_QA_ORIGIN,
} from "@/lib/shop/qa-guard";

const MEMBER_EMAIL = "lnx-v110-phase2-member@example.invalid";
const ADMIN_EMAIL = "lnx-v110-phase2-admin@example.invalid";
const MEMBER_DISPLAY_NAME = "Membre fictif Boutique Phase 2";
const ADMIN_DISPLAY_NAME = "Admin fictif Boutique Phase 2";
const FIXTURE_IMAGE_PREFIX = "lnx-v110-phase2-product-";

const USERS = [
  { email: MEMBER_EMAIL, displayName: MEMBER_DISPLAY_NAME, role: "MEMBER" as const },
  { email: ADMIN_EMAIL, displayName: ADMIN_DISPLAY_NAME, role: "ADMIN" as const },
] as const;

const PRODUCTS = [
  {
    key: "a",
    slug: "lnx-v110-phase2-qa-product-a",
    title: "CD QA Or",
    description: "CD doré entièrement fictif réservé à la validation locale de la Boutique Phase 2.",
    price: "25,00",
    stock: "3",
    shippingPrice: "5,00",
    shippingWeightGrams: "120",
    position: "10",
    alt: "CD fictif doré utilisé pour la QA locale de la Boutique",
    width: 1_600,
    height: 1_000,
    background: { r: 76, g: 44, b: 24 },
  },
  {
    key: "b",
    slug: "lnx-v110-phase2-qa-product-b",
    title: "CD QA Noir",
    description: "CD noir entièrement fictif permettant de vérifier panier, quantités et frais de livraison.",
    price: "30,00",
    stock: "2",
    shippingPrice: "4,00",
    shippingWeightGrams: "380",
    position: "20",
    alt: "CD fictif noir utilisé pour la QA locale de la Boutique",
    width: 1_000,
    height: 1_400,
    background: { r: 18, g: 31, b: 58 },
  },
] as const;

const FIXTURE_EMAILS = USERS.map(({ email }) => email);
const FIXTURE_SLUGS = PRODUCTS.map(({ slug }) => slug);
const LOOPBACK_RATE_LIMIT_KEYS = [
  "127.0.0.1|/sign-in/email",
  "127.0.0.1|/sign-out",
  "0000:0000:0000:0000:0000:0000:0000:0000|/sign-in/email",
  "0000:0000:0000:0000:0000:0000:0000:0000|/sign-out",
] as const;

let stage = "startup";

async function assertDatabaseState() {
  stage = "database-proof";
  const metadata = await prisma.$queryRaw<Array<{ database: string; schema: string }>>`
    SELECT current_database() AS database, current_schema() AS schema
  `;
  assert.deepEqual(metadata[0], { database: "template1", schema: "public" }, "The fixture reached an unexpected PostgreSQL database.");
  const migration = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS count
    FROM "_prisma_migrations"
    WHERE "migration_name" = '20260827180000_shop_commerce_foundation'
      AND "finished_at" IS NOT NULL
      AND "rolled_back_at" IS NULL
  `;
  assert.equal(Number(migration[0]?.count), 1, "The Shop Phase 2 migration is not applied exactly once.");
}

function productInput(definition: typeof PRODUCTS[number]) {
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

function fixtureMoneyCents(value: string) {
  const match = /^(\d+),(\d{2})$/.exec(value);
  assert.ok(match, "A synthetic fixture price is malformed.");
  return Number(match[1]) * 100 + Number(match[2]);
}

async function readCapture(path: string) {
  return readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
}

async function removeCapture(path: string) {
  await unlink(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

async function assertFixtureOwnership() {
  stage = "ownership";
  const users = await prisma.user.findMany({
    where: { email: { in: [...FIXTURE_EMAILS] } },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      status: true,
      emailVerified: true,
      emailVerifiedAt: true,
      accounts: {
        select: { id: true, userId: true, accountId: true, providerId: true, password: true },
      },
      _count: true,
    },
  });

  for (const user of users) {
    const expected = USERS.find(({ email }) => email === user.email);
    const credential = user.accounts[0];
    assert.ok(expected, "A non-fixture identity occupies a Shop Phase 2 fixture email.");
    assert.equal(user.displayName, expected.displayName, "A Shop Phase 2 fixture email belongs to an unexpected identity.");
    assert.equal(user.role, expected.role, "A Shop Phase 2 fixture identity has an unexpected role.");
    assert.equal(user.status, "ACTIVE", "A Shop Phase 2 fixture identity is not active.");
    assert.equal(user.emailVerified, true, "A Shop Phase 2 fixture identity is not verified.");
    assert.ok(user.emailVerifiedAt, "A Shop Phase 2 fixture identity has no verification timestamp.");
    assert.equal(user.accounts.length, 1, "A Shop Phase 2 fixture identity has an unexpected account graph.");
    assert.ok(
      credential
      && credential.userId === user.id
      && credential.accountId === user.id
      && credential.providerId === "credential"
      && Boolean(credential.password),
      "A Shop Phase 2 fixture credential is inconsistent.",
    );
    const allowedRelations = new Set([
      "accounts",
      "sessions",
      "favorites",
      "productsCreated",
      "productsUpdated",
      "productStockAdjustments",
      "productAuditEvents",
      "shopOrders",
      "shopOrderEvents",
    ]);
    for (const [relation, count] of Object.entries(user._count)) {
      if (!allowedRelations.has(relation)) {
        assert.equal(count, 0, `A Shop Phase 2 fixture identity is linked through ${relation}.`);
      }
    }
  }

  const userIds = users.map(({ id }) => id);
  const memberId = users.find(({ email }) => email === MEMBER_EMAIL)?.id ?? null;
  const adminId = users.find(({ email }) => email === ADMIN_EMAIL)?.id ?? null;
  const products = await prisma.product.findMany({
    where: { slug: { in: [...FIXTURE_SLUGS] } },
    select: { id: true, slug: true, createdByAdminId: true, updatedByAdminId: true },
  });
  for (const product of products) {
    assert.ok(adminId, "A Shop Phase 2 fixture product exists without its fixture administrator.");
    assert.equal(product.createdByAdminId, adminId, "A fixture slug belongs to a product created by another administrator.");
    assert.ok(
      product.updatedByAdminId === null || product.updatedByAdminId === adminId,
      "A fixture product was updated by an unexpected administrator.",
    );
  }
  const productIds = products.map(({ id }) => id);

  const shopOrders = userIds.length
    ? await prisma.shopOrder.findMany({
      where: { userId: { in: userIds } },
      select: {
        id: true,
        userId: true,
        paymentStatus: true,
        fulfillmentStatus: true,
        items: {
          select: {
            productId: true,
            reservation: { select: { status: true } },
          },
        },
      },
    })
    : [];
  for (const order of shopOrders) {
    assert.equal(order.userId, memberId, "Only the fixture MEMBER may own a Shop Phase 2 fixture order.");
    assert.notEqual(order.paymentStatus, "PAID", "A paid ShopOrder must never be removed by the local fixture cleanup.");
    assert.notEqual(order.fulfillmentStatus, "SHIPPED", "A shipped ShopOrder must never be removed by the local fixture cleanup.");
    assert.ok(
      order.items.every(({ productId }) => productIds.includes(productId)),
      "A Shop Phase 2 fixture account owns a ShopOrder containing a foreign product.",
    );
    assert.ok(
      order.items.every(({ reservation }) => reservation?.status !== "CONFIRMED"),
      "A confirmed stock reservation must never be removed by the local fixture cleanup.",
    );
  }
  const shopOrderIds = shopOrders.map(({ id }) => id);

  if (userIds.length) {
    const [
      legacyOrders,
      customers,
      rightsRequests,
      foreignProducts,
      foreignAudits,
      foreignAdjustments,
      foreignShopOrderEvents,
    ] = await Promise.all([
      prisma.order.count({ where: { userId: { in: userIds } } }),
      prisma.customer.count({ where: { userId: { in: userIds } } }),
      prisma.rightsRequest.count({ where: { userId: { in: userIds } } }),
      prisma.product.count({
        where: {
          slug: { notIn: [...FIXTURE_SLUGS] },
          OR: [{ createdByAdminId: { in: userIds } }, { updatedByAdminId: { in: userIds } }],
        },
      }),
      prisma.productAuditEvent.count({
        where: { actorAdminId: { in: userIds }, productId: { notIn: productIds } },
      }),
      prisma.productStockAdjustment.count({
        where: { actorAdminId: { in: userIds }, productId: { notIn: productIds } },
      }),
      prisma.shopOrderEvent.count({
        where: { actorUserId: { in: userIds }, shopOrderId: { notIn: shopOrderIds } },
      }),
    ]);
    assert.deepEqual(
      { legacyOrders, customers, rightsRequests, foreignProducts, foreignAudits, foreignAdjustments, foreignShopOrderEvents },
      { legacyOrders: 0, customers: 0, rightsRequests: 0, foreignProducts: 0, foreignAudits: 0, foreignAdjustments: 0, foreignShopOrderEvents: 0 },
      "A Shop Phase 2 fixture identity is linked to data outside the fixture scope.",
    );
  }

  const assets = await prisma.asset.findMany({
    where: {
      OR: [
        { products: { some: { productId: { in: productIds } } } },
        { filename: { startsWith: FIXTURE_IMAGE_PREFIX } },
      ],
    },
    select: {
      id: true,
      filename: true,
      storageKey: true,
      storageBackend: true,
      storageProvider: true,
      visibility: true,
      products: { select: { productId: true, product: { select: { slug: true } } } },
      _count: { select: { products: true, projects: true, orders: true, contractDocuments: true } },
    },
  });
  for (const asset of assets) {
    assert.equal(asset.storageBackend, "LOCAL", "The local fixture refuses to delete a non-local media object.");
    assert.equal(asset.storageProvider, "local", "The local fixture refuses to delete media from another provider.");
    assert.equal(asset.visibility, "PUBLIC", "A Shop Phase 2 product fixture has an unexpected media visibility.");
    assert.equal(asset._count.projects, 0, "A Shop Phase 2 media fixture is shared with a catalogue project.");
    assert.equal(asset._count.orders, 0, "A Shop Phase 2 media fixture is shared with a legacy order.");
    assert.equal(asset._count.contractDocuments, 0, "A Shop Phase 2 media fixture is shared with a contract.");
    assert.equal(asset._count.products, asset.products.length, "A Shop Phase 2 media relation could not be fully inspected.");
    assert.ok(
      asset.products.every(({ productId, product }) => productIds.includes(productId) && FIXTURE_SLUGS.includes(product.slug as typeof FIXTURE_SLUGS[number])),
      "A Shop Phase 2 media fixture is shared with a foreign product.",
    );
  }

  return {
    userIds,
    accountIds: users.flatMap(({ accounts }) => accounts.map(({ id }) => id)),
    productIds,
    shopOrderIds,
    assets,
  };
}

async function cleanup() {
  const scope = await assertFixtureOwnership();
  stage = "media-cleanup";
  for (const asset of scope.assets) await removeCatalogImage(asset);

  stage = "database-cleanup";
  await prisma.$transaction(async (transaction) => {
    if (scope.shopOrderIds.length) {
      await transaction.shopOrderEvent.deleteMany({ where: { shopOrderId: { in: scope.shopOrderIds } } });
      await transaction.stockReservation.deleteMany({ where: { shopOrderId: { in: scope.shopOrderIds } } });
      await transaction.shopOrderItem.deleteMany({ where: { shopOrderId: { in: scope.shopOrderIds } } });
      await transaction.shopOrder.deleteMany({
        where: { id: { in: scope.shopOrderIds }, userId: { in: scope.userIds } },
      });
    }
    if (scope.productIds.length) {
      await transaction.productAsset.deleteMany({ where: { productId: { in: scope.productIds } } });
      await transaction.productStockAdjustment.deleteMany({ where: { productId: { in: scope.productIds } } });
      await transaction.productAuditEvent.deleteMany({ where: { productId: { in: scope.productIds } } });
      await transaction.product.deleteMany({
        where: { id: { in: scope.productIds }, slug: { in: [...FIXTURE_SLUGS] } },
      });
    }
    const assetIds = scope.assets.map(({ id }) => id);
    if (assetIds.length) {
      await transaction.asset.deleteMany({
        where: {
          id: { in: assetIds },
          products: { none: {} },
          projects: { none: {} },
          orders: { none: {} },
          contractDocuments: { none: {} },
        },
      });
    }
    if (scope.userIds.length) {
      await transaction.favorite.deleteMany({ where: { userId: { in: scope.userIds } } });
      await transaction.session.deleteMany({ where: { userId: { in: scope.userIds } } });
      await transaction.account.deleteMany({ where: { userId: { in: scope.userIds } } });
      await transaction.rateLimit.deleteMany({
        where: {
          OR: [
            { key: { in: [...LOOPBACK_RATE_LIMIT_KEYS] } },
            ...scope.userIds.map((userId) => ({ key: `shop:orders:create:${userId}` })),
          ],
        },
      });
    }
    await transaction.registrationAttempt.deleteMany({ where: { email: { in: [...FIXTURE_EMAILS] } } });
    await transaction.verification.deleteMany({ where: { identifier: { in: [...FIXTURE_EMAILS] } } });
    await transaction.user.deleteMany({
      where: { id: { in: scope.userIds }, email: { in: [...FIXTURE_EMAILS] } },
    });
  });

  stage = "capture-cleanup";
  await Promise.all([
    removeCapture(SHOP_PHASE2_QA_AUTH_CAPTURE_PATH),
    removeCapture(SHOP_PHASE2_QA_NOTIFICATION_CAPTURE_PATH),
  ]);
  return scope;
}

async function assertClean(scope: Awaited<ReturnType<typeof assertFixtureOwnership>>) {
  stage = "postcondition";
  const [users, products, assets, orders, accounts, sessions, authCapture, notificationCapture] = await Promise.all([
    prisma.user.count({ where: { email: { in: [...FIXTURE_EMAILS] } } }),
    prisma.product.count({ where: { slug: { in: [...FIXTURE_SLUGS] } } }),
    prisma.asset.count({ where: { filename: { startsWith: FIXTURE_IMAGE_PREFIX } } }),
    scope.userIds.length ? prisma.shopOrder.count({ where: { userId: { in: scope.userIds } } }) : 0,
    scope.accountIds.length ? prisma.account.count({ where: { id: { in: scope.accountIds } } }) : 0,
    scope.userIds.length ? prisma.session.count({ where: { userId: { in: scope.userIds } } }) : 0,
    readCapture(SHOP_PHASE2_QA_AUTH_CAPTURE_PATH),
    readCapture(SHOP_PHASE2_QA_NOTIFICATION_CAPTURE_PATH),
  ]);
  assert.deepEqual(
    { users, products, assets, orders, accounts, sessions, authCapture, notificationCapture },
    { users: 0, products: 0, assets: 0, orders: 0, accounts: 0, sessions: 0, authCapture: "", notificationCapture: "" },
    "The Shop Phase 2 browser fixture cleanup is incomplete.",
  );
}

async function createFixtureProduct(definition: typeof PRODUCTS[number], actorAdminId: string) {
  const created = await createAdminProduct(productInput(definition), actorAdminId);
  const bytes = await sharp({
    create: {
      width: definition.width,
      height: definition.height,
      channels: 3,
      background: definition.background,
    },
  }).png({ compressionLevel: 9 }).toBuffer();
  const image = await replaceAdminProductImage({
    productId: created.id,
    expectedLockVersion: created.lockVersion,
    expectedAssetId: null,
    file: new File([bytes], `${FIXTURE_IMAGE_PREFIX}${definition.key}.png`, { type: "image/png" }),
    alt: definition.alt,
    rightsConfirmed: true,
    actorAdminId,
  });
  const withImage = await prisma.product.findUniqueOrThrow({
    where: { id: created.id },
    select: { lockVersion: true, assets: { where: { position: 0 }, select: { assetId: true } } },
  });
  assert.equal(withImage.assets[0]?.assetId, image.assetId, "The synthetic product image was not activated at position zero.");
  return publishAdminProduct(created.id, withImage.lockVersion, actorAdminId);
}

async function setup(memberPassword: string, adminPassword: string) {
  stage = "identity-setup";
  const member = await createInternalAuthUser({
    email: MEMBER_EMAIL,
    password: memberPassword,
    displayName: MEMBER_DISPLAY_NAME,
    role: "MEMBER",
  });
  const admin = await createInternalAuthUser({
    email: ADMIN_EMAIL,
    password: adminPassword,
    displayName: ADMIN_DISPLAY_NAME,
    role: "ADMIN",
  });

  stage = "product-setup";
  for (const definition of PRODUCTS) await createFixtureProduct(definition, admin.id);

  stage = "setup-postcondition";
  const products = await prisma.product.findMany({
    where: { slug: { in: [...FIXTURE_SLUGS] } },
      select: {
        slug: true,
        title: true,
        description: true,
        status: true,
        priceCents: true,
        currency: true,
        stock: true,
        trackInventory: true,
        shippingRequired: true,
        shippingPriceCents: true,
        shippingWeightGrams: true,
        position: true,
        createdByAdminId: true,
        assets: {
          where: { position: 0 },
          select: {
          position: true,
          asset: {
            select: {
              type: true,
              mimeType: true,
              visibility: true,
                rightsStatus: true,
                alt: true,
                filename: true,
                width: true,
                height: true,
                storageBackend: true,
                storageProvider: true,
            },
          },
        },
      },
    },
    });
    assert.equal(products.length, PRODUCTS.length, "The two synthetic Shop products were not created.");
    for (const definition of PRODUCTS) {
      const product = products.find(({ slug }) => slug === definition.slug);
      assert.ok(product, `Synthetic product ${definition.slug} is missing.`);
      assert.deepEqual(
        {
          title: product.title,
          description: product.description,
          status: product.status,
          priceCents: product.priceCents,
          currency: product.currency,
          stock: product.stock,
          trackInventory: product.trackInventory,
          shippingRequired: product.shippingRequired,
          shippingPriceCents: product.shippingPriceCents,
          shippingWeightGrams: product.shippingWeightGrams,
          position: product.position,
          createdByAdminId: product.createdByAdminId,
        },
        {
          title: definition.title,
          description: definition.description,
          status: "PUBLISHED",
          priceCents: fixtureMoneyCents(definition.price),
          currency: "EUR",
          stock: Number(definition.stock),
          trackInventory: true,
          shippingRequired: true,
          shippingPriceCents: fixtureMoneyCents(definition.shippingPrice),
          shippingWeightGrams: Number(definition.shippingWeightGrams),
          position: Number(definition.position),
          createdByAdminId: admin.id,
        },
        `Synthetic product ${definition.slug} drifted from its fixed QA definition.`,
      );
      const productImage = product.assets[0];
      assert.ok(productImage, `Synthetic product ${definition.slug} has no primary image.`);
      assert.equal(productImage.position, 0);
      assert.deepEqual(
        productImage.asset,
        {
          type: "IMAGE",
          mimeType: "image/webp",
          visibility: "PUBLIC",
          rightsStatus: "CLEARED",
          alt: definition.alt,
          filename: `${FIXTURE_IMAGE_PREFIX}${definition.key}.webp`,
          width: definition.width,
          height: definition.height,
          storageBackend: "LOCAL",
          storageProvider: "local",
        },
        `Synthetic product ${definition.slug} has an unexpected primary image.`,
      );
    }
  assert.equal(await prisma.shopOrder.count({ where: { userId: member.id } }), 0, "Setup must not pre-create a ShopOrder.");
}

async function run() {
  stage = "guard";
  const runtime = await loadAndAssertShopPhase2QaEnvironment();
  assert.equal(runtime.baseUrl, SHOP_PHASE2_QA_ORIGIN);
  await assertDatabaseState();
  const operation = process.argv[2];
  assert.ok(operation === "setup" || operation === "cleanup", "Use setup or cleanup.");

  const removed = await cleanup();
  await assertClean(removed);
  if (operation === "cleanup") {
    console.info("Shop Phase 2 local browser fixtures removed.");
    return;
  }

  const memberPassword = process.env.LNX_AUTH_QA_MEMBER_PASSWORD;
  const adminPassword = process.env.LNX_AUTH_QA_ADMIN_PASSWORD;
  assert.ok(
    memberPassword && memberPassword.length >= 12 && memberPassword.length <= 128,
    "LNX_AUTH_QA_MEMBER_PASSWORD is required.",
  );
  assert.ok(
    adminPassword && adminPassword.length >= 12 && adminPassword.length <= 128,
    "LNX_AUTH_QA_ADMIN_PASSWORD is required.",
  );
  assert.notEqual(memberPassword, adminPassword, "The MEMBER and ADMIN QA passwords must be distinct.");
  try {
    await setup(memberPassword, adminPassword);
  } catch (error) {
    const partial = await cleanup();
    await assertClean(partial);
    throw error;
  }

  console.info("Shop Phase 2 local browser fixtures are ready.");
  console.info(`MEMBER: ${MEMBER_EMAIL}`);
  console.info(`ADMIN: ${ADMIN_EMAIL}`);
  console.info(`Products: ${PRODUCTS.map(({ slug }) => `/boutique/${slug}`).join(", ")}`);
  console.info("Use the separate passwords stored in LNX_AUTH_QA_MEMBER_PASSWORD and LNX_AUTH_QA_ADMIN_PASSWORD; neither was printed.");
}

run()
  .finally(() => prisma.$disconnect())
  .catch(() => {
    console.error(`Shop Phase 2 fixture operation failed at ${stage}.`);
    process.exitCode = 1;
  });
