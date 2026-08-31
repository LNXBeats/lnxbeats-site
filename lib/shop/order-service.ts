import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";
import { parseShopConfiguration } from "@/lib/shop/config";
import {
  assertShippingAddress,
  checkedMoney,
  getAvailableProductQuantity,
  getPublicAvailabilityState,
  shopOrderIntentFingerprint,
  type ShopOrderIntent,
  type ShopShippingQuoteIntent,
} from "@/lib/shop/order-domain";
import {
  quoteVersionedShopShipping,
  ShopShippingServiceError,
} from "@/lib/shop/shipping-service";

type Transaction = Prisma.TransactionClient;

export type ShopOrderActor = Readonly<{
  id: string;
  role: "MEMBER" | "CUSTOMER" | "ADMIN";
}>;

export type ShopServiceErrorCode =
  | "SHOP_DISABLED"
  | "SHOP_CONFIGURATION_INVALID"
  | "ROLE_NOT_ALLOWED"
  | "PRODUCT_UNAVAILABLE"
  | "PRODUCT_CHANGED"
  | "OUT_OF_STOCK"
  | "IDEMPOTENCY_CONFLICT"
  | "ORDER_NOT_FOUND"
  | "RESERVATION_EXPIRED"
  | "RESERVATION_CONFIRMED"
  | "PAYMENT_REVIEW_REQUIRED"
  | "SHIPPING_CONFIGURATION_REQUIRED"
  | "SHIPPING_WEIGHT_REQUIRED"
  | "SHIPPING_QUOTE_CHANGED"
  | "RATE_LIMITED"
  | "NUMBER_GENERATION_FAILED";

export class ShopServiceError extends Error {
  constructor(
    message: string,
    readonly code: ShopServiceErrorCode,
    readonly status: number,
    readonly productId?: string,
  ) {
    super(message);
    this.name = "ShopServiceError";
  }
}

async function enforceShopOrderRateLimitInTransaction(
  transaction: Transaction,
  actorId: string,
  now: number,
) {
  const key = `shop:orders:create:${actorId}`;
  await lock(transaction, key);
  const current = await transaction.rateLimit.findUnique({ where: { key } });
  const timestamp = BigInt(now);
  if (!current) {
    await transaction.rateLimit.create({ data: { key, count: 1, lastRequest: timestamp } });
    return;
  }
  if (timestamp - current.lastRequest >= 60n * 60n * 1000n) {
    await transaction.rateLimit.update({ where: { key }, data: { count: 1, lastRequest: timestamp } });
    return;
  }
  if (current.count >= 10) {
    throw new ShopServiceError(
      "Trop de commandes ont été préparées. Réessayez plus tard.",
      "RATE_LIMITED",
      429,
    );
  }
  await transaction.rateLimit.update({
    where: { key },
    data: { count: { increment: 1 }, lastRequest: timestamp },
  });
}

const productImageWhere = {
  position: 0,
  asset: {
    visibility: "PUBLIC" as const,
    type: "IMAGE" as const,
    mimeType: "image/webp",
    rightsStatus: "CLEARED" as const,
    alt: { not: null },
  },
} as const;

const orderProductSelect = {
  id: true,
  status: true,
  slug: true,
  title: true,
  description: true,
  priceCents: true,
  currency: true,
  trackInventory: true,
  stock: true,
  shippingRequired: true,
  shippingPriceCents: true,
  shippingWeightGrams: true,
  lockVersion: true,
  position: true,
} satisfies Prisma.ProductSelect;

const publicProductSelect = {
  ...orderProductSelect,
  assets: {
    where: productImageWhere,
    orderBy: { position: "asc" as const },
    take: 1,
    select: {
      asset: {
        select: {
          id: true,
          alt: true,
          width: true,
          height: true,
          updatedAt: true,
        },
      },
    },
  },
} satisfies Prisma.ProductSelect;

