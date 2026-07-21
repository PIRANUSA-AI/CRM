# Flow E2E: Leader → Sales (PIRANUSA CRM)

Dokumen tunggal yang menjelaskan **alur bisnis sampai teknis** dari lead masuk lewat leader, dibagikan ke sales, sampai ditindaklanjuti — mencakup: **masukin pelanggan, chat (inbox), indikator assign ke sales, takeover/handover (ambil alih), notifikasi, task list, dan knowledge base.**

> Dokumen ini adalah acuan kerja utama. Branch aktif: `feat/lead-auto-assign` (sudah superset dari `feat/tasks-list`, `fix/wa-reconnect-after-logout`, dan `origin/main`).
> App ID (dev): `1713b2f2-0931-45ef-b386-b65799c588fd`.
> User dev: benny@piranusa (leader), deska/fathur/yoel@piranusa (sales), semua di tim "Tim Sales".

---

## 0. Prinsip & Model

- **Model B (sementara, sampai dapat WhatsApp API resmi):** tiap sales pakai **nomor WhatsApp sendiri** (Baileys). Leader punya **nomor intake** sendiri (juga Baileys). WhatsApp **tidak bisa memindahkan thread antar nomor**, jadi handoff = sales memulai chat baru dari nomornya sendiri + customer diberi **pesan pengantar** dari nomor leader.
- **Nanti (Model A):** satu nomor pusat via **WhatsApp Business Cloud API resmi** (lebih tahan ban, semua sales balas dari satu nomor). Belum dikerjakan.
- **Routing bersifat deterministik (bukan AI)** supaya transparan & bisa diaudit. **AI dipakai untuk memahami lead** (kualifikasi, ringkasan, draft), bukan untuk memutuskan pembagian.
- **Peran:** `leader` (intake + bagikan lead + kelola tim/profil sales), `sales` (tindak lanjut lead yang di-assign), `ceo`/`superadmin` (monitoring/teknis).

---

## 1. Aktor & Data Inti

### Tabel utama
| Tabel | Peran | Kolom penting |
|---|---|---|
| `contacts` | Data pelanggan/lead | `phone_number`, `whatsapp_id`, `email`, `company`, `city`, `custom_attributes` (JSON: `product_interest`, `pipeline_stage`, `import_notes`, `assigned_user_id`, `lead_score`, `estimated_value`, `tags`, dll) |
| `conversations` | Percakapan WA | `inbox_id`, `contact_id`, **`assignee_id`**, **`team_id`**, `status`, `additional_attributes.personal_whatsapp` (`{owner_user_id, lead_registration_id, lead_status}`) |
| `messages` | Pesan | `message_type` (incoming/outgoing), `sender_type` (user/bot), `content`, `content_attributes` |
| `tasks` | Daftar tugas | `assignee_id`, `team_id`, `contact_id`, `conversation_id`, `action_kind` (`follow_up`, dll), `source` (`ai_whatsapp`/`import`/`manual`/`routing`), `status` (`open`/`in_progress`/`done`), `due_at`, `priority`, `ai_snapshot` (JSON: `summary`, `suggestedReply`) |
| `task_events` | Audit tugas | `event_type` (`created`/`updated`/`reassigned`/`snoozed`/`replied_whatsapp`/`completed`) |
| `sales_profiles` | Profil routing sales | `product_skills[]`, `segments[]`, `level`, `max_active`, `work_hours`, `regions[]`, `languages[]`, `tags[]`, `notes` — unik `(app_id,user_id)` |
| `whatsapp_lead_registrations` | Kepemilikan lead per WA | `owner_user_id`, `phone_number`, `contact_id`, `conversation_id`, `status` (`pending`/`confirmed`/`blocked`/`ignored`), **`ai_handling_enabled`**, `takeover_by/at/source/reason`, `released_at` — unik `(app_id,owner_user_id,phone_number)` |
| `baileys_sessions` | Koneksi WA per user | `owner_user_id`, `channel_id`, `status` (`connected`/`qr_ready`/`connecting`/`reconnecting`/`logged_out`/`rate_limited`/…), `qr_code`, `auth_state` |
| `whatsapp_channels` | Channel WA | `inbox_id`, `api_key`, `provider` (`baileys`), `extended_metadata` |
| `personal_ai_settings` | Setting auto-reply per owner | `auto_reply_enabled`, `review_enabled`, `reply_delay_seconds`, `min_confidence`, `persona_prompt` |
| `personal_ai_reply_tasks` | State pipeline balasan AI | `status` (`scheduled_review`→`reviewing`→`scheduled_reply`→`composing`→`draft_ready`/`sent`/`handover`/`ignored`/`cancelled`), `review_result`, `draft_text`, `rag_context` |
| `knowledge_faqs`, `knowledge_chunks` | Basis pengetahuan (RAG) | FAQ + potongan dokumen + embedding |
| `notifications` | Notifikasi in-app | via `NotificationService` |
| `import_jobs`, `import_job_rows` | Import CSV | preview → commit |

