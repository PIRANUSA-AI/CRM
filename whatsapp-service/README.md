# CRM WhatsApp Service

Service ini menjalankan runtime Baileys di proses terpisah dari CRM, tetapi tetap memakai database PostgreSQL yang sama.

## Jalankan

Dalam bundle installer, service ini ikut di-install otomatis oleh:

```bash
npm run openclaw:install
# atau
npm run openclaw:gclaw
```

Installer akan menulis `.env`, memasang dependency Bun, menjalankan typecheck,
dan start PM2 process `crm-whatsapp-service`.

Manual lokal:

```bash
cd /Users/triasjaya/Sites/crm/crm-installer/whatsapp-service
bun install
cp .env.example .env
./run.sh
```

## Env penting

- `DATABASE_URL`: database PostgreSQL yang sama dengan CRM
- `HOST`: default `127.0.0.1`
- `PORT`: default `3012`
- `CRM_API_BASE_URL`: base URL backend CRM
- `CRM_BAILEYS_WEBHOOK_PATH`: webhook inbound Baileys di CRM
- `BAILEYS_LINK_MODE`: default `qr`
- `BAILEYS_CHANNEL_SYNC_INTERVAL_MS`: interval sinkronisasi channel aktif
- `BAILEYS_SERVICE_INTERNAL_TOKEN`: opsional, kalau ingin route status/start service hanya bisa dipanggil dari CRM

## Integrasi CRM

Set env ini di backend CRM:

```bash
BAILEYS_SERVICE_URL=http://127.0.0.1:3012
BAILEYS_SERVICE_INTERNAL_TOKEN=
```

Sesudah itu:

- create channel Baileys tetap lewat CRM
- CRM menyimpan config channel ke database shared
- service ini yang membuka session, QR, reconnect, inbound, dan outbound send
