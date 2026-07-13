ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "image_url" text;

ALTER TABLE "product_variants"
  ADD COLUMN IF NOT EXISTS "image_url" text;