---

## 2. Flow Bisnis E2E (ringkas)

```
(A) MASUKIN PELANGGAN
    - Import CSV (leader) ATAU tambah lead manual (leader) ATAU lead chat masuk (WA)
        │
(B) LEAD MASUK KE NOMOR LEADER (WA intake) → percakapan di inbox leader
        │
(C) KUALIFIKASI  [M4 — belum]
    - AI di nomor leader menggali kebutuhan → "profil kebutuhan lead"
        │
(D) BAGIKAN KE SALES  [M2 — selesai]
    - Leader klik "Bagikan" → Routing Engine kasih rekomendasi sales
      (skor: keahlian 40% + beban 30% + pemerataan 30%) + alasan
    - Set conversations.assignee_id + team_id, buat task, notifikasi sales
        │
(E) HANDOFF  [M3 — selesai]
    - Pesan pengantar dari nomor leader ke customer (opsional, bisa diedit)
    - AI di nomor leader DIHENTIKAN untuk lead itu (takeover)
        │
(F) SALES TINDAK LANJUT
    - Sales dapat notifikasi + task → buka task → lihat ringkasan AI + opener
    - Klik "Ambil Alih & Chat di CRM" → percakapan dibuka di NOMOR SALES
      → sales chat customer dari nomornya sendiri sampai closing
        │
(G) SEPANJANG JALAN
    - Takeover/handover manual & otomatis (Alih Tugas) + SLA
    - Notifikasi (draft AI, lead di-assign, takeover, dll)
    - Task list ter-update (follow-up, status)
    - Knowledge base memberi konteks jawaban AI (RAG)
```

---

## 3. Per-Komponen: Bisnis → Teknis

### 3.1 Masukin Pelanggan (Lead Entry)
**Bisnis:** leader memasukkan pelanggan lewat 3 jalur — impor CSV massal, tambah manual satu-satu, atau lead yang chat sendiri ke WA. Setiap lead non-closed menghasilkan **task follow-up** untuk sales.

**Teknis:**
- **Import CSV:** modul `apps/backend/src/modules/import/` (`service.ts`, `parser.ts`, `index.ts`). Endpoint `POST /import/preview`, `POST /import/commit`, `GET /import/assignables`. Preview → validasi baris → commit membuat/perbarui `contacts` (+ `custom_attributes`) dan `tasks` (`source:'import'`) per lead ter-assign. Sample: `docs/samples/leads-import-sample.csv`.
- **Manual lead:** `ImportService.createManualLead` + `GET /import/assignables`, `POST /import/manual-lead`. Frontend: card "Tambah Lead Manual" di `apps/frontend/src/routes/_app/import.tsx`. Membuat contact + task `source:'manual'`, due +3 hari (kecuali stage closed).
- **Lead chat masuk:** lihat 3.2.
- **Profil sales** (bahan routing) diatur leader di `/sales-profiles` — lihat 3.3.

**Status:** ✅ Selesai (CSV + manual + profil sales).

### 3.2 Chat / Inbox (WA Personal)
**Bisnis:** semua percakapan WA (leader & sales) muncul di `/chat`. AI bisa auto-reply; manusia bisa ambil alih.

