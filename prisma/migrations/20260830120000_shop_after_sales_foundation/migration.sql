-- V1.1.0 Phase 5B: additive, local-only Shop after-sales foundation.
-- Financial refunds remain fail-closed and stock restoration is a distinct,
-- explicit, audited operation.

ALTER TYPE "OrderNotificationKind" ADD VALUE 'OWNER_SHOP_RETURN_REQUESTED';
ALTER TYPE "OrderNotificationKind" ADD VALUE 'CUSTOMER_SHOP_RETURN_APPROVED';
ALTER TYPE "OrderNotificationKind" ADD VALUE 'CUSTOMER_SHOP_RETURN_REJECTED';
ALTER TYPE "OrderNotificationKind" ADD VALUE 'CUSTOMER_SHOP_RETURN_RECEIVED';
ALTER TYPE "OrderNotificationKind" ADD VALUE 'CUSTOMER_SHOP_REFUND_CONFIRMED';

CREATE TYPE "ShopReturnRequestType" AS ENUM (
  'WITHDRAWAL',
  'DEFECTIVE',
  'NON_CONFORMING',
  'DAMAGED',
  'LOGISTICS_INCIDENT',
  'OTHER'
);

CREATE TYPE "ShopReturnRequestStatus" AS ENUM (
  'REQUESTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'AWAITING_RETURN',
  'RETURN_RECEIVED',
  'INSPECTED',
  'REFUND_PENDING',
  'REFUNDED',
  'CLOSED',
  'CANCELLED'
);

CREATE TYPE "ShopReturnInspectionCondition" AS ENUM (
  'SEALED',
  'UNSEALED',
  'DAMAGED',
  'DEFECTIVE',
  'OTHER'
);

CREATE TYPE "ShopReturnRestockDecision" AS ENUM (
  'UNDECIDED',
  'RESTOCKABLE',
  'NOT_RESTOCKABLE'
);

CREATE TYPE "ShopReturnRefundStatus" AS ENUM (
  'NOT_REQUESTED',
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'REQUIRES_REVIEW'
);

CREATE TYPE "ShopReturnCostDecision" AS ENUM (
  'UNDECIDED',
  'CUSTOMER',
  'MERCHANT',
  'MANUAL_REVIEW'
);

CREATE TYPE "ShopReturnAuditAction" AS ENUM (
  'REQUEST_CREATED',
  'REVIEW_STARTED',
  'REQUEST_APPROVED',
  'REQUEST_REJECTED',
  'REQUEST_CANCELLED',
  'RETURN_RECEIVED',
  'INSPECTION_RECORDED',
  'REFUND_REQUESTED',
  'REFUND_CONFIRMED',
  'REFUND_FAILED',
  'REFUND_REQUIRES_REVIEW',
  'RESTOCK_COMPLETED',
  'REQUEST_CLOSED'
);

ALTER TABLE "order_notifications"
  ADD COLUMN "shopReturnRequestId" UUID;
CREATE INDEX "order_notifications_shopReturnRequestId_kind_channel_idx"
  ON "order_notifications"("shopReturnRequestId", "kind", "channel");

CREATE UNIQUE INDEX "shop_orders_id_userId_key"
  ON "shop_orders"("id", "userId");

CREATE TABLE "shop_return_requests" (
  "id" UUID NOT NULL,
  "requestNumber" VARCHAR(32) NOT NULL,
  "shopOrderId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "withdrawalRequestId" UUID,
  "type" "ShopReturnRequestType" NOT NULL,
  "status" "ShopReturnRequestStatus" NOT NULL DEFAULT 'REQUESTED',
  "customerComment" VARCHAR(1000),
  "adminComment" VARCHAR(1000),
  "physicalReturnRequired" BOOLEAN,
  "returnCostDecision" "ShopReturnCostDecision" NOT NULL DEFAULT 'UNDECIDED',
  "returnInstructions" VARCHAR(2000),
  "refundStatus" "ShopReturnRefundStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
  "itemsRefundCents" INTEGER NOT NULL DEFAULT 0,
  "shippingRefundCents" INTEGER NOT NULL DEFAULT 0,
  "totalRefundCents" INTEGER NOT NULL DEFAULT 0,
  "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMPTZ(3),
  "reviewedByUserId" UUID,
  "authorizedAt" TIMESTAMPTZ(3),
  "receivedAt" TIMESTAMPTZ(3),
  "inspectedAt" TIMESTAMPTZ(3),
  "refundRequestedAt" TIMESTAMPTZ(3),
  "refundedAt" TIMESTAMPTZ(3),
  "closedAt" TIMESTAMPTZ(3),
  "cancelledAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "shop_return_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shop_return_requests_refund_amounts_valid" CHECK (
    "itemsRefundCents" >= 0
    AND "shippingRefundCents" >= 0
    AND "totalRefundCents" = "itemsRefundCents" + "shippingRefundCents"
  ),
  CONSTRAINT "shop_return_requests_cancellation_valid" CHECK (
    ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL)
    OR ("status" <> 'CANCELLED')
  ),
  CONSTRAINT "shop_return_requests_refund_proof_valid" CHECK (
    ("refundStatus" = 'SUCCEEDED' AND "refundedAt" IS NOT NULL AND "totalRefundCents" > 0)
    OR ("refundStatus" <> 'SUCCEEDED')
  )
);

