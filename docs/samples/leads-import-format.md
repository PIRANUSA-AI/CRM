# Format CSV Import Lead — Spesifikasi, Mapping & Arsitektur

Kontrak format CSV untuk fitur Import (Fase 3). Contoh: `leads-import-sample.csv` (25 baris, 25 kolom, konteks reseller CAD/ZWCAD, data fiktif).

Satu baris = satu lead/kontak. Importer akan **membuat/memperbarui contact** dan **opsional membuat task follow-up**.

---

## 1. Kolom (25) — level "standar industri"

Kolom Tier A (ditandai ⭐) adalah tambahan agar setara CRM enterprise (HubSpot/Salesforce).

| Kolom | Wajib | Contoh | Tujuan |
|---|---|---|---|
| `name` | ✅ | Budi Santoso | `contacts.name` |
| `contact_title` ⭐ | — | Procurement Manager | Jabatan PIC |
| `phone` | ✅ | 6281234500011 | `contacts.phone_number` + `whatsapp_id` (dinormalkan). **Kunci dedup utama** |
| `email` | — | budi@arsitekmaju.co.id | `contacts.email`. Kunci dedup sekunder |
| `company` | — | PT Arsitek Maju Bersama | Nama perusahaan |
| `industry` ⭐ | — | Arsitektur | Vertikal/segmen |
| `company_size` ⭐ | — | 51-200 | Estimasi seat/skala |
| `city` | — | Jakarta Selatan | Kota |
| `province` ⭐ | — | DKI Jakarta | Provinsi |
| `country` ⭐ | — | Indonesia | Negara |
| `source` | — | Instagram Ads | Asal lead → `contacts.source` |
| `product_interest` | — | ZWCAD 2025 Professional | Produk diminati |
| `pipeline_stage` | — | Penawaran | Tahap; menentukan pembuatan task |
| `lead_score` | — | 78 | Skor 0–100 |
| `probability` ⭐ | — | 60 | % kemenangan 0–100 (forecasting) |
| `estimated_value` | — | 45000000 | Nilai potensi (angka polos) |
| `currency` ⭐ | — | IDR | Mata uang |
| `assigned_to` | — | deska@piranusa.com | Email sales → di-resolve ke `users.id` |
| `last_contact_at` | — | 2026-07-10 | Kontak terakhir (YYYY-MM-DD) |
| `next_followup_at` | — | 2026-07-16 | Jadwal follow-up → `due_at` task |
| `expected_close_date` ⭐ | — | 2026-07-31 | Perkiraan closing |
| `external_id` ⭐ | — | LEG-0001 | ID sistem lama → **kunci idempotensi re-import** |
| `notes` | — | "Minta penawaran 5 lisensi…" | Catatan bebas; sumber task |
| `tags` | — | prioritas;korporat | Label dipisah `;` |
| `consent_status` | — | opt_in / opt_out / unknown | Status konsen |

### Aturan format
- UTF-8, delimiter `,`, baris pertama header (nama persis).
- Field dengan koma/newline wajib dikutip `"`; escape `"` → `""`.
- Telepon `62xxx` (importer menormalkan `08`/`+62`). Tanggal `YYYY-MM-DD`. Angka polos tanpa `Rp`/pemisah.
- Kolom opsional boleh kosong.

---

## 2. Siapa yang mengimpor? (RBAC)

Import adalah fungsi **Leader/CEO/Superadmin**, bukan sales — karena kolom `assigned_to` mendistribusikan lead ke banyak sales.

| Role | Import | `assigned_to` |
|---|---|---|
| Leader | ✅ | Assign ke sales **di dalam timnya** (di luar tim → baris error) |
| CEO / Superadmin | ✅ | Assign ke siapa pun di app |
| Sales | Terbatas (opsional) | Dipaksa ke dirinya sendiri |

Konsisten dengan `policy.ts` → `assertAssignableTask` (aturan penugasan task yang sudah ada).

---