**Teknis:**
- Microservice **`whatsapp-service/`** (Baileys) menjaga koneksi, mengirim webhook pesan masuk ke CRM.
- Backend modul `apps/backend/src/modules/personal-whatsapp-inbox/` (`index.ts`, `ai-reply.ts`, `takeover.ts`, `lead-access.ts`).
  - Ingest: `POST /personal-whatsapp-inbox/ingest` (webhook) → diproses di `apps/backend/src/modules/webhook/service.ts` (~baris 1821 memanggil `PersonalAiReplyService.scheduleInbound`).
  - Mulai chat baru: `POST /personal-whatsapp-inbox/start` (create/find contact+conversation di inbox owner).
  - Kirim pesan: `POST /personal-whatsapp-inbox/:conversationId/messages`.
- **Auto-reply AI** (`ai-reply.ts`, `PersonalAiReplyService`): pipeline `scheduleInbound → processReview (gpt-5-nano) → processCompose (gpt-5-mini) → sent/draft`. RAG via `retrieveKnowledge` + `text-embedding-3-small`. Persona & profil pelanggan via `buildCustomerProfile`. Env: `PERSONAL_AI_OPENAI_API_KEY`, `PERSONAL_AI_OPENAI_BASE_URL` (WAJIB eksplisit `https://api.openai.com/v1`), `PERSONAL_AI_REVIEW_MODEL`, `PERSONAL_AI_COMPOSE_MODEL`, `PERSONAL_AI_EMBED_MODEL`.
  - **Gate penting:** `scheduleInbound` melewati lead ber-status `blocked`/`ignored` dan yang sudah di-takeover (`ai_handling_enabled=false`).
- Frontend: `apps/frontend/src/routes/_app/chat.tsx`.
- **Reconnect setelah unlink:** `whatsapp-service` menangani `DisconnectReason.loggedOut` → status `logged_out` + `auth_state` dibersihkan; halaman `apps/frontend/src/routes/whatsapp.connect.tsx` regenerate QR (helper `needsFreshQr`) + tombol "Hubungkan ulang". Leader boleh connect (tidak dipaksa gate). `/chat` **tidak** lagi memaksa redirect ke connect bila WA belum tersambung (pakai prompt inline `WhatsappOnboarding`).

**Status:** ✅ Selesai (inbox, auto-reply, reconnect, leader connect).

### 3.3 Indikator Assign Chat ke Sales (Routing)
**Bisnis:** leader membagikan lead ke sales paling cocok; percakapan menunjukkan siapa yang memegang.

**Teknis:**
- **Profil sales:** modul `apps/backend/src/modules/sales-profiles/` (`service.ts`, `index.ts`). Endpoint `GET /sales-profiles` (daftar sales + profil + **beban aktif** dari task open/in_progress), `PUT /sales-profiles/:userId`. Frontend `apps/frontend/src/routes/_app/sales-profiles.tsx` (daftar ringkas + modal edit).
- **Routing engine:** modul `apps/backend/src/modules/lead-routing/` (`service.ts`, `index.ts`).
  - `GET /lead-routing/:conversationId/suggest` → kandidat terurut + skor + alasan. **Skor = 0.40×kecocokan produk + 0.30×beban + 0.30×pemerataan** (`WEIGHTS`). Sales penuh (`activeLoad ≥ max_active`) didorong ke bawah.
  - `POST /lead-routing/:conversationId/assign` → set `conversations.assignee_id` + `team_id`, buat/pakai-ulang task `source:'routing'` (dedup per contact), **hentikan AI leader** (takeover + cancel), notifikasi sales (`lead_pending`), emit `lead-routing:assigned`.
- **UI:** tombol **"Bagikan"** di header `/chat` (hanya `leader/ceo/superadmin` — gate `canRoute` pakai `normalizeAppRole`). Komponen `apps/frontend/src/components/LeadRoutingDialog.tsx` (rekomendasi + skor + alasan + override + opsi pesan pengantar).
- **Indikator pemegang:** `conversations.assignee_id`; badge workflow di daftar chat (`ai`/`handover`/`human`).

**Status:** ✅ Selesai (M2). Auto-assign otomatis + track record → M5 (belum).

### 3.4 Takeover / Handover (Ambil Alih)
**Bisnis:** manusia mengambil alih dari AI (atau AI mengeskalasi ke manusia). Lead yang diambil alih muncul di halaman **Alih Tugas** dengan SLA.