CREATE UNIQUE INDEX "shop_return_requests_requestNumber_key"
  ON "shop_return_requests"("requestNumber");
CREATE UNIQUE INDEX "shop_return_requests_withdrawalRequestId_key"
  ON "shop_return_requests"("withdrawalRequestId");
CREATE UNIQUE INDEX "shop_return_requests_id_shopOrderId_key"
  ON "shop_return_requests"("id", "shopOrderId");
CREATE INDEX "shop_return_requests_shopOrderId_requestedAt_idx"
  ON "shop_return_requests"("shopOrderId", "requestedAt");
CREATE INDEX "shop_return_requests_userId_requestedAt_idx"
  ON "shop_return_requests"("userId", "requestedAt");
CREATE INDEX "shop_return_requests_status_requestedAt_idx"
  ON "shop_return_requests"("status", "requestedAt");
CREATE INDEX "shop_return_requests_reviewedByUserId_idx"
  ON "shop_return_requests"("reviewedByUserId");

CREATE TABLE "shop_return_items" (
  "id" UUID NOT NULL,
  "shopReturnRequestId" UUID NOT NULL,
  "shopOrderId" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "productTitle" VARCHAR(240) NOT NULL,
  "unitPriceCents" INTEGER NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
  "requestedQuantity" INTEGER NOT NULL,
  "authorizedQuantity" INTEGER NOT NULL DEFAULT 0,
  "receivedQuantity" INTEGER NOT NULL DEFAULT 0,
  "refundableQuantity" INTEGER NOT NULL DEFAULT 0,
  "refundQuantity" INTEGER NOT NULL DEFAULT 0,
  "restockDecision" "ShopReturnRestockDecision" NOT NULL DEFAULT 'UNDECIDED',
  "restockableQuantity" INTEGER NOT NULL DEFAULT 0,
  "restockedQuantity" INTEGER NOT NULL DEFAULT 0,
  "inspectionCondition" "ShopReturnInspectionCondition",
  "inspectionComment" VARCHAR(1000),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "shop_return_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shop_return_items_financial_snapshot_valid" CHECK (
    "unitPriceCents" > 0 AND "currency" = 'EUR'
  ),
  CONSTRAINT "shop_return_items_quantities_bounded" CHECK (
    "requestedQuantity" > 0
    AND "authorizedQuantity" >= 0
    AND "authorizedQuantity" <= "requestedQuantity"
    AND "receivedQuantity" >= 0
    AND "receivedQuantity" <= "authorizedQuantity"
    AND "refundableQuantity" >= 0
    AND "refundableQuantity" <= "authorizedQuantity"
    AND "refundQuantity" >= 0
    AND "refundQuantity" <= "refundableQuantity"
    AND "restockableQuantity" >= 0
    AND "restockableQuantity" <= "receivedQuantity"
    AND "restockedQuantity" >= 0
    AND "restockedQuantity" <= "restockableQuantity"
  ),
  CONSTRAINT "shop_return_items_restock_decision_valid" CHECK (
    ("restockDecision" = 'RESTOCKABLE' AND "restockableQuantity" > 0)
    OR ("restockDecision" = 'NOT_RESTOCKABLE' AND "restockableQuantity" = 0)
    OR ("restockDecision" = 'UNDECIDED' AND "restockableQuantity" = 0 AND "restockedQuantity" = 0)
  )
);

CREATE UNIQUE INDEX "shop_return_items_request_product_key"
  ON "shop_return_items"("shopReturnRequestId", "productId");
CREATE INDEX "shop_return_items_order_product_idx"
  ON "shop_return_items"("shopOrderId", "productId");

