#!/usr/bin/env bash
set -e

SOCKET_JS="node_modules/@whiskeysockets/baileys/lib/Socket/socket.js"

if [ ! -f "$SOCKET_JS" ]; then
    echo "[patch-baileys] socket.js not found, skipping"
    exit 0
fi

# Cek apakah patch udah pernah diapply
if grep -q 'DICT_VERSION_PATCHED' "$SOCKET_JS"; then
    echo "[patch-baileys] already patched"
    exit 0
fi

# Fix 1: DICT_VERSION harus 3 (bukan 2) biar cocok sama WA server
DEFAULTS_JS="node_modules/@whiskeysockets/baileys/lib/Defaults/index.js"
sed -i 's/exports.DICT_VERSION = 2/exports.DICT_VERSION = 3/' "$DEFAULTS_JS"

# Fix 2: skip pesan pendek (<=4 byte) di onMessageReceived
sed -i 's/const onMessageReceived = (data) => {/const onMessageReceived = (data) => {\n    if (data && (data.byteLength <= 4 || data.length <= 4)) { return; }/' "$SOCKET_JS"

echo "// DICT_VERSION_PATCHED" >> "$DEFAULTS_JS"
echo "[patch-baileys] patched successfully"
