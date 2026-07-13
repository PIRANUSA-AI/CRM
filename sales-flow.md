# Peran Sales, Alur Kerja End to End (Revisi)

Ditulis 13 Juli 2026. Dokumen ini basis buat desain UX/UI dan implementasi fullstack, jadi tiap bagian dilengkapi detail teknis kecil, bukan cuma narasi flow.

Penanda status tiap bagian:
`[ADA]` sudah jalan di sistem sekarang
`[BARU]` belum ada, perlu dibangun
`[PUTUSKAN]` perlu keputusan produk dulu sebelum bisa didesain

---

## 0. Open Question yang Perlu Dijawab Duluan

Sebelum tim mulai desain schema dan wireframe, lima hal ini perlu keputusan biar ga bolak balik ubah struktur di tengah jalan.

| No | Pertanyaan | Kenapa penting | Asumsi sementara di dokumen ini |
|----|-----------|-----------------|----------------------------------|
| 1 | Nomor yang diblokir contact lagi lewat channel lain, dianggap orang yang sama? | Nentuin apakah butuh identifier lintas channel selain nomor telepon | Ya, pakai `contact_identity_id` sebagai kunci utama, nomor WA dan email jadi child record di bawahnya |
| 2 | Nomor pra daftar yang ga pernah chat, ada masa berlaku? | Cegah data mati numpuk | Ya, default 90 hari, bisa diatur sales, auto hapus kalau lewat dan ga pernah ada chat masuk |
| 3 | SLA handover habis tanpa diambil siapa siapa, gimana? | Cegah client keabaian pas lagi butuh manusia | Auto eskalasi ke leader plus notifikasi, AI tetap standby ga balas dulu sampai ada yang ambil |
| 4 | Reassign lead ke sales lain, histori dan persona ikut atau ngga? | Nentuin ownership data | Histori chat ikut ke sales baru (biar konteks ga hilang), persona TIDAK ikut (karena persona itu gaya bicara personal sales lama, bukan milik client) |
| 5 | Draft follow up nunggu diklik bentrok sama auto reply real time | Cegah AI kirim dua arah pesan berbeda | Begitu client kirim pesan baru duluan, draft follow up yang masih pending otomatis dibatalkan dan masuk lagi ke flow normal langkah 2 |

Kalau ada yang beda dari asumsi di atas, tinggal update bagian terkait, strukturnya udah dirancang biar gampang diganti.

---

## 1. Ringkasan Peran

Sales adalah pemilik nomor WhatsApp personal, dan ke depannya juga pemilik alamat email untuk komunikasi client. Kerjaan hariannya balas chat masuk dibantu AI, milih chat mana yang lead dan mana yang bukan, follow up client yang belum closing atau mau kadaluarsa, dan atur persona AI miliknya sendiri. Sales itu eksekutor harian, paling banyak interaksi langsung sama chat dan client dibanding role lain di sistem.

Prinsip desain yang dipegang di seluruh flow ini:
1. AI nyiapin, sales yang mutusin. AI ga pernah kirim sesuatu ke client tanpa persetujuan sales, kecuali untuk chat yang statusnya sudah confirmed lead dan lagi dalam mode auto reply.
2. Satu identitas client, banyak channel. Client yang sama harus kekenal walau dia contact lewat WA atau Email.
3. Semua keputusan sales harus reversible selama masuk akal, misalnya nomor yang diblokir bisa dibuka lagi.

---

## 2. Alur Harian Lengkap

### Langkah 1, Buka Dashboard `[BARU]` untuk bagian task list, `[ADA]` untuk metrik

Begitu login, yang pertama sales lihat seharusnya bukan cuma metrik agregat, tapi daftar kerjaan konkret hari ini yang udah disusun AI.