CREATE TABLE "shop_return_audit_events" (
  "id" UUID NOT NULL,
  "shopReturnRequestId" UUID NOT NULL,
  "actorUserId" UUID,
  "action" "ShopReturnAuditAction" NOT NULL,
  "idempotencyKey" VARCHAR(255),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "shop_return_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shop_return_audit_events_idempotencyKey_key"
  ON "shop_return_audit_events"("idempotencyKey");
CREATE INDEX "shop_return_audit_events_request_occurredAt_idx"
  ON "shop_return_audit_events"("shopReturnRequestId", "occurredAt");
CREATE INDEX "shop_return_audit_events_actorUserId_idx"
  ON "shop_return_audit_events"("actorUserId");

ALTER TABLE "refund_attempts"
  ADD COLUMN "shopReturnRequestId" UUID;
CREATE UNIQUE INDEX "refund_attempts_shopReturnRequestId_key"
  ON "refund_attempts"("shopReturnRequestId");

ALTER TABLE "credit_notes"
  ADD COLUMN "shopReturnRequestId" UUID;
CREATE UNIQUE INDEX "credit_notes_shopReturnRequestId_key"
  ON "credit_notes"("shopReturnRequestId");

ALTER TABLE "product_stock_adjustments"
  ADD COLUMN "shopReturnRequestId" UUID,
  ADD COLUMN "idempotencyKey" VARCHAR(255);
CREATE UNIQUE INDEX "product_stock_adjustments_idempotencyKey_key"
  ON "product_stock_adjustments"("idempotencyKey");
CREATE INDEX "product_stock_adjustments_shopReturnRequestId_idx"
  ON "product_stock_adjustments"("shopReturnRequestId");

ALTER TABLE "shop_return_requests"
  ADD CONSTRAINT "shop_return_requests_shopOrder_owner_fkey"
  FOREIGN KEY ("shopOrderId", "userId") REFERENCES "shop_orders"("id", "userId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "shop_return_requests_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "shop_return_requests_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "shop_return_requests_withdrawalRequestId_fkey"
  FOREIGN KEY ("withdrawalRequestId") REFERENCES "consumer_withdrawal_requests"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shop_return_items"
  ADD CONSTRAINT "shop_return_items_request_order_fkey"
  FOREIGN KEY ("shopReturnRequestId", "shopOrderId") REFERENCES "shop_return_requests"("id", "shopOrderId")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "shop_return_items_order_item_fkey"
  FOREIGN KEY ("shopOrderId", "productId") REFERENCES "shop_order_items"("shopOrderId", "productId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shop_return_audit_events"
  ADD CONSTRAINT "shop_return_audit_events_request_fkey"
  FOREIGN KEY ("shopReturnRequestId") REFERENCES "shop_return_requests"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "shop_return_audit_events_actor_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "order_notifications"
  ADD CONSTRAINT "order_notifications_shopReturnRequestId_fkey"
  FOREIGN KEY ("shopReturnRequestId") REFERENCES "shop_return_requests"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "refund_attempts"
  ADD CONSTRAINT "refund_attempts_shopReturnRequestId_fkey"
  FOREIGN KEY ("shopReturnRequestId") REFERENCES "shop_return_requests"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "credit_notes"
  ADD CONSTRAINT "credit_notes_shopReturnRequestId_fkey"
  FOREIGN KEY ("shopReturnRequestId") REFERENCES "shop_return_requests"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_stock_adjustments"
  ADD CONSTRAINT "product_stock_adjustments_shopReturnRequestId_fkey"
  FOREIGN KEY ("shopReturnRequestId") REFERENCES "shop_return_requests"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION enforce_shop_return_item_limits()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ordered_quantity INTEGER;
  committed_requested INTEGER;
  request_status "ShopReturnRequestStatus";
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(
    'shop-return-line:' || NEW."shopOrderId"::text || ':' || NEW."productId"::text
  ));

  SELECT "quantity" INTO ordered_quantity
  FROM "shop_order_items"
  WHERE "shopOrderId" = NEW."shopOrderId" AND "productId" = NEW."productId";
  IF ordered_quantity IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'shop_return_item_original_line_required';
  END IF;

  SELECT "status" INTO request_status
  FROM "shop_return_requests"
  WHERE "id" = NEW."shopReturnRequestId";

  SELECT COALESCE(SUM(item."requestedQuantity"), 0)::integer INTO committed_requested
  FROM "shop_return_items" item
  JOIN "shop_return_requests" request ON request."id" = item."shopReturnRequestId"
  WHERE item."shopOrderId" = NEW."shopOrderId"
    AND item."productId" = NEW."productId"
    AND item."id" <> NEW."id"
    AND request."status" NOT IN ('REJECTED', 'CANCELLED');

  IF request_status NOT IN ('REJECTED', 'CANCELLED')
    AND committed_requested + NEW."requestedQuantity" > ordered_quantity THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'shop_return_item_cumulative_quantity',
      MESSAGE = 'Return quantities exceed the immutable ordered quantity';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "shop_return_items_quantity_guard_trigger"
  BEFORE INSERT OR UPDATE ON "shop_return_items"
  FOR EACH ROW EXECUTE FUNCTION enforce_shop_return_item_limits();
