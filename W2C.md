# W2C: What Changed

## Snapshot perbandingan

- Baseline production: `main` pada `f00ad5f` (`main` juga 1 commit di depan `origin/main`).
- Branch fitur: `origin/feat/tasks-list` pada `8668734`.
- Merge-base: `293bd259`.
- Branch fitur berisi 6 commit yang belum ada di `main`.
- Dari sisi branch fitur ada 44 file yang berubah dengan sekitar 6.963 insertion dan 99 deletion.
- Lima file overlap langsung dengan perubahan `main`: `apps/backend/package.json`, `apps/backend/src/modules/personal-whatsapp-inbox/index.ts`, `apps/frontend/src/lib/api.ts`, `apps/frontend/src/routes/_app/chat.tsx`, dan `bun.lock`.
- Simulasi merge menunjukkan satu konflik Git formal, yaitu `bun.lock`. File sumber yang overlap bisa di-auto-merge, tetapi tetap perlu typecheck dan review perilaku.

## Yang sudah ditambahkan oleh branch fitur

### 1. Task list dan workflow AI sales

- Model dan service task baru: task, task event, status, priority, due date, snooze, completion, assignee, dan audit event.
- AI analyzer dua tahap menggunakan `@langchain/openai`: classifier murah lalu generator detail/draft reply.
- Queue BullMQ baru `ai-processing` dan worker analisis task.
- Analisis inbound WhatsApp dilakukan pada lead pending maupun confirmed; job memakai deterministic ID untuk deduplikasi.
- Endpoint task untuk list, summary, detail, start, complete, snooze, dan reply via WhatsApp.
- UI baru: `/tasks`, `/tasks/:taskId`, detail task di customer, dan action reply/complete/snooze.
- Knowledge context produk untuk membantu classifier, plus `apps/backend/knowledge/product-catalog.md` dan seed terkait.

### 2. Personal WhatsApp: lead detection dan takeover

- Auto-detection buying signal pada inbound personal WhatsApp.
- Per-conversation takeover AI → human dan release human → AI.
- Endpoint/history/count takeover serta halaman `/alih-tugas`.
- Field baru pada `whatsapp_lead_registrations`, antara lain `ai_handling_enabled`, takeover actor/time/source/reason, note, dan release time.
- Chat menampilkan action `Ambil Alih` dan `Kembalikan ke AI`.
- Auto-reply personal WhatsApp dipindahkan dari alur Ollama ke OpenAI-compatible (`ChatOpenAI`), dengan default model review/compose berbasis GPT.

### 3. In-app notifications

- Model `notifications`, dedup key, read/unread, mark one/all read, list, dan count.
- Notification untuk pending lead, takeover, task urgent, AI draft, dan WhatsApp disconnect.
- TopBar notification popover, badge realtime, dan navigasi ke konteks terkait.
- Badge live untuk inbox dan alih tugas di Sidebar.

### 4. CSV lead import

- Module backend import, parser CSV, preview, per-sales assignment, contact upsert, dan task creation.
- Model `import_jobs` dan `import_job_rows` di Prisma schema.
- UI baru `/import`.
- Script seed dev users, simulasi sales, knowledge product, dan katalog produk.

### 5. Navigation, API, dan route tree

- API client frontend bertambah untuk tasks, notifications, takeover, dan import.
- Role access menambahkan tasks/alih tugas/import sesuai role.
- Sidebar, TopBar, BottomNav, customer detail, dan chat diperbarui.
- `routeTree.gen.ts` diperbarui untuk route baru.

### 6. Dependency dan environment

- `apps/backend/package.json` menambah `@langchain/openai` dan script `db:seed:dev-users`.
- `.env.example` menambah `OPENAI_BASE_URL`, `OPENAI_CLASSIFIER_MODEL`, dan `OPENAI_GENERATOR_MODEL`.
- Branch feature membawa lockfile dengan Baileys WhatsApp service `rc13`.

## Baseline production yang hanya ada di `main`

Perubahan production di `main` tidak boleh hilang saat integrasi:

- Deploy VPS memakai Bun, build backend/frontend, Prisma generate, `db:push`, restart PM2, dan reload Nginx.
- Nginx proxy untuk CRM media/MinIO dan konfigurasi `S3_PUBLIC_URL`.
- Session persistence cookie fallback dan perbaikan mobile chat/bottom navigation.
- WhatsApp service production memakai Baileys `rc10`, `@elysiajs/node`, dan SOCKS proxy; ini adalah baseline yang sudah dipakai untuk deployment.
- Perbaikan permission/build/deploy, cache Nginx, profile sync worker, dan patch Baileys.

## Hasil validasi

Working copy branch fitur berhasil:

- `bun install --frozen-lockfile --ignore-scripts`
- `bun run db:generate` dengan `DATABASE_URL` dummy
- `bun run lint`

Lint branch lulus setelah Prisma client digenerate. Validasi ini hanya membuktikan branch fitur mentah dapat dikompilasi; belum membuktikan gabungan dengan baseline production `main` atau perilaku di VPS.

