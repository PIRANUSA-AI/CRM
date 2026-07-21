# Auto-Assign Lead: Leader → Sales — Dokumen Desain

Dokumen ini merancang fitur **distribusi lead otomatis**: lead masuk ke nomor WhatsApp leader, dikualifikasi dulu, lalu **di-assign ke sales yang paling cocok** dan diteruskan (handoff) untuk ditindaklanjuti.

> Status: **Desain** (belum implementasi). Branch: `feat/lead-auto-assign` (dicabang dari `feat/tasks-list`).
> Sumber kode yang direuse: `personal-whatsapp-inbox/ai-reply.ts`, `personal-whatsapp-inbox/takeover.ts`, `personal-whatsapp-inbox/lead-access.ts`, `tasks/service.ts` (`openChat`), `tasks/analyzer.ts`.

---

## 0. Konteks & Keputusan

- **Model B** (tiap sales pakai nomor WhatsApp Baileys sendiri) dipakai **sampai dapat API key WhatsApp resmi** (Cloud API). Setelah itu bisa dievaluasi pindah ke Model A (satu nomor pusat).
- **Leader juga pakai Baileys** sebagai **nomor intake** — semua lead baru masuk ke sini dulu.
- Keputusan handoff: **Opsi 1** — sales melanjutkan dari **nomornya sendiri** (thread baru), didahului **pesan pengantar** dari nomor leader. Alasan: WhatsApp tidak bisa memindahkan thread antar nomor; ini paling sesuai Model B.
- Handoff **semi-otomatis** (sales klik "Mulai Chat"), **bukan** auto-kirim penuh — alasan keamanan (menghindari salah kirim ke nomor yang keliru).

---

## 1. Gambaran Umum

```
Lead chat nomor LEADER (Baileys)
        │
        ▼
FASE 1 — Kualifikasi (AI di nomor leader)
  AI gali kebutuhan: produk, jumlah seat, industri, budget, urgensi, segmen
  → hasil: "Profil Kebutuhan Lead" terstruktur
        │
        ▼  (lead cukup terkualifikasi / leader menekan "Bagikan")
FASE 2 — Routing Engine
  skor tiap sales = f(keahlian, track record, beban, ketersediaan, ...)
  → rekomendasi sales + alasan  → set conversations.assignee_id + team_id
        │
        ▼
HANDOFF
  nomor leader kirim pesan pengantar ke customer
  → sales dapat task + notifikasi → klik "Mulai Chat"
  → sales chat customer dari NOMOR SALES (reuse TaskService.openChat)
        │
        ▼
SLA / fallback: sales tak respons X menit → re-assign / balik ke leader
```

Prinsip desain:
- **Kualifikasi dulu, assign kemudian** — jangan handoff lead mentah.
- **Human-in-the-loop** — sistem merekomendasikan; leader bisa override; sales menekan tombol kirim.
- **Reuse** — pakai AI auto-reply, takeover, dan `openChat` yang sudah ada.
- **Bertahap** — mulai dari data keras + skor sederhana; kompleksitas menyusul.

---

## 2. Fase 1 — Kualifikasi di Nomor Leader

Nomor leader adalah inbox Baileys biasa, jadi AI auto-reply (`ai-reply.ts`) sudah bisa membalas. Bedanya: persona AI di nomor leader adalah **"resepsionis/kualifikasi"**, bukan closing.

Tujuan AI fase ini: mengumpulkan **Profil Kebutuhan Lead**:

| Field | Contoh | Sumber |
|---|---|---|
| Produk diminati | ZWCAD Mechanical | dari chat |
| Jumlah seat | 10 lisensi | dari chat |
| Segmen | korporat / individu / mahasiswa | inferensi AI |
| Industri | manufaktur / arsitektur | dari chat / profil kontak |
| Budget & urgensi | ±90jt, butuh minggu ini | dari chat |
| Wilayah / bahasa | Surabaya / ID | profil kontak |

- Reuse `buildCustomerProfile()` + `retrieveKnowledge()` dari `ai-reply.ts`.
- Hasil disimpan terstruktur di `conversations.additional_attributes.lead_need` (JSON) — mirip mekanik `lead-brief`.
- **Gerbang "siap di-assign"**: AI menandai lead siap saat kebutuhan inti (produk + segmen) sudah diketahui, ATAU leader menekan tombol **"Bagikan ke Sales"** kapan saja.

**Keputusan terbuka (K1):** Fase 1 di-handle **AI** (default, scalable) atau **leader manusia** yang chat lalu klik assign? Desain ini mengasumsikan AI, dengan tombol override manual untuk leader.