Detail yang perlu didesain:
- Urutan prioritas task, yang paling mendesak (misal sisa waktu expired paling dikit) ada di paling atas.
- Tiap item task nunjukin, nama contact, kenapa dia masuk daftar (expiring, belum ada keputusan, atau progres lain), dan draft balasan kalau ada.
- Sales bisa klik expand buat baca histori chat singkat tanpa keluar dari dashboard.
- Ada aksi cepat di tiap item, kirim draft apa adanya, edit dulu baru kirim, atau snooze (tunda tampil sampai waktu tertentu).
- Kalau task di snooze, dia harus muncul lagi otomatis pas waktunya, ga boleh hilang selamanya.
- Task yang udah selesai (client sudah dibales atau sudah closing) otomatis hilang dari daftar, tapi tetap kesimpen di histori buat referensi.

Yang sudah ada sekarang cuma metrik agregat (chat masuk, resolved rate, response time, revenue) dan alert operasional, belum ada to do list personal ini.

### Langkah 2, Keputusan Lead atau Bukan `[ADA]`

Tiap ada nomor baru chat ke WhatsApp pribadi sales, dia dapat notifikasi konfirmasi, ini calon client beneran atau bukan.

- Diterima, AI langsung boleh balas otomatis pakai persona yang udah diatur sales.
- Ditolak, chat dihapus dari daftar, nomor diblokir, chat berikutnya dari nomor sama ga akan muncul lagi sampai sales buka blokirnya sendiri.

Sales juga bisa pra daftar nomor sebelum nomor itu chat, kalau udah tau itu calon client, supaya begitu masuk langsung dianggap lead tanpa perlu konfirmasi lagi.

Mekanisme ini sudah jalan penuh, `resolveLeadGateForInbound`, `confirmLeadStatus`, tabel `whatsapp_lead_registrations`. Pra daftar lewat `POST /self/leads`.

Detail tambahan yang perlu dipikirkan `[PUTUSKAN]`:
- Expiry buat pra daftar yang ga pernah chat (lihat bagian 0 nomor 2).
- Kalau nomor yang sama sebelumnya pernah closing (jadi client lama), terus chat lagi dari nomor beda, sistem perlu cara buat kenalin ini orang yang sama, bukan lead baru dari nol.

### Langkah 3, Antrian Handover `[ADA]`, Perlu Tambahan Eskalasi `[BARU]`

Ga semua chat aman dibales AI terus. Chat yang butuh sentuhan manusia (client marah, pertanyaan rumit, negosiasi harga) masuk ke antrian handover, dengan SLA countdown per item. Sales cek antrian, lihat mana yang udah lama nunggu, terus mutusin ambil alih sendiri atau biarin AI lanjut.

Yang perlu ditambah:
- Kalau SLA habis dan belum ada yang ambil, sistem harus auto eskalasi, notifikasi ke leader, dan AI tetap standby ga balas dulu sampai ada manusia yang pegang. Ini penting biar client ga keabaian pas justru lagi butuh manusia.
- Item di antrian handover perlu label alasan kenapa dia masuk situ (marah, negosiasi, pertanyaan rumit, atau lainnya) biar sales bisa prioritasin mana yang paling urgent duluan, bukan cuma urut waktu tunggu.

### Langkah 4, Atur atau Perbarui Persona AI `[ADA]`

Sesekali, sales atur gimana AI nya bicara, nama panggilan, nada bicara, fokus produk. Sales juga bisa minta AI belajar dari histori chat lama biar gaya bicaranya makin mirip aslinya.

Sudah ada, `GET/POST /self/persona`, `/self/persona/learn`. Catatan penting, persona ini nempel ke akun sales dan dipakai sama rata buat semua nomor WA yang dia pegang, belum bisa beda persona per nomor kalau sales punya lebih dari satu koneksi.

### Langkah 5, Follow Up Proaktif `[BARU]`

Idealnya, kalau ada client lama ga dibales atau mau habis masa tawaran, sales dapat pengingat dan draft follow up otomatis dari AI, bukan dia yang harus scroll cari sendiri siapa yang perlu difollow up. Ini sebenarnya bagian dari task list di langkah 1, tapi detail teknisnya cukup banyak jadi dibahas terpisah di bagian 4.2.

