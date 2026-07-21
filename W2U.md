# W2U: What Should Be Updated

## Keputusan alignment

`main` tetap menjadi source of truth untuk production dan deployment VPS.

Jadi urutannya: **branch baru harus mengikuti `main` terlebih dahulu, lalu fitur branch diintegrasikan ke `main`**. Jangan membuat `main` mengikuti branch fitur secara wholesale, karena branch fitur dibuat dari baseline lama dan tidak membawa seluruh perbaikan Nginx, PM2, session, Bun, Baileys, dan deployment production yang sudah ada di `main`.

Cara paling aman adalah membuat integration branch dari `main`, lalu merge `origin/feat/tasks-list` ke sana. Kalau branch fitur memang akan terus dipakai bersama, update branch tersebut dengan merge `main` ke branch fitur; lakukan rebase hanya kalau tidak ada commit orang lain yang sudah bergantung pada branch itu.

## Perubahan yang harus masuk ke `main`

1. Integrasikan seluruh module baru task, notification, import, takeover, analyzer, dan worker dari branch fitur.
2. Integrasikan route/frontend baru: `/tasks`, `/tasks/:taskId`, `/alih-tugas`, `/import`, serta perubahan API client, role access, navigation, chat, dan customer detail.
3. Tambahkan `@langchain/openai` ke `apps/backend/package.json` dan regenerate `bun.lock` memakai dependency production dari `main`.
4. Pertahankan perubahan production `main` pada semua file deploy, PM2, Nginx, WhatsApp service, auth/session, media, dan profile sync.
5. Review manual lima file overlap, terutama `personal-whatsapp-inbox/index.ts`, `api.ts`, dan `chat.tsx`; auto-merge Git belum cukup untuk memastikan alur WhatsApp tidak berubah.

## Resolusi dependency yang wajib

`bun.lock` tidak boleh diambil mentah dari branch fitur. Branch fitur membawa Baileys `rc13`, sedangkan baseline production `main` memakai:

- `whatsapp-service`: Baileys `7.0.0-rc10`;
- `@elysiajs/node`;
- `socks-proxy-agent` dan konfigurasi SOCKS proxy;
- patch/runtime production yang sudah diuji di VPS.

Pertahankan dependency WhatsApp milik `main`, tambahkan dependency OpenAI yang dibutuhkan fitur, lalu jalankan `bun install`/regenerate lockfile dari hasil gabungan. Jangan upgrade Baileys ke `rc13` sebagai bagian sampingan integrasi task; itu harus menjadi perubahan terpisah dengan test pairing, reconnect, send/receive, dan session.

## Database dan Prisma

Branch fitur menambah model berikut di `schema.prisma`:

- `tasks` dan `task_events`;
- `notifications`;
- field takeover pada `whatsapp_lead_registrations`;
- `import_jobs` dan `import_job_rows`.

Migration `20260715120000_add_tasks` saat ini hanya membuat `tasks` dan `task_events`. Ia belum mendokumentasikan tabel `notifications`, `import_jobs`, `import_job_rows`, atau perubahan field/index takeover. Ini harus dibereskan sebelum production:

- buat migration SQL lengkap yang merepresentasikan seluruh perubahan schema; atau
- bila tetap memakai `prisma db push` sesuai workflow VPS sekarang, lakukan backup database, jalankan di staging, lalu verifikasi seluruh tabel/index/kolom sebelum deploy.

Setelah schema final, jalankan `bun run db:generate`, build backend, dan pastikan Prisma client yang dipakai worker/API berasal dari schema gabungan yang sama.

## Environment dan AI production

Branch fitur menambahkan analyzer task berbasis OpenAI dan mengubah personal auto-reply ke OpenAI-compatible. Sebelum enable di VPS, tambahkan dan verifikasi secara aman:

- `OPENAI_API_KEY` untuk analyzer task;
- `OPENAI_BASE_URL` bila memakai gateway OpenAI-compatible seperti GLM/Z.ai;
- `OPENAI_CLASSIFIER_MODEL`;
- `OPENAI_GENERATOR_MODEL`.

Auto-reply personal juga membaca konfigurasi khusus seperti `PERSONAL_AI_OPENAI_API_KEY`, `PERSONAL_AI_OPENAI_BASE_URL`, `PERSONAL_AI_REVIEW_MODEL`, `PERSONAL_AI_COMPOSE_MODEL`, dan `PERSONAL_AI_EMBED_MODEL`, dengan fallback ke `OPENAI_API_KEY`/default model. Tambahkan variabel ini ke dokumentasi environment production dan tentukan provider/model yang disetujui sebelum rollout.

Saat ini `.env.example` branch sudah memuat tiga variabel analyzer, tetapi `.env.production.example` dan konfigurasi rollout belum mencerminkan seluruh kebutuhan baru. Jangan menaruh secret di Git. Pastikan `crm-api`, `crm-worker`, dan proses yang menjalankan queue menerima environment yang sama; Redis wajib tersedia untuk queue `ai-processing`.

Keputusan provider perlu eksplisit karena perubahan ini dapat mengubah biaya, latency, rate limit, dan perilaku auto-reply production dari Ollama ke OpenAI. Untuk rollout awal, lebih aman memvalidasi analyzer/task di staging dan memastikan takeover human tetap bisa menghentikan auto-reply sebelum mengaktifkan auto-reply OpenAI untuk semua lead.

## Deployment dan observability

Sebelum merge ke `main`:

- jalankan `bun install`, `bun run db:generate`, `bun run lint`, backend/frontend build, dan test yang tersedia;
- test migration/schema di database staging dengan data representative;
- test login/session, Nginx media upload/download, QR/pairing, reconnect, profile sync, dan send/receive WhatsApp;
- test inbound lead pending/confirmed/blocked, task creation/deduplication, task actions, takeover/release, notification read state, dan CSV import;
- cek log PM2 untuk `crm-api`, `crm-worker`, `crm-scheduler`, dan `crm-whatsapp`, serta queue Redis `ai-processing`;
- deploy bertahap dan siapkan rollback provider AI tanpa menggulung balik konfigurasi Nginx/session production.

## Ringkasan final

- **Yang diikuti branch fitur:** fitur task, import, notification, takeover, dan UI terkait.
- **Yang tetap menjadi acuan:** `main` untuk VPS, Bun, PM2, Nginx, media, session, dan runtime Baileys production.
- **Aksi pertama:** sync branch fitur dengan `main` atau merge ke integration branch dari `main`.
- **Aksi sebelum production:** selesaikan migration/schema, lockfile, environment AI, dan test WhatsApp/queue.

