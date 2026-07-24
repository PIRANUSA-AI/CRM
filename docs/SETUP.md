# SETUP — Cara menyiapkan CRM dev agar identik dengan yang sekarang

Dokumen ini adalah **panduan tunggal** untuk menyiapkan environment dev dari nol
sampai jalan, atau memindahkan data dari laptop lain. Baca sekali, ikuti urutannya.

> Butuh arsitektur/detail modul? Lihat `HANDOVER.md` dan `docs/`.
> Dokumen ini cuma membahas setup & migrasi data.

---

## 0. Prasyarat

| Alat | Versi | Catatan |
| --- | --- | --- |
| **Bun** | >= 1.1 | Runtime utama. Cek: `bun --version` |
| **Docker** + Docker Compose | terbaru | Untuk Postgres, Redis, MinIO |
| **Git** | terbaru | Repo: `https://github.com/PIRANUSA-AI/CRM.git` |
| Node | opsional | Beberapa tooling CLI pakai `bun x` |

Repo ini **PUBLIC** di GitHub. Akibatnya:
- **Jangan pernah commit** `.env`, `snapshot/`, atau dump data (berisi secret +
  data pelanggan). Semuanya sudah di-gitignore.
- Secret hanya dibagi luar git (USB / cloud pribadi).

---

## 1. Clone & install

```bash
git clone https://github.com/PIRANUSA-AI/CRM.git
cd CRM
git checkout feat/adjustments          # branch kerja aktif
bun install
```

---

## 2. Pilih jalur

Ada dua jalur. **Pilih satu**:

