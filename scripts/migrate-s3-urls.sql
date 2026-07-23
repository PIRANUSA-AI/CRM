-- Migrate old S3_ENDPOINT URLs to S3_PUBLIC_URL
-- Run: psql -h localhost -p 5431 -U crm -d crm_db -f scripts/migrate-s3-urls.sql

-- crm-media is the S3_BUCKET name

UPDATE contacts
SET avatar_url = REPLACE(avatar_url, 'http://127.0.0.1:9000/crm-media', 'https://crm.contrivent.com/crm-media')
WHERE avatar_url LIKE 'http://127.0.0.1:9000/crm-media%';

UPDATE contacts
SET badge_url = REPLACE(badge_url, 'http://127.0.0.1:9000/crm-media', 'https://crm.contrivent.com/crm-media')
WHERE badge_url LIKE 'http://127.0.0.1:9000/crm-media%';

UPDATE media_files
SET media_url = REPLACE(media_url, 'http://127.0.0.1:9000/crm-media', 'https://crm.contrivent.com/crm-media')
WHERE media_url LIKE 'http://127.0.0.1:9000/crm-media%';

UPDATE media_files
SET local_url = REPLACE(local_url, 'http://127.0.0.1:9000/crm-media', 'https://crm.contrivent.com/crm-media')
WHERE local_url LIKE 'http://127.0.0.1:9000/crm-media%';

UPDATE media_files
SET thumbnail_url = REPLACE(thumbnail_url, 'http://127.0.0.1:9000/crm-media', 'https://crm.contrivent.com/crm-media')
WHERE thumbnail_url LIKE 'http://127.0.0.1:9000/crm-media%';

UPDATE users
SET avatar_url = REPLACE(avatar_url, 'http://127.0.0.1:9000/crm-media', 'https://crm.contrivent.com/crm-media')
WHERE avatar_url LIKE 'http://127.0.0.1:9000/crm-media%';

UPDATE whatsapp_channels
SET profile_picture_url = REPLACE(profile_picture_url, 'http://127.0.0.1:9000/crm-media', 'https://crm.contrivent.com/crm-media')
WHERE profile_picture_url LIKE 'http://127.0.0.1:9000/crm-media%';

UPDATE whatsapp_channels
SET badge_url = REPLACE(badge_url, 'http://127.0.0.1:9000/crm-media', 'https://crm.contrivent.com/crm-media')
WHERE badge_url LIKE 'http://127.0.0.1:9000/crm-media%';

UPDATE products
SET image_url = REPLACE(image_url, 'http://127.0.0.1:9000/crm-media', 'https://crm.contrivent.com/crm-media')
WHERE image_url LIKE 'http://127.0.0.1:9000/crm-media%';

UPDATE product_variants
SET image_url = REPLACE(image_url, 'http://127.0.0.1:9000/crm-media', 'https://crm.contrivent.com/crm-media')
WHERE image_url LIKE 'http://127.0.0.1:9000/crm-media%';

UPDATE organization
SET logo = REPLACE(logo, 'http://127.0.0.1:9000/crm-media', 'https://crm.contrivent.com/crm-media')
WHERE logo LIKE 'http://127.0.0.1:9000/crm-media%';

UPDATE labels
SET badge_url = REPLACE(badge_url, 'http://127.0.0.1:9000/crm-media', 'https://crm.contrivent.com/crm-media')
WHERE badge_url LIKE 'http://127.0.0.1:9000/crm-media%';

UPDATE app_center
SET icon_url = REPLACE(icon_url, 'http://127.0.0.1:9000/crm-media', 'https://crm.contrivent.com/crm-media')
WHERE icon_url LIKE 'http://127.0.0.1:9000/crm-media%';

UPDATE app_center
SET banner_url = REPLACE(banner_url, 'http://127.0.0.1:9000/crm-media', 'https://crm.contrivent.com/crm-media')
WHERE banner_url LIKE 'http://127.0.0.1:9000/crm-media%';

UPDATE knowledge_source_files
SET storage_url = REPLACE(storage_url, 'http://127.0.0.1:9000/crm-media', 'https://crm.contrivent.com/crm-media')
WHERE storage_url LIKE 'http://127.0.0.1:9000/crm-media%';

UPDATE ai_evaluation_messages
SET media_url = REPLACE(media_url, 'http://127.0.0.1:9000/crm-media', 'https://crm.contrivent.com/crm-media')
WHERE media_url LIKE 'http://127.0.0.1:9000/crm-media%';

UPDATE order_invoices
SET pdf_link = REPLACE(pdf_link, 'http://127.0.0.1:9000/crm-media', 'https://crm.contrivent.com/crm-media')
WHERE pdf_link LIKE 'http://127.0.0.1:9000/crm-media%';

SELECT 'Migration complete' AS status;
