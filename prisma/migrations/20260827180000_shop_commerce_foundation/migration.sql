-- V1.1.0 Phase 2: additive Boutique commerce foundations. This migration
-- introduces a ledger separate from the existing musical orders/payments.
-- It deliberately does not mutate any existing Order or Payment table.

CREATE TYPE "ShopOrderStatus" AS ENUM (
  'OPEN',
  'EXPIRED',
  'CANCELLED'
);

CREATE TYPE "ShopPaymentStatus" AS ENUM (
  'AWAITING_PAYMENT',
  'PAID',
  'CANCELLED'
);

CREATE TYPE "ShopFulfillmentStatus" AS ENUM (
  'PENDING',
  'PREPARING',
  'SHIPPED',
  'CANCELLED'
);

CREATE TYPE "ShopStockReservationStatus" AS ENUM (
  'ACTIVE',
  'CONFIRMED',
  'RELEASED',
  'EXPIRED'
);

CREATE TYPE "ShopOrderEventType" AS ENUM (
  'SHOP_ORDER_CREATED',
  'SHOP_ORDER_EXPIRED',
  'SHOP_ORDER_CANCELLED',
  'STOCK_RESERVED',
  'STOCK_CONFIRMED',
  'STOCK_RELEASED',
  'STOCK_RESERVATION_EXPIRED'
);

CREATE SEQUENCE "lnx_shop_order_number_seq"
  AS BIGINT
  START WITH 1
  INCREMENT BY 1
  NO CYCLE;

