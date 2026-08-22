-- V0.7.5 allows a bounded ordered set of private delivery assets per Order.
-- This replaces only the former one-delivery constraint; no row or column is removed.
DROP INDEX IF EXISTS "order_assets_one_delivery_per_order";

CREATE UNIQUE INDEX "order_assets_delivery_position_unique"
  ON "order_assets" ("orderId", "position")
  WHERE "role" = 'DELIVERY';
