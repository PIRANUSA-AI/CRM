#!/usr/bin/env bash
#
# Restore snapshot dev (Postgres + media MinIO + .env) yang dibuat dump.sh,
# di laptop baru. Hasilnya identik dengan mesin asal — termasuk akun & sesi WA.
#
#   bash scripts/snapshot/restore.sh
#
# DB restore otomatis mengikuti DATABASE_URL di .env. Jadi:
#   - kalau di laptop baru kamu pakai postgres dari compose proyek ini
#     (crm-postgres-1, port 5431), pastikan DATABASE_URL di .env menunjuk ke
#     situ SEBELUM restore;
#   - atau biarkan DATABASE_URL sama persis (ikuti snapshot/env/.env).
#
# Prasyarat di laptop baru:
#   1. repo sudah di-clone & bun install
#   2. folder snapshot/ (hasil dump.sh) sudah ditaruh di root repo
#   3. postgres bisa di-reach sesuai DATABASE_URL (container hidup / tunnel on)
#   4. HENTIKAN backend/worker yang jalan dulu (bebaskan koneksi DB)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SRC_DIR="$REPO_ROOT/snapshot"

MINIO_VOLUME="${MINIO_VOLUME:-crm_crm_minio_data}"
PG_IMAGE="${PG_IMAGE:-pgvector/pgvector:pg17}"

cd "$REPO_ROOT"

if [ ! -f "$SRC_DIR/db.dump" ]; then
	echo "ERROR: $SRC_DIR/db.dump tidak ditemukan."
	echo "Taruh folder snapshot/ (hasil dump.sh) di root repo dulu."
	exit 1
fi

# ---------------------------------------------------------------------------
# 1) Env lokal — kembalikan dulu supaya DATABASE_URL & secret sesuai mesin asal.
#    Yang sudah ada diamankan ke *.bak.<timestamp>.
# ---------------------------------------------------------------------------
echo "==> Mengembalikan .env lokal ..."
for f in .env .env.local; do
	if [ -f "$SRC_DIR/env/$f" ]; then
		if [ -f "$REPO_ROOT/$f" ] && ! diff -q "$SRC_DIR/env/$f" "$REPO_ROOT/$f" >/dev/null 2>&1; then
			cp "$REPO_ROOT/$f" "$REPO_ROOT/$f.bak.$(date +%s)"
			echo "    ($f berbeda — yang lama disimpan ke $f.bak.*)"
		fi
		cp "$SRC_DIR/env/$f" "$REPO_ROOT/$f"
		echo "    -> $f"
	fi
done

# --- ambil DATABASE_URL dari .env yang baru direstore ---
DATABASE_URL="$(grep -E '^DATABASE_URL=' "$REPO_ROOT/.env" | tail -1 | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//; s/^'\''//; s/'\''$//')"
if [ -z "$DATABASE_URL" ]; then
	echo "ERROR: DATABASE_URL belum diset di .env"
	exit 1
fi
SAFE_URL="$(printf '%s' "$DATABASE_URL" | sed -E 's#(://[^:]+:)[^@]+@#\1****@#')"
echo "==> DB target (dari DATABASE_URL): $SAFE_URL"

# ---------------------------------------------------------------------------
# 1.5) Konfirmasi sebelum menghapus. Di laptop baru, postgres mungkin di port
#      lain (mis. 5431 untuk crm-postgres-1 dari compose proyek ini). Kalau
#      target di atas salah, Ctrl-C, perbaiki DATABASE_URL di .env, lalu re-run.
# ---------------------------------------------------------------------------
echo ""
echo "PERINGATAN: restore akan DROP SCHEMA public & menimpa SEMUA data di DB itu."
if [ "${SNAPSHOT_YES:-0}" != "1" ]; then
	read -r -p "Lanjutkan restore ke $SAFE_URL ? [ketik 'ya'] " ans
	if [ "$ans" != "ya" ]; then
		echo "Dibatalkan."
		exit 1
	fi
fi

# ---------------------------------------------------------------------------
# 2) Postgres — drop schema public lalu restore utuh. --exit-on-error memastikan
#    berhenti kalau ada yang gagal (tidak setengah-jadi).
#    Catatan: connect backend harus dihentikan dulu (prasyarat #4).
# ---------------------------------------------------------------------------
echo "==> Drop & recreate schema public ..."
docker run --rm --network=host "$PG_IMAGE" \
	psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
	-c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'

echo "==> Restore Postgres dari snapshot/db.dump ..."
docker run --rm --network=host \
	-v "${SRC_DIR}:/import" \
	"$PG_IMAGE" \
	pg_restore --dbname="$DATABASE_URL" --no-owner --no-privileges --exit-on-error /import/db.dump
echo "    -> Postgres selesai"

# ---------------------------------------------------------------------------
# 3) Media MinIO — ekstrak tar ke volume. Bersihkan dulu biar tidak nyampur
#    dengan file lama di laptop baru.
# ---------------------------------------------------------------------------
echo "==> Restore media MinIO ke volume $MINIO_VOLUME ..."
if [ ! -f "$SRC_DIR/media.tar.gz" ]; then
	echo "    (snapshot/media.tar.gz tidak ada — dilewati)"
elif ! docker volume inspect "$MINIO_VOLUME" >/dev/null 2>&1; then
	echo "WARN: volume $MINIO_VOLUME tidak ditemukan — media dilewati."
	echo "      (jalankan: bun run dev:services)"
else
	docker run --rm \
		-v "${MINIO_VOLUME}:/data" \
		-v "${SRC_DIR}:/import" \
		alpine \
		sh -c 'rm -rf /data/* /data/.[!.]* 2>/dev/null; tar xzf /import/media.tar.gz -C /data'
	echo "    -> media selesai"
fi

echo ""
echo "Restore selesai."
echo "Langkah berikutnya:"
echo "  1. bun run db:generate    # regenerasi Prisma client"
echo "  2. bun run dev            # nyalakan backend + frontend"
echo "  3. login pakai akun yang sama — data harus identik dengan laptop lama."
