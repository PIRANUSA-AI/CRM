#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🚀 Starting CRM WhatsApp Service..."

if ! command -v bun >/dev/null 2>&1; then
	echo "❌ Bun is not installed."
	exit 1
fi

if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
	echo "📦 Installing dependencies..."
	cd "$SCRIPT_DIR" && bun install
fi

cd "$SCRIPT_DIR"
bun run dev