CREATE TABLE "shop_orders" (
  "id" UUID NOT NULL,
  "orderNumber" VARCHAR(32) NOT NULL,
  "userId" UUID NOT NULL,
  "creationToken" UUID NOT NULL,
  "requestFingerprintSha256" CHAR(64) NOT NULL,
  "status" "ShopOrderStatus" NOT NULL DEFAULT 'OPEN',
  "paymentStatus" "ShopPaymentStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
  "fulfillmentStatus" "ShopFulfillmentStatus" NOT NULL DEFAULT 'PENDING',
  "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
  "subtotalCents" INTEGER NOT NULL,
  "shippingCents" INTEGER NOT NULL,
  "totalCents" INTEGER NOT NULL,
  "shippingRequired" BOOLEAN NOT NULL DEFAULT false,
  "shippingFirstName" VARCHAR(100),
  "shippingLastName" VARCHAR(100),
  "shippingAddressLine1" VARCHAR(240),
  "shippingAddressLine2" VARCHAR(240),
  "shippingPostalCode" VARCHAR(32),
  "shippingCity" VARCHAR(120),
  "shippingCountryCode" CHAR(2),
  "reservationExpiresAt" TIMESTAMPTZ(3) NOT NULL,
  "paidAt" TIMESTAMPTZ(3),
  "expiredAt" TIMESTAMPTZ(3),
  "cancelledAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "shop_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shop_orders_number_format" CHECK (
    "orderNumber" ~ '^LNX-SHOP-[0-9]{4}-[0-9]{6,}$'
  ),
  CONSTRAINT "shop_orders_fingerprint_sha256" CHECK (
    "requestFingerprintSha256" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "shop_orders_currency_eur" CHECK ("currency" = 'EUR'),
  CONSTRAINT "shop_orders_amounts_valid" CHECK (
    "subtotalCents" > 0
    AND "subtotalCents" <= 100000000
    AND "shippingCents" >= 0
    AND "shippingCents" <= 100000000
    AND "totalCents" > 0
    AND "totalCents" <= 100000000
    AND "totalCents"::BIGINT =
      "subtotalCents"::BIGINT + "shippingCents"::BIGINT
  ),
  CONSTRAINT "shop_orders_shipping_amount_consistent" CHECK (
    "shippingRequired" OR "shippingCents" = 0
  ),
  CONSTRAINT "shop_orders_shipping_address_complete" CHECK (
    (
      NOT "shippingRequired"
      AND "shippingFirstName" IS NULL
      AND "shippingLastName" IS NULL
      AND "shippingAddressLine1" IS NULL
      AND "shippingAddressLine2" IS NULL
      AND "shippingPostalCode" IS NULL
      AND "shippingCity" IS NULL
      AND "shippingCountryCode" IS NULL
    )
    OR
    (
      "shippingRequired"
      AND "shippingFirstName" IS NOT NULL
      AND btrim("shippingFirstName") <> ''
      AND "shippingLastName" IS NOT NULL
      AND btrim("shippingLastName") <> ''
      AND "shippingAddressLine1" IS NOT NULL
      AND btrim("shippingAddressLine1") <> ''
      AND ("shippingAddressLine2" IS NULL OR btrim("shippingAddressLine2") <> '')
      AND "shippingPostalCode" IS NOT NULL
      AND btrim("shippingPostalCode") <> ''
      AND "shippingCity" IS NOT NULL
      AND btrim("shippingCity") <> ''
      AND "shippingCountryCode" IS NOT NULL
      AND "shippingCountryCode" ~ '^[A-Z]{2}$'
    )
  ),
  CONSTRAINT "shop_orders_reservation_expiry_valid" CHECK (
    "reservationExpiresAt" > "createdAt"
  ),
  CONSTRAINT "shop_orders_status_timestamps" CHECK (
    (
      "status" = 'OPEN'
      AND "expiredAt" IS NULL
      AND "cancelledAt" IS NULL
    )
    OR
    (
      "status" = 'EXPIRED'
      AND "expiredAt" IS NOT NULL
      AND "cancelledAt" IS NULL
    )
    OR
    (
      "status" = 'CANCELLED'
      AND "expiredAt" IS NULL
      AND "cancelledAt" IS NOT NULL
    )
  ),
  CONSTRAINT "shop_orders_payment_timestamp" CHECK (
    (
      "paymentStatus" = 'AWAITING_PAYMENT'
      AND "paidAt" IS NULL
    )
    OR
    (
      "paymentStatus" = 'PAID'
      AND "paidAt" IS NOT NULL
    )
    OR
    (
      "paymentStatus" = 'CANCELLED'
      AND "paidAt" IS NULL
    )
  ),
  CONSTRAINT "shop_orders_lifecycle_consistent" CHECK (
    (("status" = 'CANCELLED') = ("paymentStatus" = 'CANCELLED'))
    AND (("status" = 'CANCELLED') = ("fulfillmentStatus" = 'CANCELLED'))
    AND (
      "status" <> 'EXPIRED'
      OR (
        "paymentStatus" = 'AWAITING_PAYMENT'
        AND "fulfillmentStatus" = 'PENDING'
      )
    )
    AND (
      "fulfillmentStatus" NOT IN ('PREPARING', 'SHIPPED')
      OR "paymentStatus" = 'PAID'
    )
  ),
  CONSTRAINT "shop_orders_timestamps_valid" CHECK (
    ("paidAt" IS NULL OR "paidAt" >= "createdAt")
    AND ("expiredAt" IS NULL OR "expiredAt" >= "reservationExpiresAt")
    AND ("cancelledAt" IS NULL OR "cancelledAt" >= "createdAt")
  )
);

CREATE UNIQUE INDEX "shop_orders_orderNumber_key"
  ON "shop_orders"("orderNumber");
CREATE UNIQUE INDEX "shop_orders_userId_creationToken_key"
  ON "shop_orders"("userId", "creationToken");
CREATE INDEX "shop_orders_userId_createdAt_idx"
  ON "shop_orders"("userId", "createdAt");
CREATE INDEX "shop_orders_status_paymentStatus_reservationExpiresAt_idx"
  ON "shop_orders"("status", "paymentStatus", "reservationExpiresAt");
CREATE INDEX "shop_orders_fulfillmentStatus_createdAt_idx"
  ON "shop_orders"("fulfillmentStatus", "createdAt");