- **[Jalur A — Migrasi dari laptop lain](#jalur-a--migrasi-dari-laptop-lain-pakai-snapshot)**
  (pindah data + akun + pesan WA + sesi WhatsApp yang sudah tersambung).
  Pakai ini kalau sudah ada folder `snapshot/` dari mesin lain.

- **[Jalur B — Setup fresh / data demo](#jalur-b--setup-fresh-data-demo)**
  (akun contoh, tanpa data pelanggan asli). Pakai ini kalau mulai bersih.

> Kedua jalur berakhir di langkah [3. Menjalankan aplikasi](#3-menjalankan-aplikasi).

---

## Jalur A — Migrasi dari laptop lain (pakai snapshot)

Folder `snapshot/` berisi seluruh data dev (DB + media + .env). Dipindahkan
manual (USB/cloud) dari mesin lama; **tidak boleh di-commit**.

### 2A.1 Taruh snapshot di root repo

```
CRM/
└── snapshot/
    ├── db.dump          # Postgres (akun, kontak, chat, pesan, sesi WA, ...)
    ├── media.tar.gz     # isi MinIO (foto profil, media WA, upload)
    ├── MANIFEST.txt
    └── env/
        ├── .env         # config + secret dari mesin lama
        └── .env.local
```

### 2A.2 Nyalakan service dasar

```bash
bun run dev:services
```

Ini menjalankan `docker compose up` untuk **postgres** (port 5431), **redis**
(6379), **minio** (9000/9001) + inisialisasi bucket `crm-media`.

### 2A.3 Setel DATABASE_URL sebelum restore

`snapshot/env/.env` dari mesin lama mungkin menunjuk ke port yang **berbeda**
(mis. mesin lama memakai postgres container lain di `5433`). Di mesin ini,
postgres dari compose ada di **5431**. Jadi setelah snapshot ditaruh, perbaiki
`DATABASE_URL` di `.env` (restore akan menulis `.env` dari snapshot dulu, lalu
kamu edit sebelum lanut — atau edit `snapshot/env/.env` sebelum restore):

```dotenv
DATABASE_URL=postgresql://crm:2l8xHHcw0Wai4Qn01C7hbLkaM_vbctog@localhost:5431/crm_db
```

### 2A.4 Restore

```bash
# pastikan TIDAK ada backend/worker yang jalan (bebaskan koneksi DB)
bun run snapshot:restore          # akan minta konfirmasi [ketik 'ya'] + tampilkan target DB
bun run db:generate               # regenerasi Prisma client sesuai schema
```

Selesai. Lanjut ke [langkah 3](#3-menjalankan-aplikasi).

**Yang ikut pindah:** 11 akun (superadmin 1, ceo 1, administrator 1, leader 2,
sales 6), 353 kontak, 314 percakapan, ~19rb pesan, 5 sesi Baileys. Sesi WhatsApp
**tidak perlu re-scan QR** — di dev, `auth_state` Baileys disimpan plaintext
(tidak ada `BAILEYS_AUTH_ENCRYPTION_KEY`).

> Detail teknis snapshot: `scripts/snapshot/README.md`.

---

## Jalur B — Setup fresh (data demo)

### 2B.1 Buat `.env`

```bash
cp .env.example .env
```

Lalu isi minimal ini (nilai dev lokal yang dipakai sekarang):

```dotenv
# Postgres dari docker-compose proyek ini (port 5431)
DATABASE_URL=postgresql://crm:2l8xHHcw0Wai4Qn01C7hbLkaM_vbctog@localhost:5431/crm_db
POSTGRES_PASSWORD=2l8xHHcw0Wai4Qn01C7hbLkaM_vbctog

SESSION_SECRET=development-session-secret
JWT_SECRET=development-jwt-secret
BETTER_AUTH_SECRET=development-secret-change-in-production
BETTER_AUTH_BASE_URL=http://localhost:3010/auth

PORT=3010
NODE_ENV=development
APP_MODE=api
SOCKET_PORT=3011
VITE_API_URL=http://localhost:3010
SOCKET_IO_CORS_ORIGIN=http://localhost:3005
FRONTEND_URL=http://localhost:3005

REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379

# MinIO lokal (default compose)
MINIO_ROOT_USER=crm_minio
MINIO_ROOT_PASSWORD=crm_minio_change_me
S3_ENDPOINT=http://127.0.0.1:9000
S3_ACCESS_KEY=crm_minio
S3_SECRET_KEY=crm_minio_change_me
S3_BUCKET=crm-media
S3_PUBLIC_URL=http://127.0.0.1:9000
S3_PUBLIC_URL_STYLE=path

# WhatsApp microservice
BAILEYS_SERVICE_URL=http://127.0.0.1:3012
WHATSAPP_SERVICE_PORT=3012
HOST=127.0.0.1
CRM_BAILEYS_WEBHOOK_PATH=/api/personal-whatsapp-inbox/ingest

# CEO bootstrap (dipakai seed-ceo)
SEED_CEO_EMAIL=admin@crm.local
SEED_CEO_PASSWORD=123
```

> Secret AI (OpenAI/Deepgram/GLM/Ollama) opsional — hanya kalau mau fitur AI
> jalan. Isi dari mesin lama (lewat snapshot) atau punya sendiri. Jangan commit.

### 2B.2 Nyalakan service + siapkan DB

```bash
bun run dev:services        # postgres + redis + minio
bun run db:push             # terapkan schema Prisma ke DB
bun run db:generate         # generate Prisma client
```

### 2B.3 Seed data demo

```bash
cd apps/backend
bun run scripts/seed-all.ts          # semua langkah berurutan, idempoten
# atau per langkah:
#   bun run scripts/seed-dev-users.ts   # akun dasar + organisasi
#   bun run scripts/seed-sim-sales.ts   # akun sales + tim
#   bun run scripts/seed-ceo.ts         # CEO (pakai SEED_CEO_EMAIL/PASSWORD)
#   bun run scripts/seed-org-structure.ts  # administrator + leader per tim
```

**Akun contoh** (password default `password123` atau `SEED_CEO_PASSWORD`):

| Email | Role |
| --- | --- |
| kristian@piranusa.com | ceo |
| benny@piranusa.com | leader |
| deska@piranusa.com | sales |
| yoka@piranusa.com | superadmin |
| yoel@piranusa.com | sales |
| fathur@piranusa.com | sales |

Selesai. Lanjut ke [langkah 3](#3-menjalankan-aplikasi).

---

## 3. Menjalankan aplikasi

```bash
bun run dev
```

Satu perintah ini menjalankan **semua** (lihat `scripts/dev.ts`):
1. `docker compose up` postgres + redis + minio (+ init bucket)
2. backend API (port 3010) + socket.io (3011) + worker — via `dev:apps` & `dev:worker`
3. frontend (3005) + **whatsapp-service** (3012) — termasuk karena workspace

Hentikan dengan `Ctrl-C`.

### Port & service

| Port | Service | Sumber |
| --- | --- | --- |
| 3005 | Frontend (Vite) | `apps/frontend` |
| 3010 | Backend API (Elysia) | `apps/backend` |
| 3011 | Socket.IO (realtime) | `apps/backend` |
| 3012 | WhatsApp / Baileys microservice | `whatsapp-service/` (proses terpisah) |
| 5431 | PostgreSQL | `docker-compose.yml` |
| 6379 | Redis | `docker-compose.yml` |
| 9000 / 9001 | MinIO (S3 + console) | `docker-compose.yml` |

> **Penting:** Baileys/WhatsApp ada di proses terpisah (`whatsapp-service/`,
> 3012). Backend tidak memanggil Baileys langsung; lewat `BaileysServiceClient`
> ke port 3012. Lihat `apps/backend/src/modules/whatsapp/baileys-service-client.ts`.

### Buka

- App: http://localhost:3005
- MinIO console: http://localhost:9001 (user `crm_minio` / `crm_minio_change_me`)

---

## 4. Perintah berguna

```bash
bun run dev                # nyalakan semua (lihat atas)
bun run dev:services       # cuma docker (postgres/redis/minio)
bun run dev:backend        # cuma backend API
bun run dev:frontend       # cuma frontend

bun run db:generate        # regenerasi Prisma client (setelah ubah schema)
bun run db:push            # terapkan schema ke DB
bun run db:studio          # Prisma Studio (GUI DB) di http://localhost:5555
cd apps/backend && bunx prisma migrate dev   # bikin migration baru

bun run snapshot:dump      # export data + media + .env → ./snapshot/
bun run snapshot:restore   # restore dari ./snapshot/

bun run lint               # typecheck semua package
bun run build              # build semua package
```

---

## 5. Migrasi data antar laptop (ringkas)

**Export di mesin lama:**
```bash
bun run snapshot:dump
# pindahkan folder snapshot/ manual (USB/cloud) ke mesin baru
```

**Import di mesin baru:** lihat [Jalur A](#jalur-a--migrasi-dari-laptop-lain-pakai-snapshot).

Artifak `snapshot/` (db.dump, media.tar.gz, .env) **tidak masuk git**. Hanya
script-nya (`scripts/snapshot/`) yang ter-commit.

---

## 6. Quirk lokal (penting)

Hal-hal yang **tidak obvious** dan pernah bikin bingung:

1. **DB bisa di port yang tidak sesuai compose.** `docker-compose.yml` expose
   postgres di **5431**, tapi beberapa mesin dev memakai postgres container
   proyek lain (mis. `cpira-postgres` di **5433**). Yang menentukan adalah
   `DATABASE_URL` di `.env`. Kalau `bun run dev` error koneksi DB, cek port di
   `DATABASE_URL` cocok dengan container yang hidup:
   ```bash
   docker ps --format '{{.Names}}\t{{.Ports}}' | grep postgres
   ```

2. **`.env.local` (di luar git).** Ada file `.env.local` yang meng-override
   beberapa nilai per-mesin (mis. `REDIS_URL` ke port lain, `COMPOSE_FILE`
   tambahan). Kalau ada perilaku aneh per-mesin, periksa `.env.local`.

3. **WhatsApp (Baileys) sensitif.** Jangan mengirim pesan tak sengaja saat
   debug. Auto-send hanya boleh kalau leader/sales konfirmasi. Detail flow WA:
   `docs/w2u-whatsapp-sales-ai.md`.

4. **`BAILEYS_AUTH_ENCRYPTION_KEY`** kosong di dev → `auth_state` plaintext.
   Itu sebabnya sesi WA bisa dimigrasi tanpa re-scan. Production wajib set key
   ini (lihat `whatsapp-service/src/runtime.ts` `authEncryptionKey()`).

5. **Prisma client** harus di-regenerate setelah clone/ubah schema:
   `bun run db:generate`. Generated client ada di
   `apps/backend/src/generated/` (di-gitignore).

---

## 7. Verifikasi setup berhasil

```bash
# DB punya data?
PGPASSWORD=2l8xHHcw0Wai4Qn01C7hbLkaM_vbctog \
  psql -h localhost -p 5431 -U crm -d crm_db \
  -c "SELECT role, COUNT(*) FROM users WHERE deleted_at IS NULL GROUP BY role;"

# backend hidup?
curl http://localhost:3010/health || curl http://localhost:3010/

# whatsapp-service hidup?
curl http://localhost:3012/health
```

Lalu buka http://localhost:3005 dan login.

---

## 8. Troubleshooting cepat

| Gejala | Solusi |
| --- | --- |
| `ECONNREFUSED 127.0.0.1:5431/5433` | postgres belum hidup / port salah. Cek `DATABASE_URL` & `docker ps`. |
| `PrismaClientInitializationError` | jalankan `bun run db:generate`, lalu `bun run db:push`. |
| `Baileys session storage is not ready` | whatsapp-service belum start. Tunggu / cek log port 3012. |
| Frontend API error 401 | `.env` secret (`SESSION_SECRET` dll) beda dengan yang dipakai bikin sesi. Login ulang. |
| WhatsApp "tidak bisa kirim" | pastikan port 3012 hidup & `BAILEYS_SERVICE_URL=http://127.0.0.1:3012`. |
| `server version mismatch` (pg_dump) | pakai container pg yang cocok: script snapshot sudah handle otomatis. |

---

## 9. Branch kerja

Branch aktif: **`feat/adjustments`** (banyak perbaikan berjalan).
Setelah setup, mulai dari branch ini. Jangan kerja langsung di `main`.
