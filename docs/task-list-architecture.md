# Task List — Arsitektur Teknis (Fase 1 & 2)

Dokumen ini menjelaskan arsitektur teknis fitur **Task List sales berbasis WhatsApp** yang sudah selesai (Fase 1 Foundation + Fase 2 Action). Disusun agar bisa dibaca dua arah:

- **Code walkthrough** — bagaimana tiap bagian diimplementasikan di kode.
- **Usage / operasional** — bagaimana alur dipakai dan dikonfigurasi.

Status: Fase 1 & 2 selesai, ter-commit di branch `feat/tasks-list`. Fase 3–7 belum.

---

## 1. Gambaran Umum

Task List mengubah pesan WhatsApp masuk menjadi **daftar tugas actionable untuk sales**, dengan bantuan AI untuk menyaring dan merangkum. AI bersifat **advisory** — tidak pernah mengirim pesan otomatis; sales tetap yang memutuskan dan menekan tombol kirim.

```
WhatsApp (Baileys)  ─▶  Webhook  ─▶  Lead gate (confirmed?)  ─▶  Queue (BullMQ)
                                                                     │
                                                            Worker: task-analysis
                                                                     │
                                              AI 2-tier (GLM/Z.ai, JSON mode)
                                                                     │
                                        actionable?  ──▶  buat/update `tasks`
                                                                     │
                                            Realtime (Socket.IO) ─▶ Frontend /tasks
                                                                     │
                                     Sales: lihat detail + draf AI ─▶ Balas via WA
```

Prinsip desain kunci:
- **Async** lewat BullMQ agar webhook tidak lambat.
- **Idempoten** — 1 pesan sumber = maksimal 1 task (`unique(app_id, source_message_id)` + deterministic jobId).
- **Gated** — hanya lead WhatsApp personal yang sudah `confirmed`.
- **Human-in-the-loop** — AI hanya membuat task + draf; kirim tetap manual.

---

## 2. Model Data

Dua tabel, dibuat via `prisma db push` (proyek ini memakai db push, bukan `migrate deploy`). Definisi Prisma di `apps/backend/prisma/schema.prisma`, mirror SQL di `apps/backend/prisma/migrations/20260715120000_add_tasks/migration.sql`.

### `tasks`
| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `app_id` | uuid | FK `apps` (CASCADE). Tenant scope |
| `assignee_id` | uuid? | FK `users` (SET NULL). Sales pemilik task |
| `team_id` | uuid? | FK `teams` (SET NULL) |
| `created_by` | uuid? | FK `users` (SET NULL). null = dibuat AI |
| `conversation_id` | uuid? | FK `conversations` (SET NULL) |
| `contact_id` | uuid? | FK `contacts` (SET NULL) |
| `source_message_id` | uuid? | FK `messages` (SET NULL). Dasar idempotensi |
| `action_kind` | varchar(50) | `reply_now`/`follow_up`/`qualify_lead`/`handover_review`/`manual` |
| `title` | varchar(255) | Judul task |
| `description` | text? | Ringkasan/konteks |
| `priority` | varchar(20) | `low`/`medium`/`high`/`urgent` (default `medium`) |
| `status` | varchar(20) | `open`/`in_progress`/`done`/`cancelled` (default `open`) |
| `due_at` | timestamptz? | Tenggat |
| `snoozed_until` | timestamptz? | Ditunda sampai |
| `completed_at` | timestamptz? | Waktu selesai |
| `source` | varchar(50) | `ai_whatsapp`/`manual` (default `ai_whatsapp`) |
| `ai_snapshot` | jsonb | Hasil analisis AI mentah (suggestedReply, summary, evidence, dst.) |
| `analysis_version` | varchar(32)? | Versi analisa (mis. `v1`) |
| `confidence` | float? | Keyakinan AI 0–1 |
| `created_at` / `updated_at` | timestamptz | Audit |

Index: `unique(app_id, source_message_id)`; `(app_id, assignee_id, status, due_at)`; `(app_id, status, due_at)`; `(conversation_id)`; `(contact_id)`.

### `task_events` (audit trail)
| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | uuid PK | |
| `task_id` | uuid | FK `tasks` (CASCADE) |
| `event_type` | varchar(50) | `created`/`updated`/`started`/`completed`/`cancelled`/`snoozed`/`ai_analyzed`/`replied_whatsapp` |
| `actor_id` | uuid? | FK `users` (SET NULL) |
| `actor_type` | varchar(20) | `user`/`system` (default `user`) |
| `metadata` | jsonb | Konteks event |
| `reason` | text? | Alasan (snooze/cancel) |
| `created_at` | timestamptz | |