## 3. Arsitektur & Cara Kerja (bagaimana baca CSV agar tidak salah)

### Membaca CSV = deterministik, TANPA AI
Parsing CSV **tidak** memakai AI. AI tidak cocok untuk membaca kolom (mahal, lambat, bisa "berhalusinasi"). Yang dipakai adalah **parser CSV standar (RFC 4180)** yang sadar tanda kutip — sehingga koma di dalam `notes` tidak salah dipecah. Ini presisi 100% dan bisa diuji.

### Pipeline (5 tahap)
```
1) UPLOAD (Leader)         → simpan file sementara (MinIO/S3), buat import_jobs (status=preview)
2) PARSE                   → parser RFC4180 baca header + baris (deterministik)
3) MAP + VALIDATE          → cocokkan header ke kolom (alias/fuzzy), lalu validasi tiap baris:
                             - normalkan phone (08/+62 → 62)
                             - validasi email, enum (pipeline_stage, consent), tanggal, angka
                             - resolve assigned_to (email → user di tim leader)
                             - tandai status baris: OK | WARNING | ERROR
4) PREVIEW + EDIT          → tampilkan tabel staged rows ke Leader.
                             Leader bisa PERBAIKI nilai & GANTI assignee per baris
                             sebelum commit (anti salah target)
5) COMMIT (async worker)   → per baris: dedup contact (by phone→email / external_id),
                             create/update contact, opsional buat task, set assignee.
                             Hasil: {imported, updated, skipped, errors, tasksCreated} + log per baris
```

### Di mana AI (opsional, TIDAK wajib)
AI hanya sebagai *pembantu*, dan **tidak** di jalur kritis:
- **Saran mapping kolom** — kalau header CSV asing (mis. "No HP" alih-alih "phone"), AI bisa menyarankan pemetaan. Tapi ini bisa juga cukup dengan tabel alias + fuzzy match deterministik.
- **Ringkas `notes` → judul/aksi task** — memakai analyzer yang sama seperti WhatsApp. Karena GLM `glm-4.5-flash` lambat (~15–45 dtk/baris), enrichment ini dijalankan **async/opsional**, tidak memblokir import.

Default yang saya rekomendasikan: **task dibuat deterministik** dari `notes` + `product_interest` + `next_followup_at` (cepat, pasti), dengan opsi AI polish belakangan.

### Resolusi assignee (memastikan target benar)
`assigned_to` (email) → cari `users` di `app_id` yang sama **dan** anggota tim leader → tampilkan nama sales di preview. Jika tidak ketemu/di luar tim → baris ditandai dan Leader memilih manual di preview. Commit hanya jalan setelah semua assignee valid.

### Kapan task dibuat (aturan yang disepakati)
- **Dilewati** untuk `pipeline_stage` = `Menang`/`Kalah` (sudah closed).
- Dibuat jika ada `next_followup_at` dan/atau `notes` actionable.
- `due_at` = `next_followup_at` (fallback: default per stage).
- `source` task = `import`.

---

## 4. Model Data Import (rencana)

| Tabel | Isi |
|---|---|
| `import_jobs` | id, app_id, created_by, source (`csv`/`sheets`), filename, status (`preview`/`processing`/`completed`/`failed`), counts (total/imported/updated/skipped/errors/tasks_created), error_log (jsonb), created_at, completed_at |
| `import_job_rows` | id, job_id, row_number, raw (jsonb data mentah), mapped (jsonb hasil mapping), resolved_assignee_id, status (`ok`/`warning`/`error`), messages (jsonb) — mendukung preview & edit sebelum commit |

Idempotensi: dedup contact by `external_id` → `phone` → `email`; satu `import_jobs` menahan staged rows sampai di-commit.

---

## 5. Catatan
- Semua data sample **fiktif**.
- Kolom masih bisa disesuaikan sebelum importer dibangun.
- Google Sheets sync (Fase 3 bagian 2) butuh kredensial Google OAuth — ditunda sampai tersedia.
