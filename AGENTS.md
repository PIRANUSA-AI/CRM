# AGENTS.md

Panduan kerja untuk agent/developer di repo **CRM Piranusa**. Baca dulu sebelum ngoprek.

---

## Project Overview

CRM internal **PT Piranusa** (distributor software CAD/BIM: ZWCAD, Archicad, ZW3D, dll). Monorepo berisi:
- **Backend API** (Elysia + Bun + Prisma + PostgreSQL)
- **Frontend** (React + TanStack Router + Vite)
- **WhatsApp service** (Baileys — socket per nomor sales)
- **Shared package** (`packages/shared`)

Lihat detail alur di `docs/` (`W2I.md`, `SYSTEM_FLOW.md`, `role-dan-akses.md`).

---

## Struktur

```
apps/
  backend/          # API Elysia (:3010), worker, scheduler (APP_MODE)
    src/modules/    # tiap domain = 1 folder (index.ts route, service.ts, model.ts)
    prisma/         # schema.prisma + migrations
    knowledge/      # basis pengetahuan RAG (DATA, bukan dokumen)
  frontend/         # React SPA (:3005)
    src/routes/     # TanStack file-routes (_app/* = butuh login, whatsapp.connect = publik)
whatsapp-service/   # microservice Baileys (:3012)
packages/shared/    # tipe/util shared
docs/               # semua dokumentasi .md
scripts/            # snapshot dump/restore, deploy
```

---

## Command (semua pakai `bun`)

### Development
```bash
bun run dev              # all-in-one: docker + backend + worker + frontend + whatsapp-service
bun run dev:backend      # backend API saja (APP_MODE=api, watch)
bun run dev:frontend     # frontend saja (:3005)
cd whatsapp-service && bun run dev   # WA service (tsx watch, :3012)
```

### Build / cek
```bash
bun run build                 # build semua workspace
cd apps/backend && bun run lint       # tsc --noEmit (WAJIB sebelum commit)
cd apps/frontend && bun run build     # build frontend (cek type)
cd whatsapp-service && bun run typecheck
```

### Database (pakai `prisma db push`, BUKAN migrate)
```bash
bun run db:generate    # prisma generate
bun run db:push        # push schema ke DB
bun run db:studio      # prisma studio
```

### Services (docker)
```bash
bun run dev:services    # docker compose up (postgres/redis/minio)
```

---

## Tech Stack

| Layer | Teknologi |
|-------|-----------|
| Backend | Elysia (Bun), Prisma ORM, PostgreSQL, Redis (BullMQ queue), Socket.IO |
| Auth | better-auth (email/password + bearer), tabel `users` = sumber role |
| Frontend | React, TanStack Router/Query, Vite, Tailwind |
| WhatsApp | `whatsapp-service` (Elysia + Baileys rc13), 1 socket per channel, auth file-based |
| AI | provider routing (growthcircle/azure/sumopod) + dedicated OpenAI untuk personal WA |
| Storage | MinIO/S3 (media), Redis (queue + adapter socket) |

---

## Konvensi (WAJIB)

- **Package manager: `bun`** (jangan npm/yarn/pnpm).
- **DB: `prisma db push`** untuk dev (bukan `migrate`), kecuali ada migration SQL spesifik.
- **Commit**: Conventional Commits (English), tanpa co-author agent.
- **Validasi sebelum commit**: backend `bun run lint` (tsc), frontend `bun run build`, WA service `bun run typecheck`, whitespace `git diff --check`.
- **Role**: sumber kebenaran = `/auth/me` (di-enrich dari `users.role`); bandingkan role lewat `normalizeAppRole` di `lib/role-access.ts`.
- **JANGAN commit**: `.env`, `whatsapp-service/auth-data/` (kredensial sesi Baileys), file rahasia.
- **Baileys/WhatsApp = production-sensitive**: hati-hati kirim pesan, auto-send hanya setelah konfirmasi.
- **Model AI GPT-5**: temperature default (1) saja; base URL personal WA harus eksplisit OpenAI (`PERSONAL_AI_OPENAI_BASE_URL`).

---

## Role & Akses

5 role: `superadmin`, `ceo`, `administrator`, `leader`, `sales`. Path mapping di `apps/frontend/src/lib/role-access.ts`. Scope data per role ada di tiap service backend (`dealVisibilityScope`, `resolveTeamSales`, dll). Detail lengkap: `docs/role-dan-akses.md`.

---

## Modul Backend Penting (`apps/backend/src/modules/`)

| Modul | Fungsi |
|-------|--------|
| `personal-whatsapp-inbox/` | WA pribadi per sales + AI reply (`ai-reply.ts`), takeover, lead-access |
| `lead-routing/` | assign lead (sekarang deterministik: product 0.4 + load 0.3 + fairness 0.3) |
| `sales-profiles/` | profil sales: persona, level, experience, product_skills, max_active |
| `tasks/` | task list + lead-brief AI + worker |
| `opportunities/` | pipeline/deals (stages, won/lost, revenue) |
| `metrics/` | dashboard, funnel, revenue (period max 30d, belum yearly) |
| `ai/` | provider routing, playground, org billing |
| `notifications/` | notif in-app (lead_pending, wa_disconnected, ai_draft, dll) |
| `webhook/service.ts` | proses pesan WA masuk → `scheduleInbound` |
| `whatsapp/` | channel/koneksi (proxy ke microservice :3012) |
| `contact/`, `crm/` | kontak & perusahaan |

---

## Gotchas

- **`baileys-runtime.ts` di backend = DEAD CODE**. Runtime asli Baileys ada di `whatsapp-service/src/runtime.ts`. Jangan edit yg di backend mengharap efek live.
- **`whatsapp-service` harus jalan di :3012** untuk fitur WA. `bun run dev` start otomatis; `dev:backend` + `dev:frontend` terpisah TIDAK. Cek: `curl localhost:3012/health`.
- **Auth state corrupt** (`failed to find key AAAAAKJO to decode mutation`) → fix: hapus `auth-data/<channelId>/` + reset `baileys_sessions` + scan QR baru.
- **`*.md` di-gitignore** (`docs/` working docs & root docs lokal). File tracked (SETUP, docs/*, README) sudah committed. `AGENTS.md` ini di-force-add.
- **Unique constraint `baileys_sessions.provider_channel_key`**: saat channel di-soft-delete tapi session orphan tersisa, reconnect bisa crash — `createBaileysChannel` pakai upsert by key (sudah di-fix).
- **CORS backend**: allow `localhost:3005/3000/3006/3009/5173` + `FRONTEND_URL`.

---

## Env (minimum dev)

`DATABASE_URL`, `REDIS_URL`, `S3_*`/`MINIO_*`, `BAILEYS_SERVICE_URL=http://127.0.0.1:3012`, `PORT=3010`, `VITE_API_URL=http://localhost:3010`, `FRONTEND_URL=http://localhost:3005`, `CRM_BAILEYS_WEBHOOK_PATH=/api/personal-whatsapp-inbox/ingest`. Detail: `docs/SETUP.md`.