> Catatan desain: ID relasi disimpan sebagai kolom scalar (tanpa reverse relation di `users`/`teams`/`conversations`/`contacts`/`messages`) mengikuti pola `personal_ai_reply_tasks`, agar tidak menambah churn di core schema. Integritas dijaga oleh FK di level DB.

---

## 3. Struktur Modul Backend

Direktori `apps/backend/src/modules/tasks/`:

| File | Tanggung jawab |
|---|---|
| `model.ts` | Kontrak API TypeBox: `TaskModel` (bentuk task) + `TaskRequestModel` (`list`, `create`, `update`, `snooze`, `cancel`, `replyWhatsapp`) |
| `policy.ts` | RBAC & scope: `TaskActor`, `taskVisibilityScope`, `assertAssignableTask`, `parseFutureDate`, `dueAtFromRecommendation` |
| `analyzer.ts` | AI 2-tier (OpenAI-compatible, JSON mode) → `TaskAnalysisDecision` |
| `service.ts` | Logika bisnis: list/summary/get/events/create/update/transition/snooze/`createFromAnalysis`/`replyWhatsapp`. Emit realtime. |
| `worker.ts` | Job BullMQ `task-analysis`: `enqueueTaskAnalysis`, `processTaskAnalysisJob`, kebijakan confidence |
| `index.ts` | Route Elysia `/tasks` + resolusi actor + mapping error |

Registrasi: diekspor di `src/modules/index.ts`, dipasang di `src/index.ts` pada grup `/api` dan `/api/v1` → rute akhir `/api/tasks/*` dan `/api/v1/tasks/*`.

---

## 4. AI Analyzer (`analyzer.ts`)

Provider **OpenAI-compatible** memakai `@langchain/openai` `ChatOpenAI`. Karena `OPENAI_BASE_URL` dikonfigurasi, ini menunjuk ke **GLM / Z.ai** (`glm-4.5-flash`). Bisa dikembalikan ke OpenAI asli dengan mengganti env.

Memakai **JSON mode** (`response_format: { type: 'json_object' }`) + parsing manual dengan Zod — lebih portabel lintas provider daripada structured-output khusus OpenAI.

### Alur 2-tier
1. **Tier 1 — Classifier** (`OPENAI_CLASSIFIER_MODEL`, temperature 0): menentukan `action`, `confidence`, `leadSignal`, `priority`, `evidence`, `safetyFlags`. Jika `action = ignore` → berhenti (hemat biaya, tidak jadi task).
2. **Tier 2 — Generator** (`OPENAI_GENERATOR_MODEL`, temperature 0.3): hanya untuk lead actionable → menghasilkan `title`, `summary`, `suggestedReply`, `dueInMinutes`.

### Output — `TaskAnalysisDecision`
```
action        : ignore | reply_now | follow_up | qualify_lead | handover_review
confidence    : number 0..1
leadSignal    : none | interest | qualified | purchase_intent
priority      : low | medium | high | urgent | null
dueInMinutes  : int 0..43200 | null
title         : string | null
summary       : string | null
suggestedReply: string | null   ← draf balasan (ditinjau sales, tidak auto-kirim)
evidence      : string[]        ← kutipan pesan customer
safetyFlags   : string[]        ← penanda sensitif
```

Guard: system prompt memperlakukan isi pesan customer sebagai **data tidak tepercaya** (anti prompt-injection), melarang mengarang harga/stok/promo, dan menegaskan `suggestedReply` hanya draf.

---

## 5. Worker & Antrian (`worker.ts`)

- Antrian: `aiProcessingQueue` (`'ai-processing'`), nama job **`task-analysis`**.
- `enqueueTaskAnalysis({ appId, messageId, ownerUserId })` — `jobId = task-analysis:<messageId>` (idempoten), retry `attempts` + exponential backoff.
- `processTaskAnalysisJob(data)` — dipanggil worker runtime (`APP_MODE=worker`).

### Gerbang validasi (semua harus lolos, kalau tidak → `skipped`)
1. `appId` & `messageId` valid UUID.
2. Pesan `message_type = incoming`, belum dihapus.
3. Konten teks tidak kosong (`content_type = text`).
4. Percakapan `status = open`.
5. Pesan pemicu adalah **inbound terbaru** (else `newer_inbound_exists`).
6. Owner cocok (payload vs `additional_attributes.personal_whatsapp.owner_user_id`).
7. Lead `whatsapp_lead_registrations.status = confirmed`.
8. Assignee = `conversation.assignee_id || ownerUserId`, harus user aktif role `sales`/`leader`.