**Teknis:**
- `apps/backend/src/modules/personal-whatsapp-inbox/takeover.ts` (`PersonalTakeoverService`): `takeover`, `release`, `count`, `list`, `history`, `isAiHandlingEnabled`. Menyetel `whatsapp_lead_registrations.ai_handling_enabled`. SLA env `PERSONAL_TAKEOVER_SLA_MINUTES` (default 30).
- Endpoint: `POST /personal-whatsapp-inbox/:conversationId/takeover` (manual), `/release` (balik ke AI), `/ignore` (abaikan lead), `/leads/:id/{confirm,reject,block,unblock}`.
- **Handover otomatis (AI → manusia):** di `ai-reply.ts` — `detectDeterministicHandover` (minta manusia/komplain/tidak puas) + gate confidence (`min_confidence`, `needsHuman`) → `takeover(source:'ai')` + notifikasi.
- **Handoff routing (leader → sales):** saat "Bagikan", AI nomor leader di-takeover; task TIDAK ditaut ke percakapan leader; sales lanjut dari nomornya via `TaskService.openChat` ("Ambil Alih & Chat di CRM").
- Frontend: tombol "Ambil Alih"/"Kembalikan ke AI"/"Abaikan" di `/chat`; halaman `apps/frontend/src/routes/_app/alih-tugas.tsx` (daftar + SLA "Sudah dibalas/Menunggu dibalas" + deep-link "Buka Chat").

**Status:** ✅ Selesai (manual + otomatis + SLA). 

### 3.5 Notifikasi
**Bisnis:** sales/leader dapat pemberitahuan untuk hal penting (lead baru di-assign, draft AI siap, di-takeover, WA putus).

**Teknis:**
- `apps/backend/src/modules/notifications/service.ts` (`NotificationService.notify/resolve`). Tipe: `takeover`, `lead_pending`, `task_urgent`, `ai_draft`, `wa_disconnected`. Fitur: dedup (`dedupKey`), auto-resolve, emit realtime `notification:new`.
- Producer: routing assign (`lead_pending`), auto-reply draft (`ai_draft`), takeover AI (`takeover`), dll.
- Frontend: bell di `TopBar` (tampil di semua device), dropdown mark-read, badge sidebar (mis. count "Kotak Masuk").

**Status:** ✅ Selesai.

### 3.6 Task List (Daftar Tugas)
**Bisnis:** sales bekerja dari daftar tugas (follow-up). Tugas berasal dari: analisis AI chat, import CSV, lead manual, dan routing.

**Teknis:**
- Modul `apps/backend/src/modules/tasks/` (`service.ts`, `analyzer.ts`, `worker.ts`, `index.ts`, `lead-brief.ts`, `policy.ts`, `model.ts`).
- Endpoint: `GET /tasks` (filter `view/status/priority`), `GET /tasks/summary/today`, `GET /tasks/:id/detail`, `GET /tasks/:id/events`, `POST /tasks`, `PATCH /tasks/:id`, `POST /tasks/:id/reply-whatsapp`, `POST /tasks/:id/snooze`, **`POST /tasks/:id/open-chat`**.
- **Lead-brief AI:** `lead-brief.ts` (`generateLeadBrief` + fallback deterministik) — dipanggil lazily di `TaskService.detail` untuk lead import/manual/routing tanpa percakapan; hasilnya di-cache ke `tasks.ai_snapshot` (`summary` + `suggestedReply`).
- **openChat:** `TaskService.openChat` — buat/temukan percakapan di inbox **sales** (by phone), takeover, tautkan task, buka `/chat`.
- Frontend: `apps/frontend/src/routes/_app/tasks/index.tsx` (checklist + tabs: Hari ini/Terlambat/Sedang dikerjakan/Selesai) + `apps/frontend/src/routes/_app/tasks/$taskId.tsx` (ringkasan AI + aksi kontekstual: balas WA / "Ambil Alih & Chat di CRM" / email / "Ingatkan lagi").

**Status:** ✅ Selesai.

### 3.7 Knowledge Base (RAG)
**Bisnis:** jawaban AI harus berbasis fakta produk PIRANUSA (ZWCAD/Archicad/dll), bukan mengarang.

**Teknis:**
- Tabel `knowledge_faqs` (+ prioritas) & `knowledge_chunks` (potongan dokumen). Seed & sumber di `apps/backend/knowledge/`.
- Dipakai di `ai-reply.ts` → `retrieveKnowledge(appId, query)`: kandidat via keyword + ranking cosine similarity embedding (`text-embedding-3-small`, cache di Redis). Top-5 disuntik ke prompt compose.
- Frontend: `apps/frontend/src/routes/_app/knowledge.tsx` (upload/kelola oleh leader).

