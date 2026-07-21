# Notifikasi (In-App)

Dokumen ini menjelaskan **apa saja yang masuk ke notifikasi** (ikon lonceng di TopBar, samping profil) pada CRM WhatsApp-first sales.

## Prinsip

Sebuah kejadian masuk notifikasi hanya jika **butuh tindakan sales/leader** dan berisiko ada lead/uang hilang bila tidak segera dilihat. Info biasa (tanpa aksi) tidak dimasukkan agar lonceng tidak berisik.

- Notifikasi **per pengguna** (di-scope ke akun yang login).
- **Dedup per subjek**: satu notifikasi hidup per subjek. Kejadian baru pada subjek yang sama **menyegarkan** notifikasi dan menandainya **belum dibaca** lagi (tidak menumpuk duplikat).
- Realtime: lonceng diperbarui otomatis (socket) + penyegaran berkala.
- Klik notifikasi → otomatis **ditandai dibaca** dan diarahkan ke halaman terkait. Ada tombol **"Tandai semua dibaca"**.

## Kategori Notifikasi

| # | Tipe | Judul | Kapan muncul (pemicu) | Penerima | Klik menuju |
|---|------|-------|------------------------|----------|-------------|
| 1 | `takeover` | Lead dialihkan ke kamu oleh AI | AI menilai percakapan perlu ditangani manusia (`needsHuman` atau keyakinan rendah) lalu meng-handover lead | Sales pemilik lead | Alih Tugas |
| 2 | `lead_pending` | Lead baru perlu keputusan | Nomor baru menghubungi dan menunggu dikonfirmasi/ditolak (status `pending`) | Sales pemilik | Kotak Masuk (chat) |
| 3 | `task_urgent` | Tugas mendesak / prioritas tinggi baru | Task baru dibuat dengan prioritas `high`/`urgent` | Sales yang ditugaskan (assignee) | Detail tugas |
| 4 | `ai_draft` | Draf balasan AI siap ditinjau | Auto-reply dimatikan; AI menyusun draf balasan menunggu dikirim sales | Sales pemilik | Kotak Masuk (chat) |
| 5 | `wa_disconnected` | WhatsApp terputus | Sesi WhatsApp sales logout / terputus permanen (tidak auto-reconnect) | Sales pemilik | Halaman sambungkan WhatsApp |

### Detail per kategori

**1. Takeover / Handover (`takeover`)**
- Hanya untuk handover **otomatis dari AI** (`source = ai`). Ambil-alih manual tidak memicu notifikasi karena sales sendiri yang melakukannya.
- Body memuat alasan AI (mis. "pelanggan marah", "pertanyaan sensitif").
- Dedup: `takeover:<conversationId>` — satu notifikasi per percakapan.

**2. Lead baru perlu keputusan (`lead_pending`)**
- Muncul saat nomor yang belum tersimpan pertama kali menghubungi (belum dikonfirmasi sebagai lead).
- Lead diblokir tidak memicu notifikasi.
- Dedup: `lead_pending:<conversationId>`.

**3. Tugas mendesak (`task_urgent`)**
- Hanya saat task **baru dibuat** berprioritas `high`/`urgent`. Perubahan pada task yang sudah ada tidak mengirim ulang.
- Dedup: `task:<taskId>` — satu notifikasi per tugas.

**4. Draf AI siap (`ai_draft`)**
- Hanya berlaku ketika auto-reply **dimatikan** (mode draf). AI menyusun balasan untuk ditinjau & dikirim sales.
- Saat handover otomatis (kasus sensitif) AI sengaja **tidak** menyusun draf, jadi kategori ini tidak muncul untuk handover.
- Dedup: `ai_draft:<conversationId>`.

**5. WhatsApp terputus (`wa_disconnected`)**
- Paling kritis: jika WhatsApp sales putus, **semua** lead tidak terbalas dan AI berhenti total.
- Muncul saat sesi `logged_out` atau `disconnected` permanen. Kondisi `reconnecting`/`restarting` sementara **tidak** memicu (agar tidak berisik saat pemulihan otomatis).
- Dedup: `wa_disconnected:<channelId>`.

## Belum termasuk (bisa ditambah nanti)

- **SLA tim terlewat** & **lonjakan handover** (notifikasi khusus leader).
- **Balasan customer di lead yang sedang dipegang manusia** (mode takeover).
- Preferensi/pengaturan notifikasi per pengguna (mute per kategori).

## Catatan teknis singkat

- Tabel: `notifications` (`type`, `title`, `body`, `conversation_id`, `task_id`, `dedup_key`, `read_at`, dst).
- Unik: `(app_id, user_id, dedup_key)` — dasar dedup/upsert.
- Socket hanya mengirim "ping" (`notification:new`); isi diambil ulang lewat API yang sudah ter-scope per pengguna (konten tidak dikirim lewat socket).
- Semua producer bersifat *fail-open*: kegagalan membuat notifikasi tidak pernah menggagalkan alur utama (balas pesan, buat task, dsb).