### Analisis "unanswered turn" (perbaikan Fase 2)
Alih-alih hanya menganalisis 1 baris terakhir, worker mengambil ~20 pesan terakhir, lalu memilih **seluruh blok pesan customer beruntun sejak balasan sales terakhir** dan menganalisisnya sebagai satu kesatuan. Ini mencegah kasus pertanyaan actionable "tertutup" oleh pesan penutup seperti "trims/ok".

### Kebijakan confidence (`withHumanReview`)
- `confidence < TASK_ANALYSIS_REVIEW_CONFIDENCE` (default 0.5) → dibuang.
- `confidence < TASK_ANALYSIS_MIN_CONFIDENCE` (default 0.7) **atau** ada `safetyFlags` → dipaksa `handover_review`, priority `high`, tanpa draf.
- `>= 0.7` & actionable → task normal dengan draf.

---

## 6. Titik Integrasi

| Lokasi | Peran |
|---|---|
| `modules/webhook/service.ts` | Di cabang Baileys personal, setelah lead `confirmed` → `enqueueTaskAnalysis`. Lead `pending`/`blocked` berhenti lebih dulu. |
| `modules/personal-whatsapp-inbox/index.ts` | Saat sales **mengonfirmasi lead** (`POST /leads/:id/confirm`) → langsung enqueue analisis pesan terakhir customer, jadi task muncul tanpa menunggu pesan baru. |

Keamanan berlapis: enqueue hanya untuk lead confirmed, dan worker **memvalidasi ulang** status confirmed — payload yang salah tidak bisa menembus gerbang.

---

## 7. API Endpoints

Semua di bawah `/api/v1/tasks` (dan kompat `/api/tasks`). RBAC via `requireRole` untuk `sales`/`leader`/`ceo`/`superadmin`.

| Method | Path | Fungsi |
|---|---|---|
| GET | `/tasks` | List (filter `view=today\|all\|overdue\|done`, `status`, `priority`, `cursor`, `limit`) |
| GET | `/tasks/summary/today` | Ringkasan: `overdue`, `today`, `completedToday` |
| GET | `/tasks/:id` | Detail task |
| GET | `/tasks/:id/events` | Audit trail |
| POST | `/tasks` | Buat task manual |
| PATCH | `/tasks/:id` | Update judul/desk/priority/dueAt |
| POST | `/tasks/:id/start` | `open → in_progress` |
| POST | `/tasks/:id/complete` | `→ done` |
| POST | `/tasks/:id/snooze` | Tunda `{ snoozedUntil, reason? }` |
| POST | `/tasks/:id/cancel` | `→ cancelled` |
| POST | `/tasks/:id/reply-whatsapp` | Kirim `{ text }` ke customer via Baileys, lalu task otomatis `done` |

---

## 8. RBAC & Visibility Scope (`policy.ts`)

`taskVisibilityScope(actor)` menentukan task mana yang terlihat:
- **sales** → hanya `assignee_id = dirinya`.
- **leader** → miliknya **atau** `team_id ∈ team-nya` (via `team_members`).
- **ceo / superadmin** → semua (scope kosong).

`assertAssignableTask` menjaga penugasan: sales hanya bisa membuat task untuk dirinya; leader wajib memilih team saat memberi ke sales lain.

---

## 9. `replyWhatsapp` — Balas dari Task (Fase 2)

`TaskService.replyWhatsapp(actor, taskId, text)`:
1. Cek akses task (scope) + task masih aktif + punya `conversation_id`.
2. Resolusi owner (dari metadata personal_whatsapp / assignee) → cari `baileys_sessions` `connected` + `whatsapp_channels` (api_key, inbox cocok).
3. Kirim via `BaileysServiceClient.sendMessage` (addressing `pn`).
4. Dalam 1 transaksi: simpan pesan `outgoing`, update `last_message_at`, set task `done`, catat event `replied_whatsapp`.
5. Emit realtime `message:created` (ke app + conversation) dan `task:updated`.

---

## 10. Frontend

