# Alih Tugas (Takeover / Handover)

Dokumen ini menjelaskan fitur **Alih Tugas** pada CRM WhatsApp-first sales: apa itu, kapan sebuah lead berpindah dari AI ke manusia, fitur pendukungnya, dan **best practice** penggunaannya di proyek ini.

## Konsep inti: satu state, dua pemicu

Setiap lead WhatsApp berada di salah satu mode:

- **Mode AI** (`ai_handling_enabled = true`) — AI membalas otomatis.
- **Mode Manusia** (`ai_handling_enabled = false`) — AI berhenti, sales yang menangani.

Ada **dua jalan** menuju mode manusia (state-nya sama, hanya beda pemicu — disimpan di `takeover_source`):

| Pemicu | Sumber | Siapa yang memulai | Contoh |
|--------|--------|--------------------|--------|
| **Handover** | `ai` | AI (otomatis) | AI menilai `needsHuman` atau keyakinan rendah (marah, sensitif, legal, negosiasi) |
| **Takeover** | `manual` | Sales (tombol) | Sales klik "Ambil Alih" di chat untuk pegang lead sendiri |

Jadi *handover* dan *takeover* bukan dua fitur berbeda — keduanya menghasilkan mode manusia yang sama, lalu muncul di halaman **Alih Tugas**.

## Alur lengkap

1. **Awal:** lead `confirmed` dibalas AI otomatis (mode AI).
2. **Masuk mode manusia** lewat salah satu pemicu di atas:
   - AI berhenti membalas lead itu (`scheduleInbound` langsung skip: `human_takeover`).
   - Draf/balasan AI yang sedang antre untuk lead itu **dibatalkan** (khusus takeover manual).
   - Lead muncul di halaman **Alih Tugas** + notifikasi (khusus handover AI).
3. **Selama mode manusia:** sales membalas manual lewat chat. Badge percakapan berubah jadi *Handover* (dialihkan AI) atau *Sales* (diambil manual).
4. **Kembalikan ke AI:** dari header chat atau halaman Alih Tugas → mode AI aktif lagi, lead hilang dari Alih Tugas.

## Halaman "Alih Tugas"

Daftar lead yang sedang mode manusia. **Sales** melihat miliknya; **leader/ceo/superadmin** melihat semua. Tiap baris memuat:

- Badge sumber: **Dialihkan AI** / **Diambil sales**.
- **SLA / waktu tunggu**: "menunggu X menit", ditandai **lewat SLA** bila melewati ambang (default 30 menit, `PERSONAL_TAKEOVER_SLA_MINUTES`).
- **Alasan** (dari AI) dan **draf balasan AI** bila tersedia.
- **Catatan handoff** (opsional).
- Tombol **Buka Chat** dan **Kembalikan ke AI** (dengan catatan opsional).
- **Riwayat**: timeline siapa mengambil/mengembalikan, sumber, catatan, dan waktu (audit).

## Hubungan dengan fitur lain

- **Daftar Tugas (task list):** terpisah. Alih Tugas = *siapa yang membalas* (AI vs manusia). Task list = *pengingat aksi* (balas, follow-up, kualifikasi). Satu lead bisa ada di keduanya; takeover tidak otomatis membuat task.
- **Notifikasi:** handover AI mengirim notifikasi ke pemilik lead. Notifikasi ini **auto-selesai** saat lead dikembalikan ke AI.
- **Handover enterprise (`/handover`):** fitur lama untuk CS tim/chatbot (approval + SLA + roster), disembunyikan dari menu karena tidak dipakai alur WA personal. Jangan dicampur dengan Alih Tugas.

## Kendala penting (yang membentuk desain)

- **Setiap lead terikat pada nomor WhatsApp milik sales pemiliknya.** Sales lain secara fisik **tidak bisa** membalasnya dari nomor sendiri. Karena itu **reassign ke sales lain belum diterapkan** — perlu model khusus (mis. balasan tetap lewat nomor pemilik) sebelum dibangun.
- **Handover AI sengaja tidak menyusun draf** untuk kasus sensitif; draf hanya ada di mode draf (auto-reply dimatikan).

## Trigger & lokasi kode

Keputusan handover otomatis diambil **sebelum AI membalas**, oleh model reviewer (Ollama) di `processReview`, sebagai penilaian diri "aku perlu manusia atau tidak".

Alur: `pesan masuk (lead confirmed) → scheduleInbound (jeda ~4 dtk) → processReview → { shouldReply, reason, confidence, needsHuman } → handover?`

Kondisi handover di kode:

```
if (decision.needsHuman || decision.confidence < settings.min_confidence) → handover
```

- **Keluhan / marah / sensitif** → reviewer menyetel `needsHuman = true` (didefinisikan di prompt: kemarahan serius, ancaman, sengketa, permintaan legal, negosiasi sensitif, atau jawaban berisiko).
- **AI salah arah / ragu** → **gerbang keyakinan pra-jawaban**: bila `confidence < min_confidence` (default `0.65`), AI menyerah lebih dulu dan mengalihkan ke manusia, alih-alih menjawab ngawur. Ini bersifat **preventif**, bukan koreksi setelah AI terlanjur salah menjawab.

### Peta file