---

## 3. Diagram Status (Textual)

### Status Chat atau Lead

```
NOMOR BARU MASUK
      |
      v
MENUNGGU KEPUTUSAN SALES ------ (ditolak) --> DIBLOKIR (bisa dibuka manual)
      |
   (diterima, atau sudah pra daftar)
      |
      v
AI HANDLING (auto reply aktif)
      |
   (terdeteksi butuh manusia)
      |
      v
ANTRIAN HANDOVER (SLA countdown)
      |        |
 (diambil    (SLA habis
  sales)      tanpa diambil)
      |        |
      v        v
HUMAN HANDLING   ESKALASI KE LEADER, AI tetap standby
      |
   (selesai atau kembali normal)
      |
      v
AI HANDLING lagi
```

### Status Task Follow Up `[BARU]`

```
AI MENEMUKAN KANDIDAT FOLLOW UP
      |
      v
DRAFT DIBUAT (menunggu review sales)
      |
   (client chat duluan sebelum diklik)
      |
      v
DRAFT DIBATALKAN OTOMATIS, chat masuk flow normal langkah 2
```

```
DRAFT DIBUAT
      |
  (sales edit, opsional)
      |
      v
SALES KLIK KIRIM
      |
      v
TERKIRIM, task selesai, masuk histori
```

```
DRAFT DIBUAT
      |
  (sales snooze)
      |
      v
MUNCUL LAGI DI WAKTU YANG DITENTUKAN
```

---

## 4. Spesifikasi Detail Bagian yang Belum Ada

### 4.1 Task List Harian `[BARU]`

Sumber data yang digabung jadi satu daftar:
- Client yang penawarannya mau expired dalam N hari (N bisa diatur, default 3 hari).
- Client yang nanya produk tapi belum ada keputusan dalam N jam (default 24 jam).
- Progres lain yang AI temukan sendiri dari histori chat, misalnya client yang sempat bilang "nanti gue kabarin lagi" dan udah lewat dari waktu yang dia sebut sendiri.

Kolom data yang dibutuhkan di tabel task, kurang lebih begini polanya:
- id task
- contact identity id
- tipe (expiring, unanswered, custom finding)
- alasan singkat (teks yang ditulis AI, kenapa ini masuk daftar)
- draft pesan (kalau ada)
- prioritas (angka, dihitung dari urgensi)
- status (pending, snoozed, sent, dismissed, expired)
- waktu snooze sampai kapan (kalau di snooze)
- waktu dibuat, waktu terakhir diubah

### 4.2 Draft Follow Up Klik Kirim `[BARU]`

Ini beda dari auto reply yang udah jalan sekarang, auto reply langsung kirim tanpa direview, sementara follow up proaktif butuh tahap siap kirim menunggu klik.

Alur teknisnya:
1. AI generate draft berdasarkan histori chat dan persona sales.
2. Draft masuk status pending, muncul di task list.
3. Sales bisa, kirim langsung, edit dulu baru kirim, snooze, atau dismiss (ga jadi follow up sama sekali).
4. Kalau sebelum sales sempat klik apapun, client keburu chat duluan lewat channel yang sama, draft otomatis dibatalkan dan chat itu masuk lagi ke flow normal langkah 2, biar AI ga kirim dua respon yang beda arah di waktu yang sama.
5. Draft yang udah lewat masa berlaku tertentu (misal 7 hari ga disentuh) otomatis expired, ga nyampah di task list terus.

Perlu ada juga histori edit, kalau sales ubah draft sebelum kirim, versi asli dari AI tetap kesimpen buat evaluasi kualitas draft AI ke depannya.

### 4.3 Kanal Email `[BARU]`

Follow up dan balasan seharusnya bisa lewat WhatsApp atau Email, sales pilih sesuai konteks client. Sekarang kanal Email sama sekali belum ada, cuma WhatsApp yang jalan.

