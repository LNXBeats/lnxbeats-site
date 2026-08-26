-- V0.8.4 stores an optional illustration format on each Order. Existing
-- Orders remain null and no pricing or payment snapshot is rewritten.
CREATE TYPE "OrderIllustrationFormat" AS ENUM (
  'SQUARE',
  'VERTICAL',
  'LANDSCAPE',
  'PORTRAIT',
  'CUSTOM'
);

ALTER TABLE "orders"
  ADD COLUMN "illustrationFormat" "OrderIllustrationFormat",
  ADD COLUMN "illustrationFormatCustom" VARCHAR(240),
  ADD CONSTRAINT "orders_illustration_format_consistent" CHECK (
    ("illustrationFormat" IS NULL AND "illustrationFormatCustom" IS NULL)
    OR (
      "coverIncluded" = true
      AND "illustrationFormat" IS NOT NULL
      AND (
        (
          "illustrationFormat" = 'CUSTOM'
          AND "illustrationFormatCustom" IS NOT NULL
          AND btrim("illustrationFormatCustom") <> ''
        )
        OR (
          "illustrationFormat" <> 'CUSTOM'
          AND "illustrationFormatCustom" IS NULL
        )
      )
    )
  );
