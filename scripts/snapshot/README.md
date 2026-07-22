# Snapshot dev — pindah laptop tanpa kehilangan data

Script untuk memindahkan **semua** data dev lokal (database, media, config) ke
laptop lain, hasilnya identik termasuk akun dan sesi WhatsApp.

> Folder `snapshot/` sudah di-gitignore. **Jangan commit isinya** — berisi data
> pelanggan asli + secret (password akun, API key, nomor WA). Pindahkan folder
> `snapshot/` secara manual (USB / cloud pribadi) ke laptop baru.

## Yang ikut dipindah

| Artefak | Isi |
| --- | --- |
| `db.dump` | Seluruh Postgres: akun (semua role), kontak, deal, pesan WA, tasks, sesi Baileys, dll. Format custom `-Fc` (terkompresi). |
| `media.tar.gz` | Isi volume MinIO: foto profil, media WhatsApp, file upload. |
| `env/.env`, `env/.env.local` | Config + secret. **Wajib sama** agar sesi login & WA tetap valid (lihat catatan di bawah). |

Redis sengaja **tidak** ikut (isinya transient: queue, presence, cache).

## Sesi WhatsApp tetap jalan?

Ya. Di mode dev (`NODE_ENV=development`) `BAILEYS_AUTH_ENCRYPTION_KEY` tidak
diset, sehingga `baileys_sessions.auth_state` disimpan plaintext. Jadi dump
bisa dibaca langsung di laptop baru tanpa key. Sesuai codingan di
`whatsapp-service/src/runtime.ts` (`authEncryptionKey()`).

## Pakai

### Di laptop lama (export)

```bash
bun run dev:services        # pastikan postgres + minio hidup
bun run snapshot:dump
```

Hasil ada di `snapshot/`. Pindahkan folder itu ke laptop baru.

### Di laptop baru (import)

```bash
git clone <repo> && cd CRM && bun install
# taruh folder snapshot/ di root repo
bun run dev:services        # nyalakan postgres + minio (crm-postgres-1:5431)
# HENTIKAN backend/worker kalau ada yang jalan
```

**PENTING — soal port database:** script restore menulis ke DB yang ditunjuk
`DATABASE_URL` di `.env`. Snapshot membawa `.env` dari laptop lama, dan di situ
`DATABASE_URL` bisa menunjuk ke port yang **berbeda** (mis. laptop lama memakai
postgres container lain di port `5433`). Sebelum restore, periksa & sesuaikan
`DATABASE_URL` di `.env` agar menunjuk ke postgres yang aktif di laptop baru
ini — biasanya port `5431` untuk `crm-postgres-1`:

```
DATABASE_URL=postgresql://crm:2l8xHHcw0Wai4Qn01C7hbLkaM_vbctog@localhost:5431/crm_db
```

Lalu:

```bash
bun run snapshot:restore    # ada konfirmasi sebelum menimpa
bun run db:generate         # regenerasi Prisma client
bun run dev
```

`restore.sh` akan meminta konfirmasi `[ketik 'ya']` dan menampilkan URL target
(password disembunyikan) sebelum menghapus — kalau salah, Ctrl-C, perbaiki
`.env`, jalankan lagi. Lewati konfirmasi dengan `SNAPSHOT_YES=1`.

## Catatan

- `restore.sh` **menghapus schema public & mengganti media** — hanya untuk
  dev lokal. Jangan dijalankan di production.
- Saat restore, hentikan dulu backend/worker yang terkoneksi ke DB agar tidak
  bentrok.
- Kalau setelah restore akun "seperti logout", itu normal bila `SESSION_SECRET`
  / `JWT_SECRET` berbeda — tinggal login ulang. Karena `.env` ikut di-restore,
  secret seharusnya sama jadi sesi tetap valid.