Hal yang perlu diputuskan sebelum desain:
- Sales pakai email pribadi mereka sendiri, atau sistem kasih alamat email khusus per sales (misalnya lewat subdomain perusahaan)? Ini nentuin apakah integrasinya pakai SMTP/IMAP standar atau API provider email.
- Kalau client yang sama contact lewat WA dan Email di waktu berbeda, sistem harus kenalin itu orang yang sama lewat `contact_identity_id`, bukan dua record terpisah.
- Channel yang dipilih itu per pesan (sales pilih tiap mau kirim) atau per contact (sekali diatur, semua komunikasi ke situ lewat channel yang sama)? Disaranin per pesan, biar fleksibel, tapi sistem tetap simpan channel yang terakhir dipakai sebagai default berikutnya.
- Draft follow up di bagian 4.2 harus bisa pilih channel juga, bukan cuma WhatsApp.

### 4.4 Persona per Koneksi WhatsApp `[BARU]`

Kalau nanti satu sales pegang lebih dari satu nomor atau brand dengan gaya bicara yang beda, persona harus bisa diatur per koneksi, bukan satu untuk semua nomor kayak sekarang.

Yang perlu dipikirkan buat migrasi:
- Persona yang udah ada sekarang jadi default atau fallback, biar sales yang cuma punya satu nomor ga ngerasa ada perubahan.
- UI perlu ada pemilih koneksi di halaman pengaturan persona, baru nanti form persona di bawahnya nyesuain koneksi yang dipilih.
- Fitur belajar dari histori (`/self/persona/learn`) juga perlu tau belajar dari histori chat nomor yang mana, kalau sales punya lebih dari satu.

---

## 5. Yang Dikelola Sales (Manage)

- Koneksi WhatsApp pribadinya sendiri, connect atau scan ulang QR kalau session putus.
- Ke depannya, koneksi Email miliknya sendiri.
- Keputusan lead atau bukan, terima atau tolak tiap chat baru, buka blokir nomor yang udah ditolak.
- Daftar nomor lead, pra daftar nomor yang udah pasti calon client.
- Persona AI miliknya sendiri, tone, fokus produk, belajar dari histori chat, nantinya per koneksi.
- Ambil alih chat dari AI, kapan AI lanjut balas, kapan dia sendiri yang turun tangan.
- Task list harian, kirim, edit, snooze, atau dismiss draft follow up.

Yang tidak bisa sales kelola:
- Channel WhatsApp resmi perusahaan, itu wewenang CEO atau superadmin.
- Persona atau lead list sales lain.
- Assign ulang chat ke sales lain, itu wewenang leader ke atas.

---

## 6. Yang Dipantau Sales (Monitor)

- Chat masuk hari ini, di inbox WhatsApp pribadinya, nantinya juga inbox email.
- Antrian handover, chat yang butuh diambil alih, dengan sisa waktu SLA dan label alasan.
- Task list follow up harian.
- Metrik pribadi, berapa chat masuk, berapa yang udah diselesaikan AI, response time, di dashboard.

---

## 7. Laporan ke Leader `[ADA]`

Sales ga bikin laporan manual, semua aktivitasnya (chat masuk, response time, resolved rate) otomatis terekam dan keliatan sama leader lewat dashboard leader. Sales ga perlu lapor apapun terpisah, sistem yang nyediain visibilitasnya ke atas.

---

## 8. Edge Case yang Perlu Diputuskan Sebelum Build

1. Nomor yang diblokir contact lagi lewat channel resmi perusahaan atau lewat email, apakah tetap keblokir atau dianggap kasus baru.
2. Client yang pernah closing terus chat lagi dari nomor beda, gimana sistem ngenalin dia bukan lead baru.
3. Dua sales pegang koneksi yang beda tapi ternyata client yang sama contact ke keduanya (kebetulan atau sengaja), apakah perlu deteksi duplikat lintas sales.
4. WhatsApp session putus di tengah jalan pas lagi ada auto reply berjalan, gimana handling pesan yang ketunda.
5. Time zone buat perhitungan expiring dan SLA, dipastiin konsisten (disaranin pakai WIB sebagai default karena kantor di Jakarta, tapi tetap simpan di UTC di database).
6. Kalau sales edit draft follow up terus ga jadi kirim (dismiss), apakah AI belajar dari situ buat draft berikutnya biar makin akurat, atau dianggap kasus per kasus aja.

