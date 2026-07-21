# W2C — What to Change: Sistem WhatsApp-First Sales AI

Panduan praktis: "kalau mau ubah X, sentuh di mana". Baca `w2u-whatsapp-sales-ai.md` dulu untuk konteks arsitektur.

Semua path relatif ke root repo. Backend: `apps/backend`, frontend: `apps/frontend`.

## Aturan main (baca dulu)
- Setelah ubah **kode backend** → **restart backend** (worker jalan dari kode terkompilasi).
- Ubah **schema** → `bunx prisma db push` lalu `bunx prisma generate` (proyek ini pakai db push, BUKAN migrate).
- Validasi: backend `cd apps/backend && bun run lint` (tsc), frontend `cd apps/frontend && bun run build`.
- `personal_ai_reply_tasks` & `personal_ai_settings` = tabel raw SQL (di `ai-reply.ts` `ensureStorage`), bukan Prisma.
- Jangan commit `.env` (gitignored).

---

## Katalog perubahan umum

### 1. Ganti model / provider AI
- **Auto-reply:** `.env` → `PERSONAL_AI_REVIEW_MODEL`, `PERSONAL_AI_COMPOSE_MODEL`, `PERSONAL_AI_EMBED_MODEL`, `PERSONAL_AI_OPENAI_API_KEY`, `PERSONAL_AI_OPENAI_BASE_URL`. Builder: `chatModel()` / `embeddingModel()` di `personal-whatsapp-inbox/ai-reply.ts`.
- **Task analyzer:** `.env` → `OPENAI_*` (base URL GLM). Kode: `tasks/analyzer.ts`.
- ⚠️ Model GPT-5 hanya menerima `temperature` default → di `chatModel()` temperature dipatok 1. Jangan kirim nilai lain.

### 2. Ubah trigger handover (kata kunci)
`personal-whatsapp-inbox/ai-reply.ts`:
- Minta manusia / keluhan → array `HUMAN_REQUEST_PATTERNS`.
- Ketidakpuasan pasca-balasan-AI → array `DISSATISFACTION_PATTERNS`.
- Logika: fungsi `detectDeterministicHandover`.

### 3. Ubah ambang keyakinan handover
- Auto-reply: `personal_ai_settings.min_confidence` per sales (default 0.65) — via UI Pengaturan atau `updateSettings`.
- Task: `.env` `TASK_ANALYSIS_MIN_CONFIDENCE` / `TASK_ANALYSIS_REVIEW_CONFIDENCE` (`tasks/worker.ts`).

### 4. Ubah window baca lead (25→50)
`.env` `TASK_ANALYSIS_WINDOW_INITIAL` / `TASK_ANALYSIS_WINDOW_MAX`, dipakai di `tasks/worker.ts` (`analyzeWithWindow`). Ingat: ini untuk klasifikasi lead, bukan target balasan.

### 5. Ubah "apa yang dibalas AI" (giliran)
`splitConversationTurn` di `ai-reply.ts`. Prompt terkait ada di `processReview` & `processCompose` (blok "PESAN TERBARU" vs "RIWAYAT").

### 6. Ubah gaya balasan / aturan sapaan / persona
- Aturan global (mis. larangan salam) → system prompt di `processCompose` (`ai-reply.ts`).
- Persona per sales → `personal_ai_settings.persona_prompt` (UI Pengaturan → "AI balasan WhatsApp").

### 7. Aktif/nonaktifkan auto-kirim
`personal_ai_settings.auto_reply_enabled` (UI Pengaturan). `true` = AI kirim otomatis; `false` = hanya draft (`draft_ready`) + notifikasi `ai_draft`.

### 8. Tambah kategori notifikasi
1. Backend: tambah tipe di `NotificationType` (`notifications/service.ts`) + panggil `NotificationService.notify({...})` di titik produsen.
2. Auto-resolve (opsional): `NotificationService.resolve(appId,userId,dedupKey)` saat kondisi beres.
3. Frontend `components/TopBar.tsx`: tambah ikon di `NOTIF_ICON` + tujuan klik di `notifDestination`.

### 9. Ubah SLA Alih Tugas
`.env` `PERSONAL_TAKEOVER_SLA_MINUTES` (dipakai `PersonalTakeoverService.list` di `takeover.ts`; ditandai "lewat SLA" di `routes/_app/alih-tugas.tsx`).

### 10. Tambah / ubah knowledge produk (RAG)
- Cara normal: upload di UI `/knowledge` (leader).
- Cara seed massal: `apps/backend/scripts/seed-knowledge-products.ts` (idempotent, tag `seed:product-catalog`). RAG membaca `knowledge_chunks` + `knowledge_faqs` via `retrieveKnowledge` (`ai-reply.ts`).

### 11. Ubah field profil pelanggan yang dilihat AI
`buildCustomerProfile` di `ai-reply.ts` (label di `CUSTOM_ATTR_LABELS`, prioritas di `PRIORITY_CUSTOM_ATTRS`). Field kontak diambil di `conversationContext`.

### 12. Ubah trigger task masuk / status task
- Enqueue: `webhook/service.ts` (jalur pending + confirmed).
- Skip/allow lead: `tasks/worker.ts` (`processTaskAnalysisJob`, cek `blocked`).
- Auto-start/complete: `tasks/service.ts` (`markInProgressOnConversationReply`, `replyWhatsapp`, `complete`).
- UI: `routes/_app/tasks/index.tsx` & `$taskId.tsx`.

### 13. Tambah/ubah menu & akses halaman
- Menu sidebar: `lib/crm-navigation.ts` (`CRM_NAV_ITEMS`).
- Akses per role: `lib/role-access.ts` (`SALES_PATHS`, `LEADER_PATHS`, dst).

### 14. Ubah pemicu notifikasi WA terputus
`whatsapp/baileys-runtime.ts`: `notifyWhatsappDisconnected` (branch `logged_out` + `disconnected`) dan `resolveWhatsappReconnected` (branch `open`).

---

## Gotchas (jebakan yang sudah pernah kena)
- **`OPENAI_BASE_URL` global (GLM) diwarisi SDK OpenAI** → key OpenAI bisa terkirim ke Z.ai (401). Auto-reply memaksa base URL eksplisit; jangan hapus itu.
- **GPT-5 tolak temperature custom & pakai reasoning tokens** → set `reasoning_effort` (minimal/low) untuk hemat & cepat.
- **Auto-reply hanya lead confirmed** → kalau test dengan lead pending, AI tidak akan balas.
- **Takeover mematikan AI total** untuk lead itu sampai "Kembalikan ke AI".
- **Reassign antar-sales belum didukung** — tiap lead terikat nomor WA pemiliknya.
- **Restart backend** setelah ubah kode; kalau tidak, worker jalan kode lama.

## Cara test cepat
- Auto-reply end-to-end: kirim WA dari nomor kedua ke nomor sales (lead confirmed, auto-reply ON) → balasan muncul ~20 dtk.
- Handover: kirim "mau komplain" / "bicara dengan manusia" → lead pindah ke Alih Tugas + bell.
- Skrip verifikasi terisolasi: buat `scripts/tmp-*.ts`, jalankan `bun run scripts/tmp-*.ts` (proses tetap hidup karena redis; baca output lalu hentikan), lalu hapus.