---

## 3. Fase 2 — Routing Engine (Pemilihan Sales)

Skor tiap sales dihitung terhadap Profil Kebutuhan Lead. Sales dengan skor tertinggi (dan kapasitas tersedia) direkomendasikan.

### 3.1 Faktor — Data Keras (fase awal)

| Faktor | Bobot awal | Sumber data |
|---|---|---|
| **Kecocokan keahlian produk** | 40% | `sales_profiles.product_skills` |
| **Track record segmen/produk** (win-rate, jumlah closing) | 20% | dihitung dari `tasks` + pipeline (`conversations.stage_id`) |
| **Beban aktif** (makin ringan makin baik) | 20% | hitung lead/tasks aktif per sales |
| **Ketersediaan** (online / jam kerja) | 10% | `baileys_sessions.status`, jam kerja profil |
| **Level/pengalaman & wilayah/bahasa** | 10% | `sales_profiles` |

### 3.2 Faktor — Data Lunak (ditunda / opsional)

Kepribadian, gaya komunikasi, "kecocokan karakter". **Tidak dijadikan fondasi** — sulit dikuantifikasi objektif, cepat basi, rawan bias. Kalau dipakai nanti: sebagai **bobot kecil** lewat tag manual leader (mis. `cocok_customer_teknis`).

### 3.3 Rumus skor (contoh)

```
skor(sales) =
    0.40 * cocokProduk(lead.produk, sales.product_skills)
  + 0.20 * trackRecord(sales, lead.produk, lead.segmen)   // 0..1, dari histori
  + 0.20 * (1 - bebanRelatif(sales))                       // beban ringan → tinggi
  + 0.10 * tersedia(sales)                                 // 0/1
  + 0.10 * levelWilayah(sales, lead)

// kapasitas penuh → sales dikeluarkan dari kandidat (skor = -∞)
```

- Bobot **bisa diatur leader** (mis. utamakan keahlian vs pemerataan beban).
- **Fallback**: jika data profil kosong → jatuh ke **round-robin + beban** (paling adil & simpel).
- Output = **rekomendasi + alasan** yang bisa dibaca leader:
  > "Disarankan ke Deska — jago ZWCAD Mechanical, win-rate 72% di korporat, beban paling ringan (3 lead aktif)."
- Leader dapat **override manual** memilih sales lain.

---

## 4. Handoff

Setelah `assignee_id` di-set:

1. **Pesan pengantar** dari nomor leader ke customer (template, bisa diedit):
   > "Halo kak 🙏 kebutuhan kakak akan dibantu oleh **[Nama Sales]**, spesialis [produk]. Beliau akan menghubungi kakak dari nomor ini ya."
2. **Task follow-up** dibuat untuk sales (reuse modul `tasks`) + **notifikasi** ("Lead baru masuk untukmu").
3. Sales membuka task → klik **"Mulai Chat"** → reuse **`TaskService.openChat`** (buat percakapan di inbox sales + takeover + buka `/chat` dengan pesan pembuka terisi). Sales chat customer **dari nomor sales sendiri**.
4. Percakapan di nomor leader ditandai **selesai/diserahkan** (status resolved atau tanda "handed_off").

**Catatan UX:** customer akan dikontak nomor kedua (nomor sales). Pesan pengantar di langkah 1 meminimalkan kebingungan.

---

## 5. Model Data Baru

### 5.1 `sales_profiles` (via `prisma db push`)

```prisma
model sales_profiles {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  app_id         String   @db.Uuid
  user_id        String   @db.Uuid            // sales
  product_skills Json     @default("[]")      // ["ZWCAD Mechanical","ZW3D"]
  segments       Json     @default("[]")      // ["korporat","mahasiswa"]
  level          String?  @db.VarChar(20)     // junior | mid | senior
  max_active     Int?     @default(20)        // kapasitas lead aktif
  work_hours     Json?                        // {tz, days, start, end}
  regions        Json     @default("[]")      // ["Jawa Timur"]
  languages      Json     @default("[]")      // ["id","en"]
  tags           Json     @default("[]")      // tag lunak opsional
  notes          String?
  created_at     DateTime @default(now()) @db.Timestamptz(6)
  updated_at     DateTime @default(now()) @db.Timestamptz(6)

  @@unique([app_id, user_id])
}
```

### 5.2 Metrik otomatis (dihitung, tidak di-input manual)