CREATE INDEX "shop_orders_open_awaiting_expiry_idx"
  ON "shop_orders"("reservationExpiresAt")
  WHERE "status" = 'OPEN' AND "paymentStatus" = 'AWAITING_PAYMENT';

CREATE TABLE "shop_order_items" (
  "shopOrderId" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "productTitle" VARCHAR(240) NOT NULL,
  "inventoryTracked" BOOLEAN NOT NULL,
  "unitPriceCents" INTEGER NOT NULL,
  "quantity" INTEGER NOT NULL,
  "lineTotalCents" INTEGER NOT NULL,
  "shippingRequired" BOOLEAN NOT NULL,
  "unitShippingCents" INTEGER NOT NULL,
  "lineShippingCents" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "shop_order_items_pkey" PRIMARY KEY ("shopOrderId", "productId"),
  CONSTRAINT "shop_order_items_position_valid" CHECK (
    "position" >= 0 AND "position" < 20
  ),
  CONSTRAINT "shop_order_items_title_nonempty" CHECK (
    btrim("productTitle") <> ''
  ),
  CONSTRAINT "shop_order_items_quantity_valid" CHECK (
    "quantity" >= 1 AND "quantity" <= 20
  ),
  CONSTRAINT "shop_order_items_currency_eur" CHECK ("currency" = 'EUR'),
  CONSTRAINT "shop_order_items_amounts_valid" CHECK (
    "unitPriceCents" > 0
    AND "unitPriceCents" <= 100000000
    AND "lineTotalCents" > 0
    AND "lineTotalCents" <= 100000000
    AND "lineTotalCents"::BIGINT =
      "unitPriceCents"::BIGINT * "quantity"::BIGINT
    AND "unitShippingCents" >= 0
    AND "unitShippingCents" <= 100000000
    AND "lineShippingCents" >= 0
    AND "lineShippingCents" <= 100000000
    AND "lineShippingCents"::BIGINT =
      "unitShippingCents"::BIGINT * "quantity"::BIGINT
  ),
  CONSTRAINT "shop_order_items_shipping_consistent" CHECK (
    "shippingRequired"
    OR ("unitShippingCents" = 0 AND "lineShippingCents" = 0)
  )
);

CREATE UNIQUE INDEX "shop_order_items_shopOrderId_productId_quantity_key"
  ON "shop_order_items"("shopOrderId", "productId", "quantity");
CREATE UNIQUE INDEX "shop_order_items_shopOrderId_position_key"
  ON "shop_order_items"("shopOrderId", "position");
CREATE INDEX "shop_order_items_productId_idx"
  ON "shop_order_items"("productId");

CREATE TABLE "stock_reservations" (
  "id" UUID NOT NULL,
  "shopOrderId" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "status" "ShopStockReservationStatus" NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "confirmedAt" TIMESTAMPTZ(3),
  "releasedAt" TIMESTAMPTZ(3),
  "expiredAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_reservations_quantity_valid" CHECK (
    "quantity" >= 1 AND "quantity" <= 20
  ),
  CONSTRAINT "stock_reservations_expiry_valid" CHECK (
    "expiresAt" > "createdAt"
  ),
  CONSTRAINT "stock_reservations_status_timestamps" CHECK (
    (
      "status" = 'ACTIVE'
      AND "confirmedAt" IS NULL
      AND "releasedAt" IS NULL
      AND "expiredAt" IS NULL
    )
    OR
    (
      "status" = 'CONFIRMED'
      AND "confirmedAt" IS NOT NULL
      AND "releasedAt" IS NULL
      AND "expiredAt" IS NULL
    )
    OR
    (
      "status" = 'RELEASED'
      AND "confirmedAt" IS NULL
      AND "releasedAt" IS NOT NULL
      AND "expiredAt" IS NULL
    )
    OR
    (
      "status" = 'EXPIRED'
      AND "confirmedAt" IS NULL
      AND "releasedAt" IS NULL
      AND "expiredAt" IS NOT NULL
    )
  ),
  CONSTRAINT "stock_reservations_timestamps_valid" CHECK (
    ("confirmedAt" IS NULL OR "confirmedAt" >= "createdAt")
    AND ("releasedAt" IS NULL OR "releasedAt" >= "createdAt")
    AND ("expiredAt" IS NULL OR "expiredAt" >= "expiresAt")
  )
);