| Peran | File | Baris (acuan) |
|-------|------|---------------|
| Aturan `needsHuman` (prompt reviewer) | `apps/backend/src/modules/personal-whatsapp-inbox/ai-reply.ts` | ~624 |
| Kondisi handover (`needsHuman \|\| confidence < min_confidence`) | `ai-reply.ts` | ~653–656 |
| Default `min_confidence` = 0.65 | `ai-reply.ts` | ~148 (set: ~521) |
| Panggil auto-takeover (`takeover source: 'ai'`) | `ai-reply.ts` | ~663 |
| AI berhenti saat mode manusia (`scheduleInbound` skip) | `ai-reply.ts` | ~530–544 |
| State & aksi takeover/release | `apps/backend/src/modules/personal-whatsapp-inbox/takeover.ts` | — |
| Takeover manual (endpoint) | `apps/backend/src/modules/personal-whatsapp-inbox/index.ts` | `POST /:conversationId/takeover` |
| Tombol "Ambil Alih" (UI) | `apps/frontend/src/routes/_app/chat.tsx` | header chat |
| Pemicu auto-reply (jalur confirmed) | `apps/backend/src/modules/webhook/service.ts` | — |

### Trigger deterministik (sudah ada)

Selain gerbang `needsHuman` + confidence, `processReview` menjalankan **pemeriksaan deterministik lebih dulu** (melewati model, lebih cepat & pasti) — lihat `detectDeterministicHandover` di `ai-reply.ts`:

1. **Kata kunci minta manusia / keluhan** — mis. "bicara dengan manusia", "customer service", "komplain", "refund" → langsung handover. Daftar: `HUMAN_REQUEST_PATTERNS`.
2. **Ketidakpuasan pasca-balasan-AI** — bila pesan sebelumnya dari AI (`sender_type = bot`) dan customer merespons negatif ("bukan itu", "maksud saya", "gak nyambung", "kecewa", dst) → handover. Daftar: `DISSATISFACTION_PATTERNS`.

Prompt reviewer juga diperkuat: `needsHuman=true` mencakup permintaan berbicara dengan manusia/CS dan customer yang tampak tidak puas — sebagai jaring pengaman bila frasa tidak ada di daftar kata kunci.

### Belum ada (kandidat berikutnya)

- **Deteksi loop** — customer mengulang pertanyaan sama berkali-kali tanpa progres → belum memicu handover.

---

## Best Practice Alih Tugas di proyek ini

### Untuk sales
1. **Ambil alih saat butuh sentuhan manusia**, bukan untuk semua chat. Kalau AI sudah menjawab dengan baik, biarkan AI. Ambil alih untuk: negosiasi harga, keluhan, closing, atau saat AI salah arah.
2. **Selalu kembalikan ke AI** begitu urusan manusia selesai. Lead yang dibiarkan di mode manusia = AI mati untuk lead itu (tidak ada balasan otomatis lagi).
3. **Isi catatan handoff** saat mengembalikan ("sudah dijawab, tinggal follow-up") agar konteks tidak hilang.
4. **Prioritaskan yang lewat SLA.** Item bertanda merah = customer menunggu terlalu lama.

### Untuk leader
5. **Pantau halaman Alih Tugas** sebagai antrean kerja tim. Banyak item "Dialihkan AI" yang menumpuk = sinyal AI/knowledge perlu diperbaiki.
6. **Perhatikan lonjakan handover** pada topik/produk tertentu → tambah/rapikan knowledge base agar AI bisa menjawab sendiri.

### Prinsip teknis (agar tetap sehat)
7. **AI mati total untuk lead yang di-takeover** — jangan pakai takeover sebagai "jeda", karena tidak ada balasan otomatis sampai dikembalikan.
8. **Idempotent & fail-open:** mengambil alih lead yang sudah diambil hanya menyegarkan metadata; kegagalan notifikasi/log tidak pernah menggagalkan aksi utama.
9. **State per-percakapan**, disimpan di `whatsapp_lead_registrations` (`ai_handling_enabled`, `takeover_source`, `takeover_reason`, `handoff_note`, `takeover_at`), bukan flag global per-sales.
10. **Audit tersimpan** di `conversation_activity_log` (`personal_takeover` / `personal_release`) — gunakan untuk menelusuri riwayat penanganan lead.

### Anti-pola (hindari)
- Ambil alih lalu lupa mengembalikan → lead "senyap" tanpa AI.
- Menjadikan Alih Tugas sebagai daftar tugas → gunakan Daftar Tugas untuk itu.
- Mengandalkan reassign antar-sales → belum didukung karena keterbatasan nomor WhatsApp.

## Ringkasan teknis

- **Tabel:** `whatsapp_lead_registrations` (kolom takeover) + `conversation_activity_log` (audit).
- **Service:** `PersonalTakeoverService` (`takeover`, `release`, `list`, `count`, `history`, `isAiHandlingEnabled`).
- **AI mematuhi state:** `PersonalAiReplyService.scheduleInbound` skip bila mode manusia; `processReview` handover → `takeover(source: 'ai')`.
- **Realtime:** event `personal-takeover:updated` (badge sidebar + halaman + notifikasi ikut menyegarkan).
- **Konfigurasi:** `PERSONAL_TAKEOVER_SLA_MINUTES` (default 30).
