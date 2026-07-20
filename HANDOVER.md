# HANDOVER — CRM PIRANUSA

Dokumen serah terima untuk developer yang melanjutkan proyek ini.
Fokus: **peran Leader dan Sales**. Peran `ceo` dan `superadmin` disinggung
seperlunya saja.

Ditulis 2026-07-20, pada branch `development`.

---

## Daftar Isi

1. [Orientasi: produk ini sebenarnya apa](#1-orientasi)
2. [Menjalankan sistem](#2-menjalankan-sistem)
3. [Peta arsitektur](#3-peta-arsitektur)
4. [Middleware, auth, dan otorisasi](#4-middleware-auth-dan-otorisasi)
5. [Model data inti](#5-model-data-inti)
6. [Flow E2E tiap fitur](#6-flow-e2e-tiap-fitur)
7. [Detail kecil yang menjebak](#7-detail-kecil-yang-menjebak)
8. [Konvensi kerja](#8-konvensi-kerja)
9. [Status dan sisa pekerjaan](#9-status-dan-sisa-pekerjaan)

---

## 1. Orientasi

**PIRANUSA** adalah reseller resmi software CAD. Dua lini produk, dan
pembagian ini menentukan hampir semua logika tim di aplikasi:

| Lini | Produk | Tim | Pasar |
|---|---|---|---|
| MFG | ZWCAD | `MFG` | manufaktur, mekanikal |
| AEC | Archicad | `AEC` | arsitektur, konstruksi |

CRM ini **WhatsApp-first**. Customer tidak mengisi form — mereka chat WhatsApp,
dan seluruh siklus penjualan terjadi di dalam chat.

### Dua peran yang jadi fokus

**Leader** (contoh: Benny) — pintu masuk. Semua lead baru mendarat di nomor
WhatsApp leader. Tugasnya: kualifikasi awal lewat chat, lalu **membagikan lead
ke sales** yang paling cocok. Leader **tidak** menangani lead sampai closing.

**Sales** (contoh: Deska, Yoel, Fathur) — penerima lead. Setelah lead
di-assign, sales menghubungi customer **dari nomor WhatsApp-nya sendiri**, dan
membawanya sampai deal.

> **Konsekuensi teknis paling penting dari pembagian ini:** percakapan awal ada
> di inbox leader, dan percakapan lanjutan ada di inbox sales. **Keduanya
> percakapan yang berbeda.** Banyak keputusan desain di kode ini berakar dari
> sana — lihat [§7](#7-detail-kecil-yang-menjebak).

### Alur besar dalam satu tarikan napas

```
Customer chat WA  →  masuk nomor Leader  →  AI balas otomatis
                                              │
                     AI menyerah / customer minta manusia
                                              ↓
                                       Leader ambil alih
                                              ↓
                                    Leader kualifikasi lead
                                              ↓
                          Leader "Bagikan Lead" → skoring otomatis
                                              ↓
                    Sales terpilih dapat: task + notifikasi + briefing AI
                                              ↓
              Sales chat customer dari nomornya sendiri sampai closing
```

---

## 2. Menjalankan sistem

### Package manager

**`bun`.** Bukan npm, bukan yarn, bukan pnpm.

### Menyalakan semuanya

```bash
bun run dev        # dari root repo
```

Ini menjalankan `scripts/dev.ts`, yang berturut-turut:
1. membunuh proses yang menempel di port `3005`, `42069`, `42070`
2. `docker compose up -d --build`
3. inisialisasi MinIO
4. `bun run dev:apps` (backend API + frontend)
5. `bun run --filter backend dev:worker` (worker BullMQ)

### Port

| Port | Isi | Proses |
|---|---|---|
| 3005 | Frontend (Vite dev server) | `apps/frontend` |
| 3010 | Backend REST API, prefix `/api` | `apps/backend`, `APP_MODE=api` |
| 3011 | Socket.IO (realtime) | proses yang sama dengan 3010 |
| 3012 | **Baileys / WhatsApp service** | `whatsapp-service/` — **proses terpisah** |

### Database dan Redis — BACA INI

`docker-compose.yml` mendefinisikan Postgres dan Redis, **tapi aplikasi tidak
memakainya.** Yang dipakai adalah container lain yang sudah jalan di mesin dev:

| Yang dipakai aplikasi | Yang ada di docker-compose.yml |
|---|---|
| Postgres `localhost:5433` (container `cpira-postgres`) | `crm-postgres-1` di `5431` |
| Redis `localhost:6379` (container `dev-redis`) | `crm-redis-1` di `6380` |

Kalau kamu mengubah `docker-compose.yml` lalu heran datanya tidak berubah,
inilah sebabnya. Sumber kebenaran adalah `DATABASE_URL` dan `REDIS_URL` di
`apps/backend/.env`.

```bash
# koneksi DB untuk inspeksi manual
psql -h localhost -p 5433 -U crm -d crm_db
```

### Perubahan skema database

```bash
cd apps/backend && bunx prisma db push     # BENAR
cd apps/backend && bunx prisma migrate ... # JANGAN
```

Proyek ini tidak memakai folder migration. Prisma Client digenerate ke
`apps/backend/src/generated/prisma` (bukan `node_modules`), jadi setelah
mengubah `schema.prisma` jalankan `bunx prisma generate`.

### Validasi sebelum commit

```bash
cd apps/backend  && bun run lint     # = tsc --noEmit, harus bersih
cd apps/frontend && bun run build    # harus sukses
git diff --check                     # whitespace
```

> `apps/frontend` **tidak** punya ESLint/Biome/Prettier yang aktif untuk
> linting. `bunx tsc --noEmit` di frontend melaporkan **±115 error yang sudah
> ada sebelumnya** (mayoritas TS6133 variabel tak terpakai) dan build Vite
> menoleransinya. Patokan yang dipakai: **jangan menambah jumlahnya.** Cara
> mengukur: catat angkanya sebelum dan sesudah perubahanmu.

`apps/backend` tidak punya folder `test/`; skrip `test`-nya gagal. Itu kondisi
bawaan, bukan kerusakan yang kamu buat.

### Hot reload

Backend dev berjalan dengan `bun run --watch src/index.ts`, jadi **setiap
simpan file backend otomatis reload.** Tidak perlu restart manual.

> **JANGAN mematikan atau merestart proses `bun run dev` yang sedang jalan.**
> Ini lingkungan yang tersambung ke WhatsApp sungguhan. Kalau butuh menguji
> backend, ingat port 3010/3011 sudah terpakai — instansi keduamu akan gagal
> bind dan mati diam-diam. (Kesalahan ini pernah terjadi: tes yang dikira
> mengenai instansi sendiri ternyata mengenai dev server yang sedang jalan.)

---

## 3. Peta arsitektur

### Struktur monorepo (bun workspaces)

```
CRM/
├── apps/
│   ├── backend/          Elysia + Prisma + BullMQ
│   │   └── src/
│   │       ├── index.ts          entrypoint (semua APP_MODE)
│   │       ├── auth.ts           better-auth
│   │       ├── plugins/          app-context, socket, openapi
│   │       ├── lib/              prisma, queue, redis, require-role, realtime
│   │       ├── modules/          satu folder per domain  ← isi utama
│   │       └── workers/          entrypoint worker BullMQ
│   └── frontend/         React + TanStack Router/Start + Vite + Tailwind
│       └── src/
│           ├── routes/           file-based routing
│           ├── components/       termasuk ui/ (shadcn-style)
│           ├── lib/              api.ts, role-access.ts, socket.ts
│           └── hooks/
├── whatsapp-service/     Baileys, proses & port sendiri (3012)
├── packages/
├── scripts/dev.ts        orkestrator dev
└── docker-compose.yml    postgres/redis/minio (lihat catatan §2)
```

### Satu entrypoint, tiga mode

`apps/backend/src/index.ts` melayani ketiga peran, dibedakan `APP_MODE`:

| `APP_MODE` | Perintah | Fungsi |
|---|---|---|
| `api` | `bun run dev` | HTTP REST + Socket.IO |
| `worker` | `bun run dev:worker` | konsumen antrean BullMQ |
| `scheduler` | `bun run start:scheduler` | job terjadwal |

### Antrean BullMQ

Didefinisikan di `apps/backend/src/lib/queue.ts`:

`incoming-messages`, `outbound-messages`, `ai-processing`, `webhooks`,
`maintenance`, `cron-jobs`, `conversation-bulk`, `whatsapp-profile-sync`

Pesan keluar **selalu** lewat antrean `outbound-messages` — jangan pernah
memanggil Baileys langsung dari handler HTTP.

### Struktur satu modul backend

Hampir semua folder di `src/modules/<nama>/` mengikuti pola:

| File | Isi |
|---|---|
| `index.ts` | rute Elysia + validasi body (`t.Object`) + pemetaan error → status |
| `service.ts` | logika bisnis, satu-satunya yang menyentuh Prisma |
| `model.ts` | tipe request/response |
| `policy.ts` | aturan visibilitas/otorisasi (hanya di modul tertentu) |
| `worker.ts` | pemroses job (hanya di modul tertentu) |

Kalau menambah fitur, ikuti pola ini. Rute tidak query Prisma langsung.

---

## 4. Middleware, auth, dan otorisasi

Ini lapisan yang paling sering disalahpahami. Ada **empat** lapis terpisah.

### Lapis 1 — `app-context` (backend, global)

**File: `apps/backend/src/plugins/app-context.ts`**

Elysia plugin dengan `.derive({ as: 'global' })`, jadi **berlaku untuk semua
rute**. Tugasnya menyuntikkan dua nilai ke setiap handler:

- **`userId`** — diambil berurutan dari:
  1. `Authorization: Bearer <token>` → `getSessionFromBearerToken()`
  2. kalau kosong, session cookie better-auth → `auth.api.getSession()`
- **`resolvedAppId`** — tenant aktif, dari header `x-app-id`, slug organisasi,
  atau query.

```ts
.get('/', async ({ resolvedAppId, userId, set }) => {
  if (!resolvedAppId) { set.status = 400; return { error: 'App ID required' } }
  // ...
})
```

> **Untuk debugging manual:** kirim header `x-app-id`. Kalau sebuah endpoint
> membalas `400 {"error":"App ID required"}`, artinya endpoint itu hidup dan
> sudah sampai ke penjaganya — bukan 404.
>
> Endpoint yang butuh `userId` **tidak bisa** diuji dengan header saja; ia
> perlu token sesi. Untuk itu lebih praktis menguji di level service lewat
> skrip sementara (lihat [§8](#8-konvensi-kerja)).

### Lapis 2 — `requireRole` (backend, per rute)

**File: `apps/backend/src/lib/require-role.ts`**

```ts
export const CANONICAL_ROLES = ['sales', 'leader', 'ceo', 'superadmin']
export const ROLE_RANK = { sales: 0, leader: 1, ceo: 2, superadmin: 3 }
```

Dipakai di modul yang khusus leader, contoh
`apps/backend/src/modules/sales-profiles/index.ts`:

```ts
const ALLOWED_ROLES: CanonicalRole[] = ['leader', 'ceo', 'superadmin']
const authorization = await requireRole(userId, ALLOWED_ROLES)
```

`canGrantRole()` mengatur siapa boleh membuat akun peran apa: `sales`/`leader`
hanya boleh peran **di bawahnya**; `ceo`/`superadmin` boleh peran setara.

### Lapis 3 — policy per modul (backend, per baris data)

Ini yang menentukan **baris mana** yang boleh dilihat, bukan sekadar boleh
masuk atau tidak.

**File: `apps/backend/src/modules/tasks/policy.ts`**

```ts
export async function taskVisibilityScope(actor: TaskActor) {
  if (actor.role === 'sales')  return { assignee_id: actor.userId }
  if (actor.role === 'leader') return { OR: [
      { assignee_id: actor.userId },
      { team_id: { in: <tim yang diikuti leader> } },
  ]}
  return {}   // ceo/superadmin: semua
}
```

Pola serupa ada di:
- `modules/personal-whatsapp-inbox/takeover.ts` → `isSupervisor(role)`
- `modules/sales-profiles/service.ts` → `resolveTeamSales()`
- `modules/import/service.ts` → `resolveAssignables()`

> **Penting untuk dipahami:** backend **sudah** mengirim data satu tim penuh ke
> leader. Kalau halaman leader terlihat sama dengan halaman sales, itu masalah
> tampilan, bukan masalah data. Ini persis yang diperbaiki di Fase 1.

### Lapis 4 — gating rute (frontend)

**File: `apps/frontend/src/lib/role-access.ts`**

Daftar path eksplisit per peran: `SALES_PATHS`, `LEADER_PATHS`, `CEO_PATHS`,
`SUPERADMIN_PATHS`.

```ts
// Peran tak dikenal / kosong → jatuh ke SALES_PATHS (paling ketat), BUKAN
// ke akses penuh. Ini fail-closed yang disengaja: pernah ada bug field
// `role` better-auth yang membuat semua peran kosong, dan kalau defaultnya
// "tanpa batas" maka semua halaman jadi terbuka.
```

Pencocokan pakai prefix, jadi `/sales-profiles` otomatis mengizinkan
`/sales-profiles/<id>`.

Dipakai oleh:
- `apps/frontend/src/routes/_app.tsx` — penjaga layout
- `apps/frontend/src/components/Sidebar.tsx` — menyaring menu
- `apps/frontend/src/lib/crm-navigation.ts` — definisi menu

> Ini **hanya kosmetik**. Otorisasi sungguhan ada di backend. Jangan pernah
> mengandalkan lapis ini untuk keamanan.

### Klien HTTP frontend

**File: `apps/frontend/src/lib/api.ts`** (besar, ±3000 baris — seluruh
permukaan API ada di sini)

- `API_BASE` dari `VITE_API_URL`
- `getAuthHeaders()` — token dari `localStorage.crm_token`, plus slug organisasi
- `apiRequest()` — `credentials: 'include'`, dan **auto-refresh saat 401**:
  memakai `localStorage.crm_refresh_token`, mencoba `/auth/refresh`, lalu
  mengulang request sekali (`_retry`)

Semua binding endpoint diekspor sebagai objek per domain: `tasks`, `customers`,
`prospects`, `leadRouting`, `salesProfiles`, `notifications`, `personalAi`,
`leadImport`, `opportunities`, dst.

### Realtime

**File: `apps/backend/src/plugins/socket.ts`**, klien di
`apps/frontend/src/lib/socket.ts`

Room: `app:<appId>` (siaran tenant) dan `conversation:<id>` (per percakapan).

Event yang dipakai halaman:
`notification:new`, `personal-takeover:updated`, `message:created`,
`task:updated`

### Identitas user di frontend

**File: `apps/frontend/src/hooks/useCurrentUser.ts`**

```ts
const currentUser = useCurrentUser()          // null selama belum termuat
const isLeader = currentUser?.role === 'leader' || currentUser?.role === 'ceo'
```

Dibaca dari `localStorage.crm_user` **di dalam `useEffect`** — aplikasi
di-SSR, jadi membaca localStorage saat render akan merusak hydration.
Perlakukan `null` sebagai "belum diketahui", bukan "bukan leader", supaya
tampilan tidak berkedip ganti layout.

---

## 5. Model data inti

Tabel yang paling sering disentuh (nama kolom = nama di Postgres):

### `users`, `teams`, `team_members`

- `users.role` ∈ `sales` | `leader` | `ceo` | `superadmin`
- Tim yang benar hanya **`AEC`** dan **`MFG`**. Tim `Tim Sales` warisan seeder
  sudah dihapus 2026-07-20.
- **Leader adalah anggota SEMUA tim yang ia awasi.** Ini wajib supaya routing
  bisa me-resolve tim sama sekali. Efek sampingnya: leader ikut terjaring di
  query "anggota tim", jadi filter peran harus eksplisit di sisi pemanggil.

### `contacts`

Satu baris per orang/perusahaan.

- Kolom asli: `name`, `phone_number`, `whatsapp_id`, `email`, `company`,
  **`city`**, `source`, `identifier`, `custom_attributes` (jsonb)
- `identifier` berformat `wa:<appId>:<phone>` — dipakai pencocokan WhatsApp
- **`account_id` selalu NULL.** Kolom itu punya FK ke tabel `accounts` yang
  **kosong** di deployment ini. Mengisinya = FK violation.
- Nomor telepon **selalu** dinormalisasi ke `62…` sebelum disimpan
  (`modules/import/parser.ts` → `normalizePhone()`)

### `conversations`, `messages`

- `conversations.assignee_id` — pemilik percakapan
- `conversations.team_id` — tim
- `conversations.additional_attributes` (jsonb) menyimpan `lead_need`
  (profil kebutuhan hasil kualifikasi) dan `personal_whatsapp.owner_user_id`
- `messages.message_type` = `incoming` (dari customer) / lainnya (dari tim)

### `tasks`

Unit kerja sales.

- `assignee_id`, `team_id`, `contact_id`, `conversation_id`
- `action_kind`: `reply_now` | `follow_up` | `qualify_lead` |
  `handover_review` | `prospect_followup` | `manual`
- `source`: `routing` | `prospect` | `import` | `ai_whatsapp` | `manual`
- `status`: `open` | `in_progress` | `done` | `cancelled`
- `ai_snapshot` (jsonb) — berisi `lead_need`, `summary`, `suggestedReply`
- **`conversation_id` sengaja NULL** untuk task hasil `routing`, `prospect`,
  dan `import`. Lihat [§7](#7-detail-kecil-yang-menjebak).
- Tidak ada FK ke `teams` — menghapus tim akan meninggalkan `team_id` menggantung.

### `notifications`

- `type`: `lead_pending` | `task_urgent` | `task_due` | `takeover` |
  `ai_draft` | `wa_disconnected`
- Membawa `conversation_id` **atau** `task_id`, tergantung jenisnya
- `dedup_key` mencegah notifikasi ganda

### `whatsapp_lead_registrations`

Status per (pemilik, percakapan) untuk inbox WhatsApp personal.

- `owner_user_id` — **pemilik nomor WhatsApp**, kunci semua scoping inbox
- `ai_handling_enabled` — `false` artinya sedang diambil alih manusia
- `takeover_source` — `ai` (AI menyerah) atau `manual` (sales ambil sendiri)

### `sales_profiles`

Profil routing per sales.

- **Hanya `product_skills` dan `max_active` yang memengaruhi pembagian lead.**
- `level`, `segments`, `regions`, `languages`, `tags`, `notes` disimpan tapi
  **tidak dipakai** logika mana pun saat ini (rencana "Sales Character DB").

### `opportunities`, `sakti_records`, `surat_sakti`

Lihat [§6.9](#69-opportunity) dan [§6.10](#610-database-sakti--surat-sakti).

---

## 6. Flow E2E tiap fitur

Format tiap alur: **pemicu → frontend → endpoint → service → DB → efek samping.**

---

### 6.1 Login dan gating peran

| | |
|---|---|
| Frontend | `routes/login.tsx` → `routes/_app.tsx` (penjaga) |
| Auth | better-auth, `apps/backend/src/auth.ts` |
| Otorisasi | `lib/role-access.ts` (FE), `lib/require-role.ts` (BE) |

1. User login → token disimpan di `localStorage.crm_token`, profil di
   `localStorage.crm_user`
2. `_app.tsx` membaca peran; kalau path sekarang tidak ada di daftar peran
   tersebut → redirect ke halaman pertama yang diizinkan
3. `Sidebar.tsx` menyaring `CRM_NAV_ITEMS` dengan daftar yang sama
4. Peran belum ter-resolve → **retry dulu**, jangan langsung tendang
   (lihat penanganan retry di `_app.tsx`)

**Khusus sales/leader/agent**: kalau WhatsApp belum tersambung, mereka
diarahkan ke `/whatsapp/connect` (lihat 6.2).

---

### 6.2 Menyambungkan WhatsApp (QR)

| | |
|---|---|
| Frontend | `routes/whatsapp.connect.tsx` |
| API | `whatsappChannels.getMyConnection()` / `startMyConnection()` |
| Service | `modules/whatsapp/**` → `BaileysServiceClient` → **`:3012`** |

1. Halaman memanggil `getMyConnection()`; kalau perlu QR baru →
   `startMyConnection()`
2. QR di-render `qr-code-styling` jadi Blob → `URL.createObjectURL`
3. Polling tiap **15 detik**; setiap QR baru mengganti yang lama
4. Begitu tersambung → hitung mundur 10 detik → `/chat`

**Detail yang gampang salah:**
- Setiap render QR membuat object URL baru. URL lama **wajib** di-revoke, tapi
  **hanya setelah penggantinya siap** — kalau di-revoke lebih awal, `<img>`
  yang masih memakainya jadi kosong. Lihat `swapQrImage()`.
- Pakai `useRef`, bukan functional `setState` updater, karena efek samping di
  dalam updater berjalan dua kali di StrictMode.
- `qr.getRawData()` mengembalikan `Buffer` di Node dan `Blob` di browser —
  efek ini hanya jalan di klien, jadi dipersempit ke `Blob`.

> **Baileys ada di proses terpisah** (`whatsapp-service/`, port 3012).
> `apps/backend/src/modules/whatsapp/baileys-runtime.ts` yang memuat
> `makeWASocket` **tidak diimpor siapa pun** — kode mati, sisa arsitektur lama.
> Artinya menjalankan `apps/backend` saja **tidak** menyentuh WhatsApp asli.

---

### 6.3 Lead masuk dan dibalas AI

| | |
|---|---|
| Masuk | webhook Baileys → `modules/webhook/service.ts` |
| Antrean | `incoming-messages` → `ai-processing` |
| AI | `modules/personal-whatsapp-inbox/ai-reply.ts` |

1. Customer chat ke nomor **leader**
2. Webhook membuat/menemukan `contacts` + `conversations`, menyimpan `messages`
3. Kalau lead belum terdaftar → notifikasi `lead_pending`
   **"Lead baru perlu keputusan"** ke leader, membawa `conversation_id`
4. Kalau AI aktif, balasan disusun dan dikirim lewat antrean
   `outbound-messages`

**Prompt AI** ada di `ai-reply.ts` (sekitar baris 1522). Aturan yang sudah
tertanam: hanya membalas pesan terbaru, tidak membuka dengan salam kecuali
customer menyalam duluan, tidak mengarang harga/promo/stok, dan memperlakukan
isi pesan customer sebagai data tidak tepercaya (anti prompt-injection).

---

### 6.4 AI menyerah → Alih Tugas

| | |
|---|---|
| Pemicu | `ai-reply.ts` (dua jalur) |
| Service | `modules/personal-whatsapp-inbox/takeover.ts` |
| Frontend | `routes/_app/alih-tugas.tsx` |

Dua jalur takeover otomatis:

1. **Deterministik** (`detectDeterministicHandover`) — customer minta manusia,
   komplain, atau menyatakan kecewa tepat setelah balasan AI. Tidak memanggil
   model sama sekali.
2. **Keputusan model** — AI menilai sendiri perlu eskalasi.

Keduanya memanggil `PersonalTakeoverService.takeover({ source: 'ai', … })`,
yang menyetel `ai_handling_enabled = false` (**AI berhenti membalas, sticky**)
dan memancarkan `personal-takeover:updated`.

Sales juga bisa ambil alih manual dari `/chat` → `source: 'manual'`.

**Halaman Alih Tugas:**

| Peran | Yang terlihat |
|---|---|
| Sales | hanya percakapan miliknya |
| Leader | **seluruh tim**, dikelompokkan per sales |

Scoping ada di `takeover.ts` baris ~108:
```ts
...(isSupervisor(actor.role) ? {} : { owner_user_id: actor.userId })
```
Pengelompokan per sales dilakukan di frontend: daftar diurutkan per pemilik,
header disisipkan saat pemiliknya berganti.

Tombol **"Kembalikan ke AI"** memanggil `personalAi.release()`, dengan catatan
opsional yang tersimpan di riwayat.

---

### 6.5 Leader membagikan lead (INTI SISTEM)

Ini alur paling penting dan paling banyak lika-likunya.

| | |
|---|---|
| Frontend | `components/LeadRoutingDialog.tsx` |
| API | `leadRouting.suggest()` lalu `leadRouting.assign()` |
| Service | `modules/lead-routing/service.ts` |
| Briefing | `modules/tasks/lead-brief.ts` |

#### Langkah 1 — rekomendasi

`GET` suggest → `SalesProfileService.listWithProfiles(actor)` → disaring
`leadRecipients()` → diberi skor.

**Rumus skoring** (`lead-routing/service.ts`):

```ts
WEIGHTS = { product: 0.4, load: 0.3, fairness: 0.3 }

productScore  = 1    kalau keahlian sales cocok produk yang diminati
              = 0.2  kalau tidak cocok
              = 0.5  kalau produk yang diminati tidak diketahui

loadScore     = clamp01(1 - activeLoad / maxActive)      // maxActive default 20
fairnessScore = dari lastAssignedMap
```

`lastAssignedMap` dibaca dari tabel **`tasks`** (`max(created_at)` per
assignee), **bukan** dari `assignment_history`.

`productInterest` diambil dari
`conversations.additional_attributes.lead_need.product`, dengan fallback ke
`contacts.custom_attributes.product_interest`. **Tidak ada kolom
`product_interest` di tabel `conversations`.**

> **`leadRecipients()` menyaring agar hanya `role === 'sales'` yang jadi
> kandidat.** Ini wajib: leader ikut terbawa `listWithProfiles` (karena ia
> anggota tim sales-nya), dan karena leader mengerjakan intake alih-alih task,
> skor *fairness*-nya selalu tinggi — dulu leader justru menang atas sales yang
> keahliannya cocok. Filter ini **hanya di lead-routing**, tidak boleh
> dipindah ke `resolveTeamSales()` karena fungsi itu juga dipakai halaman
> Profil Sales yang memang perlu menampilkan leader.

#### Langkah 2 — dialog

`LeadRoutingDialog.tsx` menampilkan kandidat berperingkat. **Kandidat teratas
langsung terpilih otomatis** (baris ~336) — jangan berasumsi leader selalu
memilih sadar.

Ada checkbox **"kirim intro"** (default **menyala**) dengan teks otomatis:

> Halo kak 🙏 Kebutuhan Kakak akan dibantu oleh **{nama}** dari tim kami.
> Beliau akan menghubungi Kakak sebentar lagi ya. Terima kasih 🙏

Pesan ini dikirim dari **nomor leader** — jadi orang ketiga di sini **benar**.

#### Langkah 3 — assign

`LeadRoutingService.assign()` melakukan, berurutan:

1. `conversations` → set `assignee_id` + `team_id` ke sales terpilih
2. cari task `routing` aktif untuk kontak itu → **update** kalau ada,
   **create** kalau belum (dedupe per kontak, supaya assign ulang tidak
   menumpuk task)
3. `loadLeaderTranscript()` — 16 pesan terakhir sebagai konteks
4. `generateHandoffBrief()` → `summary` + `suggestedReply`, disimpan ke
   `tasks.ai_snapshot`
5. notifikasi `lead_pending` **"Lead baru di-assign ke kamu"** ke sales,
   membawa **`task_id`** (bukan `conversation_id` — lihat §7)
6. `task_events` dicatat
7. event realtime dipancarkan

Setelah `assign()` sukses, **frontend** mengirim pesan intro
(`personalInbox.sendMessage`) — best-effort, kegagalannya tidak membatalkan
assign.

#### Briefing handoff

`modules/tasks/lead-brief.ts` → `generateHandoffBrief()`.

Menghasilkan dua hal:
- **`summary`** — briefing internal untuk sales
- **`suggestedReply`** — pesan pembuka siap kirim

> **`suggestedReply` WAJIB ditulis sudut pandang orang pertama sebagai sales
> yang menerima lead**, dan nama sales dikirim lewat parameter `salesName`.
> Kalau tidak, model akan meniru kalimat leader dari transkrip dan menghasilkan
> *"Deska akan menghubungi Anda sebentar lagi"* — dikirim oleh Deska, ke
> customer yang sedang bicara dengan Deska. Terbaca seperti lead dioper lagi.
> Prompt sekarang melarang keras penyebutan orang ketiga.

Ada fallback deterministik penuh kalau AI mati/gagal — assign **tidak pernah**
gagal gara-gara AI.

---

### 6.6 Sales menerima lead

| | |
|---|---|
| Notifikasi | `routes/_app/notifikasi.tsx` / lonceng di `components/TopBar.tsx` |
| Tujuan klik | `lib/notifications-meta.ts` → `notifNavigate()` |
| Detail task | `routes/_app/tasks/$taskId.tsx` |

1. Sales dapat notifikasi **"Lead baru di-assign ke kamu"**
2. Klik → **halaman task**, bukan chat (alasannya di §7)
3. Halaman task menampilkan briefing + opener siap kirim
4. Tombol **"Mulai Chat"** membuka percakapan **dari nomor sales sendiri**
5. Sales lanjut sampai closing

---

### 6.7 Daftar Tugas

| | |
|---|---|
| Frontend | `routes/_app/tasks/index.tsx`, `tasks/$taskId.tsx` |
| Service | `modules/tasks/service.ts` |
| Policy | `modules/tasks/policy.ts` |
| Analisis | `modules/tasks/analyzer.ts` + `worker.ts` |

**Sumber task** (`tasks.source`):

| Sumber | Dibuat oleh |
|---|---|
| `routing` | leader membagikan lead |
| `prospect` | input prospek manual |
| `import` | import spreadsheet |
| `ai_whatsapp` | analyzer menilai percakapan butuh aksi |
| `manual` | dibuat tangan |

**Tampilan berbeda per peran:**

| Peran | Pengelompokan |
|---|---|
| Sales | per tenggat: Terlambat / Hari ini / Besok / Minggu ini / Nanti |
| Leader | **per sales**, diurutkan dari beban terbanyak, plus hitungan terlambat |

Task membawa `assigneeName` (di-resolve di `enrichTasks()`, pola yang sama
dengan `teamName`).

Aksi: centang selesai (manual), **Tunda 1 hari**, buka WhatsApp, buka email.
Task **mulai** otomatis saat dibuka/dibalas — tidak ada tombol "mulai".

---

### 6.8 Notifikasi

| | |
|---|---|
| Frontend | `routes/_app/notifikasi.tsx`, `components/TopBar.tsx` |
| Bersama | `lib/notifications-meta.ts` |
| Service | `modules/notifications/service.ts` |

`notifNavigate(navigate, item)` adalah **satu-satunya** penentu tujuan klik.
Dipakai halaman notifikasi maupun lonceng, supaya tidak pernah beda.

| Tipe | Tujuan |
|---|---|
| `takeover` | `/alih-tugas` |
| `task_urgent`, `task_due` | `/tasks/$taskId` |
| `wa_disconnected` | `/whatsapp/connect` |
| `lead_pending`, `ai_draft` | punya `conversationId` → `/chat?c=…`<br>punya `taskId` saja → `/tasks/$taskId` |

Baris terakhir itu penting: **notifikasi lead ada dua bentuk.**

| Judul | Untuk | Membawa | Alasan |
|---|---|---|---|
| "Lead baru perlu keputusan" | leader | `conversation_id` | percakapan ada di inbox leader sendiri |
| "Lead baru di-assign ke kamu" | sales | `task_id` | percakapan ada di inbox **leader** — sales tidak bisa membukanya |

---

### 6.9 Deal: Prospek, Pipeline, Opportunity

Sistem ini hanya punya **dua** entitas nyata: **Kontak/Pelanggan** (permanen)
dan **Deal** (satu percobaan penjualan; satu kontak bisa punya banyak, karena
lisensi CAD diperpanjang tiap tahun).

**"Prospek" dan "Opportunity" bukan entitas** — keduanya Deal yang sama pada
nilai `probability` berbeda. Di bawah ambang tim = prospek, di atas =
opportunity. Tabelnya adalah `opportunities`.

| | |
|---|---|
| Stage | `modules/opportunities/stages.ts` (**di kode, bukan DB**) |
| Service | `modules/opportunities/service.ts` |
| Rute | `modules/opportunities/index.ts` |
| Halaman | `routes/_app/pipeline.tsx` (tabel + papan) |
| Ambang | `teams.deal_threshold`, diatur di `routes/_app/kelola-tim.tsx` |

**Stage → probability default:**

| Stage | % | Status |
|---|---|---|
| `baru` | 10 | open |
| `kontak` | 25 | open |
| `kualifikasi` | 50 | open |
| `penawaran` | 75 | open |
| `negosiasi` | 90 | open |
| `menang` | 100 | won |
| `kalah` | 0 | lost |

> Stage sengaja ditaruh di kode, bukan di tabel `pipeline_stages`. Tabel itu
> `pipeline_type = 'contact'` dan mengatur siklus hidup **kontak** (New Leads →
> Hot Leads → Payment → Customer) yang tampil di halaman Pelanggan — sumbu yang
> berbeda: *siapa orangnya*, bukan *sejauh apa satu penjualan*.

**Aturan yang dijaga:**

- `PATCH /opportunities/:id/stage` adalah **seluruh siklus hidup**. Menggeser
  stage menyetel `probability`, `status`, dan `closed_at` sekaligus. Tidak ada
  aksi "promote" terpisah, dan **tidak ada input opportunity manual**.
- Deal **membuka dirinya sendiri**: dari prospek (`createProspect`) dan dari
  handoff lead (`LeadRoutingService.assign`). Keduanya melewati kontak yang
  sudah punya deal `open`, supaya menambah prospek dua kali tidak memecah
  pipeline orang yang sama.
- `bucket` (`prospek` | `opportunity` | `closed`) **dihitung saat dibaca**, dari
  `probability` versus ambang tim pemilik deal. Karena itu mengubah ambang
  langsung mengubah klasifikasi tanpa migrasi data. Konsekuensinya filter
  `?bucket=` tidak bisa masuk ke query SQL — ia disaring setelah enrichment.
- `menang`/`kalah` masuk bucket `closed`, bukan `opportunity`. Deal yang sudah
  menang tidak boleh ikut menghitung pipeline yang sedang dibaca leader.
- Baca di-scope per peran lewat `dealVisibilityScope()` — sales lihat miliknya,
  leader lihat timnya. Berlaku juga untuk `moveStage`, `update`, `remove`.

**Prospek** (`modules/import/service.ts` → `createProspect()`):
- sales → task dan deal jadi miliknya sendiri
- leader → **wajib** `assigneeId`; menugaskan ke diri sendiri **ditolak**;
  tim task dan deal mengikuti tim sales yang dipilih
- Halamannya (`/prospek`) tidak ada di sidebar; dibuka dari tombol di Pipeline

**Pelanggan** (`modules/customer/**`):
- `POST /customers` → `createCustomer()`; nomor dinormalisasi, **duplikat
  ditolak `409`** (WhatsApp masuk dicocokkan lewat nomor, jadi kontak ganda
  akan memecah riwayat satu pelanggan)
- Filter **di SQL**, bukan di klien: `segment` (`prospek`, `belum_beli`,
  `sering_beli`, `idle_90d`), `team_id`, `owner_id`
- **"Pernah beli" = deal menang ATAU order berbayar.** Tabel `orders` kosong di
  deployment ini, jadi menyandarkan definisi itu pada `orders` saja akan
  menandai semua 320 kontak sebagai belum pernah beli

---

### 6.10 Database Sakti & Surat Sakti

| | |
|---|---|
| Frontend | `routes/_app/sakti.tsx` |
| Service | `modules/sakti/service.ts` |
| Impor CSV | `modules/sakti/import.ts` |
| Template surat | `modules/sakti/letter-templates.ts` |
| Tabel | `sakti_records`, `surat_sakti` |

Database lisensi lintas-vendor untuk mencocokkan lead dengan lisensi yang sudah
ada. `matchLead()` mengembalikan rekomendasi `surat_sakti` (kalau cocok) atau
`opportunity` (kalau tidak).

#### Impor CSV

`POST /sakti/records/import` dengan `{ content, dryRun }`.

- **CSV saja, disengaja.** Semua aplikasi sheet bisa ekspor CSV, dan menambah
  pustaka XLSX berarti dependensi baru untuk format yang toh akan diratakan ke
  baris yang sama. Parsernya dipakai ulang dari importer lead
  (`modules/import/parser.ts`, RFC 4180).
- **Idempoten.** Nomor lisensi yang sudah tersimpan — atau berulang di dalam
  file yang sama — dilewati, bukan disisipkan. Sheet vendor sering dikirim
  ulang, jadi mengimpor file yang sama dua kali tidak boleh menggandakan data.
  Tanpa nomor lisensi, kunci jatuh ke pasangan customer + produk.
- `dryRun: true` mengembalikan pratinjau yang sama tanpa menulis apa pun.
- Header yang dikenali punya banyak alias (`Nama Customer`, `No Lisensi`,
  `Tgl Beli`, plus varian Inggris). Kolom asing diabaikan dan dilaporkan di
  `unmapped`.
- Daftar record mengembalikan `meta.total` supaya tabel bisa dipaginasi jujur,
  dan pencarian mencakup nomor lisensi serta produk.

#### Template surat

`GET /sakti/templates` · `POST /sakti/templates/preview`

Empat template: **Penawaran Harga, Penunjukan Dealer Resmi, Keterangan Lisensi
Asli, Serah Terima Lisensi.** Tiga di antaranya lampiran tender, jadi tiap
template membawa nomor surat, tanggal, kop, dan blok tanda tangan — bukan
sekadar body teks bebas.

> **Isi suratnya masih DUMMY.** Strukturnya benar, tapi redaksinya perlu
> diganti dengan kalimat resmi PIRANUSA sebelum dikirim ke pelanggan atau
> dilampirkan ke tender. Jangan anggap sudah disetujui legal.

Surat menyimpan **`template` + `template_values`, bukan teks jadinya.**
`renderedBody` dihitung saat dibaca, jadi begitu redaksi template diperbaiki,
surat lama ikut terbaca dengan kalimat yang baru tanpa migrasi. Placeholder
yang kosong dirender jadi `-`, tidak pernah menyisakan `{{field}}` yang terlihat
rusak kalau surat itu dicetak.

---

### 6.11 Kelola Tim & Profil Sales

| Halaman | File |
|---|---|
| Kelola Tim | `routes/_app/kelola-tim.tsx`, `modules/team/**` |
| Profil Sales | `routes/_app/sales-profiles/index.tsx` + `$userId.tsx` |

**Profil Sales** — daftar + halaman detail (dulu modal).
Kolom: `Sales · Tim · Keahlian produk · Beban aktif`.

Halaman detail memisahkan dua kelompok dengan sengaja:
- **"Dipakai untuk bagi lead"** — keahlian produk, kapasitas maksimum
- **"Catatan tim"** — level, segmen, wilayah, bahasa, tag, catatan; diberi
  keterangan eksplisit bahwa **belum memengaruhi pembagian lead**

> Halaman detail mengambil data lewat `salesProfiles.list()` lalu memilih
> barisnya, karena **tidak ada** `GET /sales-profiles/:userId`. Untuk daftar
> sebesar satu tim ini lebih murah daripada menambah endpoint. Kalau jumlah
> sales tumbuh jadi puluhan, ini yang pertama perlu diganti.

**Penghapusan tim**: `TeamService.deleteTeam()` melakukan **hard delete**.
Kolom `teams.deleted_at` ada tapi `getTeams()` **tidak memfilternya**, jadi soft
delete tidak akan menyembunyikan apa pun. FK `conversations.team_id` bersifat
`NO ACTION` → conversation wajib dipindah dulu. `team_members` cascade.

---

## 7. Detail kecil yang menjebak

Bagian ini adalah alasan dokumen ini ada. Semuanya sudah pernah menjebak,
dan tidak satu pun terlihat dari membaca kode sepintas.

### 7.1 Inbox WhatsApp di-scope per pemilik

**Ini akar dari banyak keanehan lain.**

`modules/personal-whatsapp-inbox/index.ts` me-resolve sesi Baileys lewat
`owner_user_id: userId`, lalu memfilter percakapan dengan `inbox_id` channel
tersebut.

**Artinya: sales tidak bisa membuka percakapan yang ada di inbox leader.**

Yang tampak seperti bug, padahal disengaja:

| Terlihat seperti bug | Sebenarnya |
|---|---|
| Task hasil `routing` punya `conversation_id` NULL | benar — sales akan chat dari nomornya sendiri, percakapan yang berbeda |
| Notifikasi "di-assign ke kamu" tidak membawa `conversation_id` | benar — sales tidak bisa membuka percakapan leader |

> Ada komentar penjelas persis di atas baris pembuatan task di
> `lead-routing/service.ts`. **Sebelum menganggap `conversation_id` NULL sebagai
> bug, cek dulu siapa pemilik inbox versus siapa penerima record-nya.**
> Membaca angka agregat dari DB saja pernah menghasilkan "perbaikan" yang justru
> mengarahkan sales ke percakapan yang tidak bisa ia buka.

### 7.2 `validateSearch` TanStack harus pakai key opsional

```ts
// BENAR — key opsional, pemanggil boleh tidak mengirim apa-apa
validateSearch: (search: Record<string, unknown>) => {
  const next: { c?: string; draft?: string } = {}
  if (typeof search.c === 'string') next.c = search.c
  return next
}

// SALAH — mengembalikan `string | undefined` membuat `search` WAJIB
// di SETIAP Link/navigate ke rute ini
```

Mengembalikan key wajib bertipe `string | undefined` memaksa **semua** pemanggil
menuliskan semua key. Sekali kesalahan ini dibuat, muncul 9 error tsc di
tempat yang tidak berhubungan.

Juga: **`to` harus pathname murni.** `to={'/x?a=1'}` tidak berfungsi — router
memperlakukan seluruh string sebagai pathname. Pakai
`to="/x" search={{ a: '1' }}`.

### 7.3 Tabel `accounts` kosong

`contacts.account_id` punya FK ke `accounts`, tapi tabel itu tidak pernah diisi.
Semua 320 kontak punya `account_id` NULL.

Akibatnya `POST /contacts` lama (`ContactService.createContact`) **tidak mungkin
berhasil** — ia menulis `account_id = appId` dan langsung kena FK violation.
Pakai `POST /customers` yang baru.

### 7.4 GPT-5 hanya menerima `temperature: 1`

Nilai lain akan ditolak API. Semua pemanggilan AI di repo ini sudah memakai
`temperature: 1`. Base URL AI harus eksplisit lewat
`PERSONAL_AI_OPENAI_BASE_URL`.

### 7.5 Backend dev auto-reload

`bun run --watch` — simpan file, proses restart sendiri. Tidak perlu (dan
jangan) restart manual. Baileys aman karena ada di proses terpisah (3012).

### 7.6 Postgres/Redis bukan dari docker-compose

Sudah dibahas di [§2](#2-menjalankan-sistem). Aplikasi memakai `cpira-postgres`
(5433) dan `dev-redis` (6379), sementara compose menyediakan container lain di
5431 dan 6380.

### 7.7 Pairing code adalah kode mati yang disengaja

Jangan hapus. Disimpan untuk pemakaian di masa depan.

### 7.8 Jangan menyaring daftar berpaginasi di klien

Dulu `customers/index.tsx` memfilter array `rows` yang hanya berisi **satu
halaman (10 baris)**, jadi tiap chip menyaring 10 baris yang kebetulan tampil
dan angkanya menyesatkan — terlihat masuk akal, padahal salah. Sudah dipindah
ke SQL. **Pola yang sama masih mungkin terulang di halaman lain**: kalau sebuah
daftar dipaginasi, filternya wajib ikut ke query.

Pengecualian yang sah ada satu: filter `?bucket=` di Pipeline. Bucket butuh
ambang tim yang baru diketahui setelah enrichment, jadi ia memang disaring di
memori — tapi atas **seluruh** hasil query, bukan satu halaman.

### 7.9 Leader ada di dalam semua tim

Konsekuensinya, query "anggota tim saya" **selalu** ikut mengembalikan leader.
Setiap kali kamu butuh "hanya sales", saring `role === 'sales'` secara eksplisit
di sisi pemanggil — jangan mengubah helper bersama seperti `resolveTeamSales()`,
karena halaman lain justru butuh leader ikut tampil.

### 7.10 Satu field, satu tempat penyimpanan

`city` dan `company` adalah **kolom asli** di `contacts`. Jangan menyimpannya di
`custom_attributes` — jalur prospek memakai kolomnya, dan data yang tersembunyi
di jsonb tidak akan terlihat oleh apa pun yang query kolom.

---

## 8. Konvensi kerja

### Commit

- **Bahasa Inggris**, format Conventional Commits
- **TANPA** baris co-author/contributor
- Hanya commit file fitur

**JANGAN pernah commit:**
- `docs/*`
- `.env` atau file rahasia apa pun
- `apps/backend/_drain.ts` (untracked, bukan milik kita)
- skrip verifikasi sementara (`_v*.ts`) — hapus setelah dipakai

### Menguji logika backend

Endpoint yang butuh `userId` tidak bisa diuji hanya dengan header. Cara yang
dipakai selama ini: skrip sementara di `apps/backend/` yang memanggil service
langsung.

```ts
// apps/backend/_v1.ts   (HAPUS setelah dipakai)
import prisma from './src/lib/prisma'
import { TaskService } from './src/modules/tasks/service'

const r = await TaskService.list(
  { appId: APP, userId: BENNY, role: 'leader' },
  { view: 'all', limit: 100 },
)
console.log(r.data.length)
await prisma.$disconnect()
process.exit(0)
```

```bash
cd apps/backend && bun run _v1.ts
```

**Selalu bersihkan data uji yang dibuat**, dan buktikan bersihnya dengan
query hitung ulang. Ini menyentuh database yang sama dengan dev.

> Beberapa modul (mis. `personal-whatsapp-inbox/takeover.ts`) menarik dependensi
> realtime saat di-import dan membuat skrip menggantung. Pecah skripnya per
> modul kalau itu terjadi.

### Mengubah data produksi

1. Ambil **snapshot rollback** dulu (generate `INSERT`/`UPDATE` balikan lewat SQL)
2. Pindahkan referensi sebelum menghapus induknya
3. Verifikasi nol referensi tersisa
4. Baru hapus
5. Verifikasi kondisi akhir

### Akun simulasi

`apps/backend/scripts/seed-sim-sales.ts` — membuat/mereset Deska, Yoel, Fathur,
menempatkan mereka di AEC/MFG, dan leader di keduanya.

> **Skrip ini me-reset password SEMUA akun menjadi `123`.** Jangan jalankan
> hanya untuk "mengetes sesuatu".

---

## 9. Status dan sisa pekerjaan

### Selesai (sesi 2026-07-20)

| Commit | Isi |
|---|---|
| `1faf251` | notifikasi lead membuka percakapan/task yang tepat |
| `17f3cf5` | seeder menempatkan sales di tim AEC/MFG asli |
| `ab3009c` | Profil Sales jadi halaman, kolom dirapikan |
| `28d8900` | tombol Tambah Pelanggan berfungsi (+ endpoint baru) |
| `fe00ab1` | `city` ditulis ke kolomnya |
| `1abf88f` | tampilan leader per-sales (tugas, alih tugas, prospek) |
| `6ba6e5a` | opener handoff ditulis sudut pandang sales |

Plus pembersihan data: tim `Tim Sales` dihapus, 24 task + 1 conversation
dipindah ke AEC/MFG sesuai pemiliknya.

### Fase 2 — model deal (selesai)

| Commit | Isi |
|---|---|
| `32d4d89` | deal membuka diri dari lead, progres digerakkan stage |
| `62b1369` | satu halaman Pipeline, mengganti papan yang tidak pernah memuat |
| `af34db6` | filter Pelanggan pindah ke server, segmen sesuai kebutuhan |
| `41be555` | leader mengatur ambang opportunity per tim |

Perubahan skema (sudah di-`prisma db push`):
`opportunities.probability` (Int, default 10) dan `teams.deal_threshold`
(Int, default 50).

Detail lengkapnya di [§6.9](#69-deal-prospek-pipeline-opportunity).

### Fase 3 — Sakti (selesai)

| Commit | Isi |
|---|---|
| `65ca92f` | impor CSV + empat template surat (backend) |
| `acc5c13` | dialog impor, pratinjau surat, paginasi tabel (frontend) |

Perubahan skema (sudah di-`prisma db push`): `surat_sakti.template` dan
`surat_sakti.template_values`.

Detail di [§6.10](#610-database-sakti--surat-sakti).

**Tindak lanjut yang masih menunggu bisnis:** redaksi keempat template masih
teks contoh. Ganti isinya di `modules/sakti/letter-templates.ts` — strukturnya
tidak perlu diubah, cukup kalimatnya.

### Utang teknis yang ditunda sadar

- **±115 error tsc frontend**: ±101 TS6133 (variabel/parameter tak terpakai),
  6 pergeseran tipe pustaka UI (`dropdown-menu.tsx:29`, `tooltip.tsx:32,42`,
  `sidebar.tsx:519`, `ads-performance.tsx:194`, `integration.tsx:338`),
  3 artefak `Buffer`/`BlobPart`. Build Vite menoleransi semuanya.
- `apps/backend` tidak punya test suite.
- Tiga file lama diawali `// @ts-nocheck` sehingga tidak ikut diperiksa tsc:
  `modules/auth/index.ts`, `modules/user/service.ts`, `modules/team/service.ts`.

### Pertanyaan yang masih menunggu keputusan pemilik produk

1. Leader boleh mencentang/menyelesaikan tugas milik sales? (sekarang **boleh**)
2. Bagian `summary` briefing masih bisa menyebut sales sebagai orang ketiga —
   dirapikan juga? (tidak pernah terkirim ke customer)
3. Task lama yang terlanjur punya opener salah: dibiarkan, dibersihkan, atau
   dibuat ulang?
4. `docs/*` dimasukkan `.gitignore`?

---

## Lampiran — ID yang sering dipakai saat debugging

Lingkungan dev, aman ditulis:

| Entitas | ID |
|---|---|
| app | `1713b2f2-0931-45ef-b386-b65799c588fd` |
| Benny (leader) | `f658a91d-4a4e-497a-9042-e5cb89c3a86b` |
| Deska (sales, AEC) | `250a2b1c-d26e-419b-baab-29aa5f5c3c82` |
| Yoel (sales, MFG) | `84821e6e-7695-4e1c-ac7f-a73355162986` |
| Fathur (sales, MFG) | `c95162a2-4557-4208-8932-ae892354e02c` |
| tim AEC | `59df5f7e-8d62-41a6-91d2-c94e3dd2ab27` |
| tim MFG | `96af51de-2158-4d4c-9449-10df873a2fbb` |
