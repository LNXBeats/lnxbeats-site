-- Additive, reversible Admin presentation state for music orders.
-- No business, financial, contractual, stock or historical row is rewritten.
CREATE TYPE "OrderCurrentViewHiddenReason" AS ENUM ('TEST', 'DUPLICATE', 'OTHER');
CREATE TYPE "OrderCurrentViewVisibilityAction" AS ENUM ('HIDDEN', 'RESTORED');

ALTER TABLE "orders"
  ADD COLUMN "hiddenFromCurrentViewsAt" TIMESTAMPTZ(3),
  ADD COLUMN "hiddenFromCurrentViewsByUserId" UUID,
  ADD COLUMN "hiddenFromCurrentViewsReason" "OrderCurrentViewHiddenReason",
  ADD COLUMN "hiddenFromCurrentViewsNote" VARCHAR(240);

CREATE TABLE "order_current_view_visibility_events" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "action" "OrderCurrentViewVisibilityAction" NOT NULL,
  "reason" "OrderCurrentViewHiddenReason",
  "note" VARCHAR(240),
  "actorUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_current_view_visibility_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "orders_hiddenFromCurrentViewsAt_updatedAt_idx"
  ON "orders"("hiddenFromCurrentViewsAt", "updatedAt");
CREATE INDEX "orders_hiddenFromCurrentViewsByUserId_idx"
  ON "orders"("hiddenFromCurrentViewsByUserId");
CREATE INDEX "order_current_view_visibility_events_orderId_createdAt_idx"
  ON "order_current_view_visibility_events"("orderId", "createdAt");
CREATE INDEX "order_current_view_visibility_events_actorUserId_createdAt_idx"
  ON "order_current_view_visibility_events"("actorUserId", "createdAt");

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_hiddenFromCurrentViewsByUserId_fkey"
  FOREIGN KEY ("hiddenFromCurrentViewsByUserId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "order_current_view_visibility_events"
  ADD CONSTRAINT "order_current_view_visibility_events_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_current_view_visibility_events"
  ADD CONSTRAINT "order_current_view_visibility_events_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