| File | Peran |
|---|---|
| `apps/frontend/src/lib/api.ts` | Client `tasks` (`list`, `summary`, `start`, `complete`, `snooze`, `replyWhatsapp`) + tipe (`Task`, `TaskStatus`, `TaskPriority`, `TaskActionKind`, dst.) memakai `apiRequest` (auth + org header otomatis) |
| `apps/frontend/src/routes/_app/tasks.tsx` | Halaman `/tasks`: kartu ringkasan (Hari ini/Terlambat/Selesai), tab view, daftar task, dan **panel detail modal** (draf AI editable, Balas via WhatsApp, preset Tunda, Mulai/Selesai, Buka chat) |
| `apps/frontend/src/lib/crm-navigation.ts` | Item nav "Daftar Tugas" (grup Operasional) |
| `apps/frontend/src/lib/role-access.ts` | `/tasks` masuk `SALES_PATHS` |
| `apps/frontend/src/components/BottomNav.tsx` | Nav mobile sales menyertakan `/tasks` |
| `apps/frontend/src/routeTree.gen.ts` | Route ter-generate TanStack Router |

---

## 11. Event Realtime (Socket.IO)

| Event | Room | Pemicu |
|---|---|---|
| `task:created` | `app:<appId>` | Task baru dibuat |
| `task:updated` | `app:<appId>`, `conversation:<id>` | Status/atribut berubah |
| `message:created` | `app:<appId>`, `conversation:<id>` | Balasan WA dari task terkirim |

---

## 12. Konfigurasi (env)

| Variabel | Default | Fungsi |
|---|---|---|
| `OPENAI_API_KEY` | — | Kunci provider (saat ini GLM/Z.ai) |
| `OPENAI_BASE_URL` | (kosong = OpenAI) | Endpoint OpenAI-compatible. Diisi `https://api.z.ai/api/paas/v4` |
| `OPENAI_CLASSIFIER_MODEL` | `gpt-4.1-nano` | Model Tier 1. Diisi `glm-4.5-flash` |
| `OPENAI_GENERATOR_MODEL` | `gpt-4.1-mini` | Model Tier 2. Diisi `glm-4.5-flash` |
| `TASK_ANALYSIS_MODEL_TIMEOUT_MS` | 45000 | Timeout per panggilan model |
| `TASK_ANALYSIS_MIN_CONFIDENCE` | 0.7 | Ambang buat task normal |
| `TASK_ANALYSIS_REVIEW_CONFIDENCE` | 0.5 | Ambang minimal (di bawah ini dibuang) |
| `TASK_ANALYSIS_CONCURRENCY` | 3 | Paralelisme worker |
| `TASK_ANALYSIS_ATTEMPTS` / `TASK_ANALYSIS_BACKOFF_MS` | 3 / 2000 | Retry job |

---

## 13. Idempotensi & Keamanan
- **Idempotensi**: `jobId` deterministik per pesan + `unique(app_id, source_message_id)`; `createFromAnalysis` juga meng-update task aktif yang sudah ada untuk `action_kind` yang sama pada satu percakapan.
- **Gating lead** ganda (enqueue + worker) mencegah analisis nomor asing/spam.
- **Anti prompt-injection** di prompt AI.
- **AI advisory-only** — tidak ada auto-send; sales menekan kirim.

---

## 14. Menjalankan & Menguji
1. Set `OPENAI_API_KEY` (+ `OPENAI_BASE_URL`/model GLM) di `.env`.
2. `bun run dev` (menyalakan Postgres/Redis/MinIO, API, frontend, whatsapp-service, dan **worker**).
3. Login sales, hubungkan WhatsApp, **konfirmasi lead** di inbox.
4. Pesan sales-intent baru → task muncul di `/tasks`.
5. Klik task → edit draf → **Balas via WhatsApp & Selesaikan**.

---

## 15. Keterbatasan Saat Ini / Ditunda
- **Google Sheets import** (Fase 3) butuh kredensial Google OAuth — belum dikerjakan.
- **Auto-reply WA** (fitur terpisah, `personal-whatsapp-inbox/ai-reply.ts`) masih memakai **Ollama**, belum dipindah ke GLM.
- Model GLM gratis `glm-4.5-flash` adalah model reasoning → **latensi ~15–45 dtk** per analisis (async, tidak memblokir chat). Model lebih cepat/akurat (`glm-4.6`) butuh saldo Z.ai.
- Perilaku "baca blok chat vs pesan terakhir" masih menunggu keputusan lanjutan Anda.
- Belum ada: widget dashboard "Tugas Hari Ini", import, email, sequences, leader oversight, advanced (Fase 3–7).
