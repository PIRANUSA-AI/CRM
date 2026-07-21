# Trigger Daftar Tugas — Apa yang Membuat Chat Jadi Task

Dokumen ini menjelaskan **kapan sebuah chat WhatsApp masuk ke Daftar Tugas** — gerbang kelayakan, klasifikasi AI, dan ambang keyakinannya. Sumber: `tasks/worker.ts`, `tasks/analyzer.ts`, `tasks/service.ts`.

> Catatan: analisis task memakai **GLM/Z.ai** (via `OPENAI_*`), **terpisah** dari auto-reply (OpenAI). Jadi keputusan "jadi task" ≠ keputusan "AI balas".

## Ringkasan singkat

Sebuah chat jadi task bila: **lead tidak diblokir** + **pesan terbaru customer** dinilai AI **butuh tindakan sales** (bukan `ignore`) dengan **keyakinan cukup**. Kalau AI ragu/sensitif, task tetap dibuat tapi sebagai **"Tinjau handover"**.

```
Pesan masuk → gerbang kelayakan → baca giliran terbaru (window 25→50)
   → AI classify (reply_now / follow_up / qualify_lead / handover_review / ignore)
   → gerbang keyakinan → BUAT TASK (atau abaikan)
```

## 1. Gerbang kelayakan (sebelum AI dipanggil)

Job analisis di-enqueue untuk lead **pending + confirmed** (bukan `blocked`). Di worker, chat dilewati (tidak jadi task) bila salah satu:

| Kondisi | Alasan skip |
|---|---|
| Bukan pesan masuk / bukan teks | `message_without_text` |
| Percakapan tidak berstatus open | `conversation_not_open` |
| Bukan pesan masuk paling akhir (sudah ada yang lebih baru) | `newer_inbound_exists` |
| Pemilik lead tidak cocok | `personal_owner_mismatch` |
| **Lead diblokir** | `personal_lead_blocked` |
| Tidak ada penerima tugas yang valid (harus sales/leader aktif) | `assignee_not_eligible` |

Jadi: **lead pending pun dianalisis** (auto-detect), hanya `blocked` yang benar-benar dilewati.

## 2. Jendela baca 25 → 50 (penentu LEAD, bukan balasan)

- AI membaca **giliran terbaru** customer + konteks hingga **25 pesan**.
- Kalau hasil pass pertama **`ignore` tapi ragu** (confidence < 0.7) dan ada riwayat lebih panjang → **diperluas ke 50 pesan** lalu dinilai ulang.
- Kalau di 50 pesan tetap tidak ada sinyal → **bukan lead** (tidak jadi task).
- Ingat: 25→50 ini untuk **menentukan lead/bukan**, bukan menentukan apa yang dibalas.

## 3. Klasifikasi AI (2 tier)

**Tier 1 — classifier** menghasilkan:
- `action`: `ignore` | `reply_now` | `follow_up` | `qualify_lead` | `handover_review`
- `leadSignal`: `none` | `interest` | `qualified` | `purchase_intent`
- `priority`: `low` | `medium` | `high` | `urgent`
- `confidence` (0–1), `evidence` (kutipan), `safetyFlags`

**Tier 2 — generator** (hanya jalan bila actionable) menghasilkan judul task, ringkasan, draft balasan (`suggestedReply`), dan tenggat (`dueInMinutes`).

### Arti tiap action

| action | Arti | Contoh pesan | Jadi task? |
|---|---|---|---|
| **reply_now** | Tanya produk/harga/stok/order yang butuh dijawab | "ZWCAD Pro berapa?", "mau order EinScan" | ✅ Ya |
| **qualify_lead** | Prospek perlu digali | "bisa demo Ansys?", "ZW3D bisa CAM 5 axis?" | ✅ Ya |
| **follow_up** | Perlu ditindaklanjuti nanti | "nanti saya kabari", "minggu depan ya" | ✅ Ya |
| **handover_review** | Sensitif: marah/ancaman/sengketa/legal | "kecewa banget", "mau komplain" | ✅ Ya (prioritas tinggi) |
| **ignore** | Salam penutup, emoji, OTP, spam, salah sambung, grup, tak butuh aksi | "makasih 🙏", "ok", OTP | ❌ Tidak |