const shopOrderDetailInclude = {
  items: {
    orderBy: { position: "asc" as const },
    include: { reservation: true },
  },
  events: { orderBy: [{ occurredAt: "asc" as const }, { id: "asc" as const }] },
  lifecycleEvents: { orderBy: [{ occurredAt: "asc" as const }, { id: "asc" as const }] },
  payments: {
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    select: {
      id: true,
      provider: true,
      mode: true,
      status: true,
      amountCents: true,
      currency: true,
      providerCheckoutId: true,
      paidAt: true,
      failureCode: true,
      createdAt: true,
    },
  },
  customerRequests: { orderBy: [{ requestedAt: "desc" as const }, { id: "desc" as const }] },
} satisfies Prisma.ShopOrderInclude;

type PublicProductRecord = Prisma.ProductGetPayload<{ select: typeof publicProductSelect }>;

function configurationForCreation() {
  let configuration;
  try {
    configuration = parseShopConfiguration();
  } catch {
    throw new ShopServiceError(
      "La Boutique n’est pas correctement configurée.",
      "SHOP_CONFIGURATION_INVALID",
      503,
    );
  }
  if (!configuration.enabled) {
    throw new ShopServiceError("La Boutique n’est pas ouverte.", "SHOP_DISABLED", 503);
  }
  return configuration;
}

function assertMember(actor: ShopOrderActor) {
  if (actor.role !== "MEMBER" && actor.role !== "CUSTOMER") {
    throw new ShopServiceError(
      "Utilisez un compte membre pour préparer un achat.",
      "ROLE_NOT_ALLOWED",
      403,
    );
  }
}

async function activeReservedQuantity(transaction: Transaction, productId: string, now: Date) {
  const aggregate = await transaction.stockReservation.aggregate({
    where: { productId, status: "ACTIVE", expiresAt: { gt: now } },
    _sum: { quantity: true },
  });
  return aggregate._sum.quantity ?? 0;
}

function presentProduct(product: PublicProductRecord, activeReserved: number) {
  const availableQuantity = getAvailableProductQuantity({
    trackInventory: product.trackInventory,
    stock: product.stock,
    activeReserved,
  });
  const image = product.assets[0]?.asset ?? null;
  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    description: product.description,
    priceCents: product.priceCents!,
    currency: "EUR" as const,
    trackInventory: product.trackInventory,
    availableQuantity,
    availabilityState: getPublicAvailabilityState({
      trackInventory: product.trackInventory,
      stock: product.stock,
      activeReserved,
    }),
    soldOut: availableQuantity === 0,
    shippingRequired: product.shippingRequired,
    shippingPriceCents: product.shippingPriceCents,
    shippingWeightGrams: product.shippingWeightGrams,
    lockVersion: product.lockVersion,
    image: image ? {
      id: image.id,
      alt: image.alt!,
      width: image.width,
      height: image.height,
      updatedAt: image.updatedAt,
    } : null,
  };
}

