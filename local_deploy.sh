#!/usr/bin/env bash
set -euo pipefail

if [ -n "${1:-}" ]; then
  VAULT_PATH="$1"
else
  read -rp "Path to your Obsidian vault: " VAULT_PATH
fi

# Expand ~ if present
VAULT_PATH="${VAULT_PATH/#\~/$HOME}"

if [ ! -d "$VAULT_PATH/.obsidian" ]; then
  echo "Error: $VAULT_PATH does not look like an Obsidian vault (no .obsidian directory)."
  exit 1
fi

PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/synology-link"
mkdir -p "$PLUGIN_DIR"

echo "Building..."
npm run build --silent

cp main.js manifest.json "$PLUGIN_DIR/"

echo "Deployed to $PLUGIN_DIR"
echo "Restart Obsidian or toggle the plugin off/on to reload."