## 4. Gerbang keyakinan (yang final menentukan)

Setelah AI klasifikasi, aturan `withHumanReview`:

- `action = ignore` → **tidak jadi task**.
- `confidence < 0.5` (ambang `REVIEW_CONFIDENCE`) → **tidak jadi task** (terlalu ragu; hindari noise).
- `confidence < 0.7` (ambang `MIN_CONFIDENCE`) **atau** ada `safetyFlags` → **jadi task tapi dipaksa `handover_review`** prioritas tinggi (perlu dicek manusia).
- selain itu → **jadi task** sesuai action & prioritas aslinya.

Ringkas ambang: **<0.5 = buang · 0.5–0.7 = task tinjauan · ≥0.7 = task normal.**

## 5. Anti-duplikat & update

Saat membuat task (`createFromAnalysis`):
- Kalau sudah ada task dari **pesan sumber yang sama** → tidak dibuat dobel.
- Kalau ada task **aktif** di percakapan yang sama dengan **action sama** → task itu **diperbarui** (bukan bikin baru).
- Selain itu → **buat task baru** (source `ai_whatsapp`), lengkap dengan judul, ringkasan, draft balasan, prioritas, tenggat, dan snapshot AI.

## 6. Isi task & status

Task berisi: judul, deskripsi/ringkasan, prioritas, tenggat (dari action + `dueInMinutes`; `reply_now` ≈ segera), kutipan bukti, draft balasan AI, keyakinan.

Status berjalan otomatis: **Belum dimulai → (dibuka/dibalas) Sedang dikerjakan → (sales tandai) Selesai**. Penyelesaian manual oleh sales.

## 7. Konfigurasi (env)

| Env | Default | Fungsi |
|---|---|---|
| `TASK_ANALYSIS_WINDOW_INITIAL` | 25 | Jumlah pesan dibaca pass pertama |
| `TASK_ANALYSIS_WINDOW_MAX` | 50 | Perluasan bila ragu |
| `TASK_ANALYSIS_MIN_CONFIDENCE` | 0.7 | Ambang task normal; di bawahnya → tinjauan |
| `TASK_ANALYSIS_REVIEW_CONFIDENCE` | 0.5 | Di bawahnya → dibuang (bukan task) |
| `OPENAI_CLASSIFIER_MODEL` / `OPENAI_GENERATOR_MODEL` | glm-4.5-flash | Model classifier / generator |

## 8. Ringkasan alur (end-to-end)

```
Customer kirim WA
  → lead blocked? ────ya──▶ TIDAK jadi task
  → tidak: baca giliran terbaru (25, perluas ke 50 bila ragu)
  → AI classify
       ignore ───────────────▶ TIDAK jadi task
       confidence < 0.5 ──────▶ TIDAK jadi task
       0.5–0.7 / ada risiko ──▶ TASK "Tinjau handover" (prioritas tinggi)
       ≥ 0.7 & actionable ────▶ TASK (reply_now / follow_up / qualify_lead)
  → dedup: update task aktif sejenis, atau buat baru
```

## 9. Contoh

- "ZWCAD Standard beda apa sama Professional?" → `reply_now`, leadSignal `interest`, conf 0.9 → **Task: [Balas] Tanya beda ZWCAD Standard vs Pro — {Nama}**.
- "mau minta penawaran EinScan 3 unit" → `reply_now`, `purchase_intent`, urgent → **Task prioritas tinggi**.
- "makasih ya 🙏" → `ignore` → **bukan task**.
- "kok mahal banget, kecewa saya" → `handover_review` → **Task tinjauan** + (di jalur auto-reply) handover ke Alih Tugas.