**Status:** ✅ Selesai (upload leader + RAG + seed terverifikasi).

---

## 4. Peta File (untuk implementasi lanjutan)

**Backend (`apps/backend/src/modules/`):**
- `personal-whatsapp-inbox/` → inbox, `ai-reply.ts` (auto-reply+RAG), `takeover.ts`, `lead-access.ts`
- `tasks/` → task, `lead-brief.ts`, `analyzer.ts`, `worker.ts`
- `sales-profiles/` → profil sales
- `lead-routing/` → routing (suggest/assign)
- `import/` → CSV + manual lead
- `notifications/` → notifikasi
- `knowledge/` → knowledge base
- `webhook/service.ts` → proses pesan masuk (memanggil scheduleInbound)
- `auth/index.ts` → `/auth/me` (di-enrich dengan role `users` — sumber kebenaran role frontend)
- `whatsapp/` → channel/koneksi (proxy ke microservice)

**Microservice:** `whatsapp-service/src/runtime.ts` (Baileys: koneksi, QR, reconnect, kirim/terima).

**Frontend (`apps/frontend/src/`):**
- `routes/_app/chat.tsx`, `tasks/{index,$taskId}.tsx`, `sales-profiles.tsx`, `alih-tugas.tsx`, `import.tsx`, `knowledge.tsx`
- `routes/whatsapp.connect.tsx`
- `components/LeadRoutingDialog.tsx`
- `lib/api.ts`, `lib/crm-navigation.ts`, `lib/role-access.ts`, `routes/_app.tsx` (context + gate + hidrasi role)

---

## 5. Status & Milestone Berikutnya

| Milestone | Status |
|---|---|
| M1 — Data & Profil Sales | ✅ |
| M2 — Routing + "Bagikan" | ✅ |
| M3 — Handoff (pengantar + Mulai Chat + stop AI leader) | ✅ |
| Pendukung: reconnect WA, leader connect, role fix, aksi lead (Abaikan/Blokir), fix /chat terpental | ✅ |
| **M4 — Kualifikasi AI di nomor leader** (gali kebutuhan → simpan profil kebutuhan lead di `conversations.additional_attributes.lead_need`; gerbang "siap di-assign") | ⬜ **Berikutnya** |
| M5 — Auto-assign otomatis + track record/win-rate dalam skor | ⬜ |
| M6 — SLA/re-assign otomatis kalau sales diam | ⬜ |
| M7 — faktor lunak (kepribadian) + evaluasi WhatsApp Cloud API resmi | ⬜ |

**Prasyarat uji E2E:** nomor WA leader (benny) harus **connected** (saat ini `qr_ready`) untuk menguji intake + pesan pengantar + kualifikasi.

---

## 6. Konvensi & Batasan (WAJIB dipatuhi)

- **Commit**: Bahasa Inggris, Conventional Commits, tanpa kontributor Claude/co-author.
- **Package manager**: `bun`. DB via **`prisma db push`** (bukan `migrate`).
- **Validasi sebelum commit**: backend `cd apps/backend && bun run lint` (tsc); frontend `cd apps/frontend && bun run build`; microservice `cd whatsapp-service && bun run typecheck`; whitespace `git diff --check`.
- **JANGAN commit**: `docs/*` (dokumen kerja internal, termasuk file ini), `.env`, file rahasia.
- **Baileys/WhatsApp = production-sensitive**: hati-hati, hindari kirim pesan tak sengaja (pernah ada insiden kirim ke nomor sample). Auto-send hanya bila leader/sales konfirmasi.
- **Model AI GPT-5**: hanya menerima temperature default (1); base URL harus eksplisit ke OpenAI (global `OPENAI_BASE_URL` dipakai GLM/Z.ai → bisa salah kirim/401).
- **Role frontend**: sumber kebenaran = `/auth/me` (di-enrich dari tabel `users`); perbandingan role harus lewat `normalizeAppRole`.
- **Pairing code**: JANGAN dihapus (dead code sekarang, akan dipakai untuk login via HP nanti).