export async function listPublicShopProducts(now = new Date()) {
  assertDatabaseConfigured();
  const configuration = parseShopConfiguration();
  if (!configuration.enabled) return [];
  const products = await prisma.product.findMany({
    where: {
      status: "PUBLISHED",
      priceCents: { not: null },
      assets: { some: productImageWhere },
    },
    select: publicProductSelect,
    orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  if (!products.length) return [];
  const reservations = await prisma.stockReservation.groupBy({
    by: ["productId"],
    where: { productId: { in: products.map(({ id }) => id) }, status: "ACTIVE", expiresAt: { gt: now } },
    _sum: { quantity: true },
  });
  const reservedByProduct = new Map(reservations.map((entry) => [entry.productId, entry._sum.quantity ?? 0]));
  return products.map((product) => presentProduct(product, reservedByProduct.get(product.id) ?? 0));
}

export async function getPublicShopProduct(slug: string, now = new Date()) {
  assertDatabaseConfigured();
  const configuration = parseShopConfiguration();
  if (!configuration.enabled) return null;
  const product = await prisma.product.findFirst({
    where: {
      slug,
      status: "PUBLISHED",
      priceCents: { not: null },
      assets: { some: productImageWhere },
    },
    select: publicProductSelect,
  });
  if (!product) return null;
  const aggregate = await prisma.stockReservation.aggregate({
    where: { productId: product.id, status: "ACTIVE", expiresAt: { gt: now } },
    _sum: { quantity: true },
  });
  return presentProduct(product, aggregate._sum.quantity ?? 0);
}

async function lock(transaction: Transaction, key: string) {
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key})) IS NULL AS locked`;
}

async function withShopTransaction<T>(operation: (transaction: Transaction) => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: "ReadCommitted" });
    } catch (error) {
      lastError = error;
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      if (code !== "P2034") throw error;
    }
  }
  throw lastError;
}

async function nextShopOrderNumber(transaction: Transaction, now: Date) {
  const values = await transaction.$queryRaw<Array<{ value: bigint }>>`
    SELECT nextval('lnx_shop_order_number_seq') AS value
  `;
  const value = values[0]?.value;
  if (value === undefined) {
    throw new ShopServiceError(
      "Le numéro de commande n’a pas pu être généré.",
      "NUMBER_GENERATION_FAILED",
      500,
    );
  }
  return `LNX-SHOP-${now.getUTCFullYear()}-${value.toString().padStart(6, "0")}`;
}

async function resolveProducts(
  transaction: Transaction,
  intent: ShopOrderIntent,
  now: Date,
) {
  const productIds = intent.items.map(({ productId }) => productId).sort();
  for (const productId of productIds) await lock(transaction, `shop-product:${productId}`);
  const products = await transaction.product.findMany({
    where: { id: { in: productIds } },
    select: orderProductSelect,
  });
  const byId = new Map(products.map((product) => [product.id, product]));
  const lines = [];
  for (const [position, item] of intent.items.entries()) {
    const product = byId.get(item.productId);
    const productImageCount = product
      ? await transaction.productAsset.count({
          where: { productId: product.id, ...productImageWhere },
        })
      : 0;
    if (
      !product
      || product.status !== "PUBLISHED"
      || product.currency !== "EUR"
      || !Number.isSafeInteger(product.priceCents)
      || (product.priceCents ?? 0) <= 0
      || productImageCount !== 1
    ) {
      throw new ShopServiceError(
        "Un produit du panier n’est plus disponible.",
        "PRODUCT_UNAVAILABLE",
        409,
        item.productId,
      );
    }
    if (product.lockVersion !== item.observedLockVersion) {
      throw new ShopServiceError(
        "Le prix ou la disponibilité de ce produit a changé. Vérifiez votre panier.",
        "PRODUCT_CHANGED",
        409,
        product.id,
      );
    }
    const activeReserved = await activeReservedQuantity(transaction, product.id, now);
    const available = getAvailableProductQuantity({
      trackInventory: product.trackInventory,
      stock: product.stock,
      activeReserved,
    });
    if (available !== null && item.quantity > available) {
      throw new ShopServiceError(
        "Ce produit vient d’être épuisé.",
        "OUT_OF_STOCK",
        409,
        product.id,
      );
    }
    const lineTotalCents = checkedMoney((product.priceCents ?? 0) * item.quantity);
    const unitShippingWeightGrams = product.shippingRequired ? product.shippingWeightGrams : null;
    if (product.shippingRequired && unitShippingWeightGrams === null) {
      throw new ShopServiceError(
        "Le poids logistique de ce produit doit être renseigné avant la commande.",
        "SHIPPING_WEIGHT_REQUIRED",
        409,
        product.id,
      );
    }
    const lineShippingWeightGrams = unitShippingWeightGrams === null
      ? null
      : unitShippingWeightGrams * item.quantity;
    lines.push({
      position,
      product,
      quantity: item.quantity,
      lineTotalCents,
      unitShippingWeightGrams,
      lineShippingWeightGrams,
    });
  }
  return lines;
}

async function resolveShippingQuote(
  transaction: Transaction,
  lines: Awaited<ReturnType<typeof resolveProducts>>,
  intent: ShopOrderIntent,
  allowedCountries: readonly string[],
) {
  const shippingRequired = lines.some(({ product }) => product.shippingRequired);
  if (!shippingRequired) {
    return { shippingRequired: false as const, address: null, quote: null, shippingCents: 0 };
  }
  const address = assertShippingAddress(intent.shippingAddress, allowedCountries);
  try {
    const quote = await quoteVersionedShopShipping(transaction, {
      destinationCountryCode: address.countryCode,
      lines: lines.map(({ product, quantity }) => ({
        productId: product.id,
        shippingRequired: product.shippingRequired,
        shippingWeightGrams: product.shippingWeightGrams,
        quantity,
      })),
    });
    return {
      shippingRequired: true as const,
      address,
      quote,
      shippingCents: quote.amountCents,
    };
  } catch (error) {
    if (error instanceof ShopShippingServiceError) {
      throw new ShopServiceError(
        error.message,
        "SHIPPING_CONFIGURATION_REQUIRED",
        503,
      );
    }
    throw error;
  }
}

export async function quoteShopOrderShipping(
  actor: ShopOrderActor,
  quoteIntent: ShopShippingQuoteIntent,
  now = new Date(),
) {
  assertDatabaseConfigured();
  assertMember(actor);
  const configuration = configurationForCreation();
  return withShopTransaction(async (transaction) => {
    const intent: ShopOrderIntent = {
      items: quoteIntent.items,
      shippingAddress: null,
      shippingQuoteVersion: null,
    };
    const lines = await resolveProducts(transaction, intent, now);
    const subtotalCents = checkedMoney(...lines.map(({ lineTotalCents }) => lineTotalCents));
    const shippingRequired = lines.some(({ product }) => product.shippingRequired);
    const destinationCountryCode = configuration.allowedCountries.length === 1
      ? configuration.allowedCountries[0]
      : null;
    if (shippingRequired && !destinationCountryCode) {
      throw new ShopServiceError(
        "La destination de livraison ne peut pas être déterminée automatiquement.",
        "SHIPPING_CONFIGURATION_REQUIRED",
        503,
      );
    }
    let shipping: Awaited<ReturnType<typeof quoteVersionedShopShipping>> | null = null;
    if (shippingRequired) {
      try {
        shipping = await quoteVersionedShopShipping(transaction, {
          destinationCountryCode: destinationCountryCode!,
          lines: lines.map(({ product, quantity }) => ({
            productId: product.id,
            shippingRequired: product.shippingRequired,
            shippingWeightGrams: product.shippingWeightGrams,
            quantity,
          })),
        });
      } catch (error) {
        if (error instanceof ShopShippingServiceError) {
          throw new ShopServiceError(error.message, "SHIPPING_CONFIGURATION_REQUIRED", 503);
        }
        throw error;
      }
    }
    const shippingCents = shipping?.amountCents ?? 0;
    return Object.freeze({
      subtotalCents,
      shippingCents,
      totalCents: checkedMoney(subtotalCents, shippingCents),
      currency: "EUR" as const,
      shippingRequired,
      shippingQuoteVersion: shipping?.version ?? null,
      shippingMethod: shipping?.service ?? null,
      shippingWeightGrams: shipping?.productWeightGrams ?? null,
      shippingPhysicalGrams: shipping?.physicalWeightGrams ?? null,
      shippingBillableGrams: shipping?.billableWeightGrams ?? null,
      shippingTierMaxGrams: shipping?.tierMaximumWeightGrams ?? null,
    });
  });
}

export async function createShopOrder(
  actor: ShopOrderActor,
  intent: ShopOrderIntent,
  creationToken: string,
  now = new Date(),
) {
  assertDatabaseConfigured();
  assertMember(actor);
  const configuration = configurationForCreation();
  const fingerprint = shopOrderIntentFingerprint(intent);

  const outcome = await withShopTransaction(async (transaction) => {
    await lock(transaction, `shop-order:create:${actor.id}:${creationToken}`);
    const existing = await transaction.shopOrder.findUnique({
      where: { userId_creationToken: { userId: actor.id, creationToken } },
      select: { id: true, requestFingerprintSha256: true },
    });
    if (existing) {
      if (existing.requestFingerprintSha256 !== fingerprint) {
        throw new ShopServiceError(
          "Cette clé de création a déjà été utilisée pour un autre panier.",
          "IDEMPOTENCY_CONFLICT",
          409,
        );
      }
      return { orderId: existing.id, created: false } as const;
    }

    await lock(transaction, `shop-order:rate-limit:${actor.id}`);
    await enforceShopOrderRateLimitInTransaction(transaction, actor.id, now.getTime());

    const lines = await resolveProducts(transaction, intent, now);
    const shipping = await resolveShippingQuote(
      transaction,
      lines,
      intent,
      configuration.allowedCountries,
    );
    if (shipping.shippingRequired && intent.shippingQuoteVersion !== shipping.quote.version) {
      throw new ShopServiceError(
        "Le devis de livraison a changé. Recalculez-le avant de préparer la commande.",
        "SHIPPING_QUOTE_CHANGED",
        409,
      );
    }
    if (!shipping.shippingRequired && intent.shippingQuoteVersion !== null) {
      throw new ShopServiceError(
        "Le devis de livraison ne correspond pas au panier.",
        "SHIPPING_QUOTE_CHANGED",
        409,
      );
    }
    const { shippingRequired, address, quote, shippingCents } = shipping;
    const subtotalCents = checkedMoney(...lines.map(({ lineTotalCents }) => lineTotalCents));
    const totalCents = checkedMoney(subtotalCents, shippingCents);
    const reservationExpiresAt = new Date(now.getTime() + configuration.reservationTtlMinutes * 60_000);
    const orderNumber = await nextShopOrderNumber(transaction, now);
    const created = await transaction.shopOrder.create({
      data: {
        orderNumber,
        userId: actor.id,
        creationToken,
        requestFingerprintSha256: fingerprint,
        currency: "EUR",
        subtotalCents,
        shippingCents,
        totalCents,
        shippingRequired,
        shippingFirstName: address?.firstName ?? null,
        shippingLastName: address?.lastName ?? null,
        shippingAddressLine1: address?.addressLine1 ?? null,
        shippingAddressLine2: address?.addressLine2 ?? null,
        shippingPostalCode: address?.postalCode ?? null,
        shippingCity: address?.city ?? null,
        shippingCountryCode: address?.countryCode ?? null,
        shippingRateVersionId: quote?.rateVersionId ?? null,
        shippingQuoteVersion: quote?.version ?? null,
        shippingMethod: quote?.service ?? null,
        shippingWeightGrams: quote?.productWeightGrams ?? null,
        shippingPackagingGrams: quote?.packagingWeightGrams ?? null,
        shippingPhysicalGrams: quote?.physicalWeightGrams ?? null,
        shippingBillableGrams: quote?.billableWeightGrams ?? null,
        shippingTierMaxGrams: quote?.tierMaximumWeightGrams ?? null,
        packagingProfileId: quote?.packagingProfileId ?? null,
        packagingProfileVersion: quote?.packagingProfileVersion ?? null,
        shippingWeightPolicy: quote?.billableWeightPolicy ?? null,
        reservationExpiresAt,
      },
    });

    await transaction.shopOrderEvent.create({
      data: {
        shopOrderId: created.id,
        type: "SHOP_ORDER_CREATED",
        actorUserId: actor.id,
        metadata: {
          lineCount: lines.length,
          shippingRequired,
          shippingQuoteVersion: quote?.version ?? null,
          shippingWeightGrams: quote?.productWeightGrams ?? null,
          shippingPhysicalGrams: quote?.physicalWeightGrams ?? null,
          shippingBillableGrams: quote?.billableWeightGrams ?? null,
          shippingTierMaxGrams: quote?.tierMaximumWeightGrams ?? null,
          packagingProfileVersion: quote?.packagingProfileVersion ?? null,
          shippingWeightPolicy: quote?.billableWeightPolicy ?? null,
          shippingCents,
        },
      },
    });
    for (const line of lines) {
      await transaction.shopOrderItem.create({
        data: {
          shopOrderId: created.id,
          productId: line.product.id,
          position: line.position,
          productTitle: line.product.title,
          inventoryTracked: line.product.trackInventory,
          unitPriceCents: line.product.priceCents!,
          quantity: line.quantity,
          lineTotalCents: line.lineTotalCents,
          shippingRequired: line.product.shippingRequired,
          unitShippingCents: 0,
          lineShippingCents: 0,
          unitShippingWeightGrams: line.unitShippingWeightGrams,
          lineShippingWeightGrams: line.lineShippingWeightGrams,
          currency: "EUR",
        },
      });
      if (!line.product.trackInventory) continue;
      const reservation = await transaction.stockReservation.create({
        data: {
          shopOrderId: created.id,
          productId: line.product.id,
          quantity: line.quantity,
          expiresAt: reservationExpiresAt,
        },
      });
      await transaction.shopOrderEvent.create({
        data: {
          shopOrderId: created.id,
          stockReservationId: reservation.id,
          type: "STOCK_RESERVED",
          actorUserId: actor.id,
          metadata: { productId: line.product.id, quantity: line.quantity },
        },
      });
    }
    return { orderId: created.id, created: true } as const;
  });

  const order = await prisma.shopOrder.findUniqueOrThrow({
    where: { id: outcome.orderId },
    include: shopOrderDetailInclude,
  });
  const reservations = order.items.flatMap(({ reservation }) => reservation ? [reservation] : []);
  const reservationCount = reservations.length;
  if (outcome.created) {
    console.info(JSON.stringify({
      event: "shop.order.created",
      shopOrderId: order.id,
      orderNumber: order.orderNumber,
      reservationCount,
    }));
    if (reservationCount) {
      console.info(JSON.stringify({
        event: "shop.stock.reserved",
        shopOrderId: order.id,
        orderNumber: order.orderNumber,
        reservations: reservationCount,
        units: reservations.reduce((total, reservation) => total + reservation.quantity, 0),
      }));
    }
  }
  return order;
}

export async function enforceShopOrderRateLimit(actorId: string, now = Date.now()) {
  assertDatabaseConfigured();
  await withShopTransaction((transaction) =>
    enforceShopOrderRateLimitInTransaction(transaction, actorId, now));
}

export async function listMemberShopOrders(userId: string) {
  assertDatabaseConfigured();
  return prisma.shopOrder.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { items: { orderBy: { position: "asc" } } },
  });
}

export async function getMemberShopOrder(userId: string, orderNumber: string) {
  assertDatabaseConfigured();
  return prisma.shopOrder.findFirst({
    where: { userId, orderNumber },
    include: shopOrderDetailInclude,
  });
}

export async function cancelMemberShopOrder(userId: string, orderNumber: string, now = new Date()) {
  assertDatabaseConfigured();
  const order = await prisma.shopOrder.findFirst({
    where: { userId, orderNumber },
    select: { id: true },
  });
  if (!order) throw new ShopServiceError("Commande introuvable.", "ORDER_NOT_FOUND", 404);
  return releaseShopOrderReservation(order.id, now);
}

export async function listAdminShopOrders(status?: "OPEN" | "EXPIRED" | "CANCELLED") {
  assertDatabaseConfigured();
  return prisma.shopOrder.findMany({
    where: status ? { status } : undefined,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      orderNumber: true,
      userId: true,
      status: true,
      paymentStatus: true,
      paymentReviewAt: true,
      fulfillmentStatus: true,
      totalCents: true,
      currency: true,
      reservationExpiresAt: true,
      createdAt: true,
      _count: { select: { items: true } },
    },
  });
}

export async function getAdminShopOrder(orderNumber: string) {
  assertDatabaseConfigured();
  return prisma.shopOrder.findUnique({
    where: { orderNumber },
    include: {
      ...shopOrderDetailInclude,
      user: { select: { id: true, displayName: true, email: true } },
      shippingProviderAttempts: {
        orderBy: [{ attemptNumber: "desc" }, { id: "desc" }],
      },
    },
  });
}

export async function releaseShopOrderReservation(shopOrderId: string, now = new Date()) {
  assertDatabaseConfigured();
  const outcome = await withShopTransaction(async (transaction) => {
    // Payment reconciliation uses this same parent lock. The row lock is kept as
    // a second database-level boundary for checkout/cancellation paths that
    // address the order by its public number before resolving its UUID.
    await lock(transaction, `shop-payments:order:${shopOrderId}`);
    const locked = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "shop_orders"
      WHERE "id" = ${shopOrderId}::uuid
      FOR UPDATE
    `;
    if (locked.length !== 1) throw new ShopServiceError("Commande introuvable.", "ORDER_NOT_FOUND", 404);
    const order = await transaction.shopOrder.findUnique({
      where: { id: shopOrderId },
      select: { status: true, paymentStatus: true, paymentReviewAt: true },
    });
    if (!order) throw new ShopServiceError("Commande introuvable.", "ORDER_NOT_FOUND", 404);
    const reservations = await transaction.stockReservation.findMany({
      where: { shopOrderId },
      select: { id: true, productId: true, quantity: true, status: true },
    });
    if (order.paymentReviewAt) {
      throw new ShopServiceError(
        "Cette commande contient une preuve financière à vérifier.",
        "PAYMENT_REVIEW_REQUIRED",
        409,
      );
    }
    if (order.paymentStatus === "PAID" || reservations.some(({ status }) => status === "CONFIRMED")) {
      throw new ShopServiceError(
        "Une réservation confirmée ne peut pas être libérée.",
        "RESERVATION_CONFIRMED",
        409,
      );
    }
    const active = reservations.filter(({ status }) => status === "ACTIVE");
    for (const reservation of active) {
      const changed = await transaction.stockReservation.updateMany({
        where: { id: reservation.id, status: "ACTIVE" },
        data: { status: "RELEASED", releasedAt: now },
      });
      if (changed.count) {
        await transaction.shopOrderEvent.create({
          data: {
            shopOrderId,
            stockReservationId: reservation.id,
            type: "STOCK_RELEASED",
            metadata: { productId: reservation.productId, quantity: reservation.quantity },
          },
        });
      }
    }
    if (order.status === "OPEN") {
      await transaction.shopOrder.update({
        where: { id: shopOrderId },
        data: {
          status: "CANCELLED",
          paymentStatus: "CANCELLED",
          fulfillmentStatus: "CANCELLED",
          cancelledAt: now,
        },
      });
      await transaction.shopOrderEvent.create({
        data: { shopOrderId, type: "SHOP_ORDER_CANCELLED", metadata: { released: active.length } },
      });
    }
    return { released: active.length };
  });
  if (outcome.released) {
    console.info(JSON.stringify({
      event: "shop.stock.released",
      shopOrderId,
      reservations: outcome.released,
    }));
  }
  return outcome;
}