Diturunkan dari data CRM yang sudah ada, di-cache (mis. Redis / tabel ringkasan):

- **Win-rate & jumlah closing** per produk & segmen → dari `tasks` + pipeline stage percakapan.
- **Rata-rata waktu respons** → dari `messages` / `conversations.first_response_time_seconds`.
- **Beban aktif** → hitung `whatsapp_lead_registrations` (ai_handling=false) + tasks open/in_progress per sales.

### 5.3 Kolom yang sudah ada (tidak perlu skema baru)

- `conversations.assignee_id`, `conversations.team_id` — untuk menyimpan hasil assignment.
- `whatsapp_lead_registrations` — kepemilikan lead + takeover (reuse).

---

## 6. API / Endpoint (rencana)

| Method | Path | Fungsi |
|---|---|---|
| `GET` | `/sales-profiles` | daftar profil sales (leader) |
| `PUT` | `/sales-profiles/:userId` | leader atur keahlian/kapasitas sales |
| `GET` | `/lead-routing/:conversationId/suggest` | rekomendasi sales + skor + alasan |
| `POST` | `/lead-routing/:conversationId/assign` | assign (auto/pilih manual) + handoff |
| `POST` | `/lead-routing/:conversationId/reassign` | re-assign (SLA/manual) |

Assign akan memanggil ulang mekanik `tasks` + `openChat` yang sudah ada.

---

## 7. SLA / Fallback

- Setelah assign, mulai timer. Jika sales **tidak merespons dalam X menit** (default mengikuti `PERSONAL_TAKEOVER_SLA_MINUTES`) → **auto re-assign** ke kandidat berikutnya atau **balik ke leader**.
- Reuse konsep SLA yang sudah ada di halaman **Alih Tugas**.

---

## 8. Integrasi dengan Kode Existing

| Kebutuhan | Reuse dari |
|---|---|
| AI kualifikasi + profil customer + RAG | `ai-reply.ts` (`buildCustomerProfile`, `retrieveKnowledge`) |
| Buat percakapan di inbox sales + takeover + buka chat | `TaskService.openChat` |
| Stop AI saat manusia handle | `PersonalTakeoverService.takeover` |
| Kepemilikan lead | `lead-access.ts` (`confirmPersonalLead`) |
| Task + notifikasi | modul `tasks`, `NotificationService` |
| Klasifikasi lead/kebutuhan | `tasks/analyzer.ts` (bisa diperluas) |

---

## 9. Milestone Bertahap

1. **M1 — Data & profil**: tabel `sales_profiles` + UI leader isi keahlian/kapasitas + metrik beban aktif.
2. **M2 — Routing sederhana**: skor round-robin + beban + kecocokan produk; endpoint `suggest` + `assign`; assign manual oleh leader (tombol "Bagikan ke Sales").
3. **M3 — Handoff**: pesan pengantar + task + notifikasi + tombol "Mulai Chat" (reuse `openChat`).
4. **M4 — Kualifikasi AI (Fase 1)**: persona resepsionis di nomor leader + simpan Profil Kebutuhan Lead + gerbang "siap di-assign".
5. **M5 — Auto-assign penuh**: trigger otomatis saat lead terkualifikasi + track record dalam skor.
6. **M6 — SLA/fallback**: re-assign otomatis bila tak direspons.
7. **M7 (nanti)**: faktor lunak opsional; evaluasi pindah ke WhatsApp Cloud API resmi.

---

## 10. Keputusan Terbuka (perlu konfirmasi)

- **K1** — Fase 1 kualifikasi: **AI** (default) atau **leader manusia**?
- **K2** — Bobot skor awal (Bagian 3.1): pakai default atau ada preferensi leader?
- **K3** — Aturan mulai: **assign manual** dulu (leader klik), baru auto-assign di M5 — setuju?
- **K4** — Pesan pengantar handoff: template baku atau leader edit tiap kali?

---

## 11. Batasan & Risiko (Baileys)

- **Nomor tidak resmi**: nomor leader menampung banyak lead + AI reply → rawan limit/banned. Batasi kecepatan balas AI; siapkan pindah ke **Cloud API resmi**.
- **Single point of failure**: kalau nomor leader terputus, intake berhenti. Perlu monitor koneksi + notifikasi.
- **Handoff dua nomor**: customer dikontak nomor kedua (sales). Dimitigasi pesan pengantar.
- **Keadilan penilaian sales**: skor dari data keras + transparan (tampilkan alasan). Hindari faktor subjektif sebagai fondasi.