CREATE UNIQUE INDEX "stock_reservations_shopOrderId_productId_key"
  ON "stock_reservations"("shopOrderId", "productId");
CREATE UNIQUE INDEX "stock_reservations_shopOrderId_productId_quantity_key"
  ON "stock_reservations"("shopOrderId", "productId", "quantity");
CREATE INDEX "stock_reservations_productId_status_expiresAt_idx"
  ON "stock_reservations"("productId", "status", "expiresAt");
CREATE INDEX "stock_reservations_status_expiresAt_idx"
  ON "stock_reservations"("status", "expiresAt");
CREATE INDEX "stock_reservations_active_product_expiresAt_idx"
  ON "stock_reservations"("productId", "expiresAt")
  WHERE "status" = 'ACTIVE';
CREATE INDEX "stock_reservations_active_expiresAt_idx"
  ON "stock_reservations"("expiresAt")
  WHERE "status" = 'ACTIVE';

CREATE TABLE "shop_order_events" (
  "id" UUID NOT NULL,
  "shopOrderId" UUID NOT NULL,
  "stockReservationId" UUID,
  "type" "ShopOrderEventType" NOT NULL,
  "actorUserId" UUID,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "shop_order_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shop_order_events_metadata_object" CHECK (
    jsonb_typeof("metadata") = 'object'
  ),
  CONSTRAINT "shop_order_events_reservation_scope" CHECK (
    (
      "type" IN (
        'STOCK_RESERVED',
        'STOCK_CONFIRMED',
        'STOCK_RELEASED',
        'STOCK_RESERVATION_EXPIRED'
      )
      AND "stockReservationId" IS NOT NULL
    )
    OR
    (
      "type" IN (
        'SHOP_ORDER_CREATED',
        'SHOP_ORDER_EXPIRED',
        'SHOP_ORDER_CANCELLED'
      )
      AND "stockReservationId" IS NULL
    )
  )
);

CREATE INDEX "shop_order_events_shopOrderId_occurredAt_idx"
  ON "shop_order_events"("shopOrderId", "occurredAt");
CREATE INDEX "shop_order_events_stockReservationId_occurredAt_idx"
  ON "shop_order_events"("stockReservationId", "occurredAt");
CREATE INDEX "shop_order_events_actorUserId_idx"
  ON "shop_order_events"("actorUserId");
CREATE UNIQUE INDEX "shop_order_events_order_type_once_key"
  ON "shop_order_events"("shopOrderId", "type")
  WHERE "stockReservationId" IS NULL;
CREATE UNIQUE INDEX "shop_order_events_reservation_type_once_key"
  ON "shop_order_events"("stockReservationId", "type")
  WHERE "stockReservationId" IS NOT NULL;

ALTER TABLE "shop_orders"
  ADD CONSTRAINT "shop_orders_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shop_order_items"
  ADD CONSTRAINT "shop_order_items_shopOrderId_fkey"
  FOREIGN KEY ("shopOrderId") REFERENCES "shop_orders"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shop_order_items"
  ADD CONSTRAINT "shop_order_items_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_reservations"
  ADD CONSTRAINT "stock_reservations_item_fkey"
  FOREIGN KEY ("shopOrderId", "productId", "quantity")
  REFERENCES "shop_order_items"("shopOrderId", "productId", "quantity")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shop_order_events"
  ADD CONSTRAINT "shop_order_events_shopOrderId_fkey"
  FOREIGN KEY ("shopOrderId") REFERENCES "shop_orders"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shop_order_events"
  ADD CONSTRAINT "shop_order_events_stockReservationId_fkey"
  FOREIGN KEY ("stockReservationId") REFERENCES "stock_reservations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shop_order_events"
  ADD CONSTRAINT "shop_order_events_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
