#!/usr/bin/env bash
set -e

SOCKET_JS="node_modules/@whiskeysockets/baileys/lib/Socket/socket.js"

if [ ! -f "$SOCKET_JS" ]; then
    echo "[patch-baileys] socket.js not found, skipping"
    exit 0
fi

# Cek apakah patch udah pernah diapply
if grep -q 'data.byteLength <= 4' "$SOCKET_JS"; then
    echo "[patch-baileys] already patched"
    exit 0
fi

sed -i 's/const onMessageReceived = (data) => {/const onMessageReceived = (data) => {\n    if (data && (data.byteLength <= 4 || data.length <= 4)) { return; }/' "$SOCKET_JS"

echo "[patch-baileys] patched successfully"