---

## 9. Struktur Data Usulan

Bukan schema final, tapi kerangka buat mulai desain database.

**contact_identity**
id, nama, catatan, dibuat kapan

**contact_channel** (child dari contact_identity, satu contact bisa punya banyak channel)
id, contact_identity_id, tipe (whatsapp atau email), nilai (nomor atau alamat email), koneksi_sales_id, status (lead menunggu, lead confirmed, diblokir)

**persona**
id, sales_id, koneksi_id (nullable, null berarti berlaku untuk semua koneksi sampai fitur 4.4 jalan), nama panggilan, nada bicara, fokus produk, dibuat dari belajar histori atau ngga

**handover_queue_item**
id, contact_channel_id, alasan, waktu masuk antrian, batas waktu SLA, status (menunggu, diambil, eskalasi, selesai), diambil oleh siapa

**follow_up_task**
id, contact_channel_id, tipe (expiring, unanswered, custom), alasan, draft_pesan, channel_pilihan, prioritas, status (pending, snoozed, sent, dismissed, expired), waktu snooze sampai, dibuat kapan, diubah kapan

**follow_up_draft_history**
id, follow_up_task_id, versi_asli_ai, versi_setelah_diedit, diedit kapan

---

## 10. Endpoint Usulan

Yang sudah ada, tetap dipakai.
`GET/POST /self/persona`
`POST /self/persona/learn`
`POST /self/leads`

Usulan tambahan buat bagian baru.
`GET /self/tasks` daftar task follow up harian
`POST /self/tasks/{id}/send` kirim draft apa adanya
`PATCH /self/tasks/{id}` edit draft sebelum kirim
`POST /self/tasks/{id}/snooze` tunda tampil sampai waktu tertentu
`POST /self/tasks/{id}/dismiss` batalkan follow up
`GET /self/handover` daftar antrian handover
`POST /self/handover/{id}/claim` sales ambil alih chat
`GET /self/persona/{koneksi_id}` persona per koneksi, setelah fitur 4.4 jalan
`POST /self/channels/email/connect` hubungkan email sales

---

## 11. Daftar Layar untuk UX/UI

1. Dashboard utama, task list harian jadi panel utama, metrik agregat di bagian sekunder.
2. Inbox chat, per koneksi WhatsApp atau Email, dengan indikator status (AI handling, handover, human handling).
3. Modal konfirmasi lead, muncul begitu ada nomor baru.
4. Halaman daftar nomor diblokir, dengan aksi buka blokir.
5. Halaman pra daftar nomor lead.
6. Halaman antrian handover, dengan SLA countdown dan label alasan per item.
7. Halaman pengaturan persona, dengan pemilih koneksi kalau fitur 4.4 udah jalan.
8. Halaman koneksi, WhatsApp dan Email, dengan status connect atau disconnect.
9. Detail task follow up, expand dari dashboard, isinya histori chat singkat dan draft.

---

## 12. Urutan Prioritas Build yang Disaranin

1. Task list harian, ini paling langsung kerasa dampaknya ke workflow sales sehari hari.
2. Draft follow up klik kirim, karena task list ga ada gunanya kalau draftnya belum bisa dieksekusi.
3. Eskalasi SLA di antrian handover, biar client ga keabaian.
4. Persona per koneksi, karena kebutuhannya baru muncul kalau sales udah pegang lebih dari satu koneksi.
5. Kanal Email, ini yang paling besar scope nya karena butuh keputusan arsitektur (SMTP/IMAP vs API provider) sebelum mulai desain.