export async function expireShopOrderReservations(
  now = new Date(),
  batchSize = 50,
) {
  assertDatabaseConfigured();
  const size = Math.max(1, Math.min(100, Math.trunc(batchSize)));
  const outcome = await withShopTransaction(async (transaction) => {
    const candidates = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "shop_orders"
      WHERE "status" = 'OPEN'::"ShopOrderStatus"
        AND "paymentStatus" = 'AWAITING_PAYMENT'::"ShopPaymentStatus"
        AND "paymentReviewAt" IS NULL
        AND "reservationExpiresAt" <= ${now}
      ORDER BY "reservationExpiresAt" ASC, "id" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${size}
    `;
    for (const candidate of candidates) {
      const reservations = await transaction.stockReservation.findMany({
        where: { shopOrderId: candidate.id, status: "ACTIVE" },
      });
      for (const reservation of reservations) {
        const changed = await transaction.stockReservation.updateMany({
          where: { id: reservation.id, status: "ACTIVE" },
          data: { status: "EXPIRED", expiredAt: now },
        });
        if (changed.count) {
          await transaction.shopOrderEvent.create({
            data: {
              shopOrderId: candidate.id,
              stockReservationId: reservation.id,
              type: "STOCK_RESERVATION_EXPIRED",
              metadata: { productId: reservation.productId, quantity: reservation.quantity },
            },
          });
        }
      }
      const changedOrder = await transaction.shopOrder.updateMany({
        where: { id: candidate.id, status: "OPEN", paymentStatus: "AWAITING_PAYMENT" },
        data: { status: "EXPIRED", expiredAt: now },
      });
      if (changedOrder.count) {
        await transaction.shopOrderEvent.create({
          data: {
            shopOrderId: candidate.id,
            type: "SHOP_ORDER_EXPIRED",
            metadata: { reservationCount: reservations.length },
          },
        });
      }
    }
    return {
      expired: candidates.length,
      shopOrderIds: candidates.map(({ id }) => id),
    };
  });
  if (outcome.expired) {
    console.info(JSON.stringify({
      event: "shop.stock.expired",
      orders: outcome.expired,
      shopOrderIds: outcome.shopOrderIds,
    }));
  }
  return outcome.expired;
}
