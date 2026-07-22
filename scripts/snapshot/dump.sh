#!/usr/bin/env bash
#
# Export SEMUA data dev lokal (Postgres + media MinIO + .env) ke ./snapshot/
# supaya bisa dipindah utuh ke laptop lain. Hasilnya identik, termasuk akun
# dan sesi WhatsApp.
#
#   bash scripts/snapshot/dump.sh
#
# DB yang didump otomatis mengikuti DATABASE_URL di .env (jadi selalu tepat
# sasaran, walau DB-nya tinggal di container lain). pg_dump dipakai dari
# container pgvector/pgvector:pg17 supaya versinya cocok dengan server.
#
# File artifact ditulis ke ./snapshot/ yang SUDAH di-gitignore. JANGAN commit
# isinya — berisi data pelanggan asli + secret. Pindahkan folder snapshot/
# secara manual (USB / cloud pribadi) ke laptop baru.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="$REPO_ROOT/snapshot"

MINIO_VOLUME="${MINIO_VOLUME:-crm_crm_minio_data}"
PG_IMAGE="${PG_IMAGE:-pgvector/pgvector:pg17}"

cd "$REPO_ROOT"

# --- ambil DATABASE_URL dari .env (sumber kebenaran lokasi DB) ---
if [ ! -f "$REPO_ROOT/.env" ]; then
	echo "ERROR: .env tidak ditemukan di $REPO_ROOT"
	exit 1
fi
DATABASE_URL="$(grep -E '^DATABASE_URL=' "$REPO_ROOT/.env" | tail -1 | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//; s/^'\''//; s/'\''$//')"
if [ -z "$DATABASE_URL" ]; then
	echo "ERROR: DATABASE_URL belum diset di .env"
	exit 1
fi
# sembunyikan password saat dicetak
SAFE_URL="$(printf '%s' "$DATABASE_URL" | sed -E 's#(://[^:]+:)[^@]+@#\1****@#')"
echo "==> DB target (dari DATABASE_URL): $SAFE_URL"

echo "==> Menyiapkan folder output: snapshot/"
mkdir -p "$OUT_DIR/env"

# ---------------------------------------------------------------------------
# 1) Postgres — pg_dump dari container pg17 (versi harus sama/morebaru server).
#    --network=host agar container bisa reach localhost. -Fc = custom format
#    (terkompresi, bisa pg_restore selektif).
# ---------------------------------------------------------------------------
echo "==> Dump Postgres ..."
docker run --rm --network=host \
	-v "${OUT_DIR}:/out" \
	"$PG_IMAGE" \
	pg_dump "$DATABASE_URL" -Fc --no-owner --no-privileges -f /out/db.dump
echo "    -> snapshot/db.dump  ($(du -h "$OUT_DIR/db.dump" | cut -f1))"

# ---------------------------------------------------------------------------
# 2) Media MinIO — tar seluruh volume docker. Menyalin persis (foto profil,
#    media WA, upload). Tidak butuh mc/network.
# ---------------------------------------------------------------------------
echo "==> Dump media MinIO dari volume $MINIO_VOLUME ..."
if ! docker volume inspect "$MINIO_VOLUME" >/dev/null 2>&1; then
	echo "WARN: volume $MINIO_VOLUME tidak ditemukan — media dilewati."
else
	docker run --rm \
		-v "${MINIO_VOLUME}:/data:ro" \
		-v "${OUT_DIR}:/export" \
		alpine \
		tar czf /export/media.tar.gz -C /data .
	echo "    -> snapshot/media.tar.gz  ($(du -h "$OUT_DIR/media.tar.gz" | cut -f1))"
fi

# ---------------------------------------------------------------------------
# 3) Env lokal — .env & .env.local berisi secret + config yang HARUS sama di
#    laptop baru (DATABASE_URL, SESSION_SECRET, JWT_SECRET, dll).
# ---------------------------------------------------------------------------
echo "==> Menyalin .env lokal ..."
for f in .env .env.local; do
	if [ -f "$REPO_ROOT/$f" ]; then
		cp "$REPO_ROOT/$f" "$OUT_DIR/env/$f"
		echo "    -> snapshot/env/$f"
	else
		echo "    ($f tidak ada, dilewati)"
	fi
done

cat > "$OUT_DIR/MANIFEST.txt" <<EOF
CRM dev snapshot
Dibuat: $(date -u '+%Y-%m-%d %H:%M:%S UTC')
Mesin:  $(hostname)
DB:     $SAFE_URL

Isi:
  db.dump        — Postgres custom-format dump (semua data: akun, kontak,
                   percakapan, pesan, sesi Baileys, dll)
  media.tar.gz   — isi volume MinIO (foto profil, media WhatsApp, upload)
  env/.env       — config + secret lokal (JANGAN di-commit)
  env/.env.local — override lokal (kalau ada)

Restore di laptop baru: bash scripts/snapshot/restore.sh
EOF

echo ""
echo "Selesai. Snapshot ada di: $OUT_DIR"
echo ""
echo "PENTING: folder snapshot/ sudah di-gitignore. Pindahkan isinya ke laptop"
echo "baru secara manual (USB / cloud pribadi) — jangan di-commit ke git."
