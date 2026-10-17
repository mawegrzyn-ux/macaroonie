#!/usr/bin/env bash
# scripts/ensure-secrets-key.sh <path to api/.env>
#
# Run by every deploy, before the API restarts. The API seals stored
# integration keys (Anthropic, Loyverse, GloriaFood, email providers) with
# SECRETS_KEY (api/src/services/vault.js, migration 179) and won't start in
# production without it. If the .env has no SECRETS_KEY line, this adds one:
# 32 random bytes, base64. An existing key is never changed: a new one would
# make every stored key unreadable.
#
# Back the .env up with the key in it. Without the key the stored keys have
# to be typed in again.

set -euo pipefail

ENV_FILE="${1:?usage: ensure-secrets-key.sh <path to api/.env>}"
[[ -f "$ENV_FILE" ]] || { echo "✗ $ENV_FILE not found"; exit 1; }

if grep -Eq '^[[:space:]]*SECRETS_KEY=.+' "$ENV_FILE"; then
  echo "✓ SECRETS_KEY already set"
  exit 0
fi

KEY=$(head -c 32 /dev/urandom | base64 | tr -d '\n')
# A newline first if the file doesn't end with one.
[[ -s "$ENV_FILE" && $(tail -c 1 "$ENV_FILE" | wc -l) -eq 0 ]] && echo >> "$ENV_FILE"
{
  echo ""
  echo "# Seals stored integration keys (migration 179). Added by the deploy on $(date -u +%Y-%m-%d)."
  echo "# Keep it with this file's backup: without it the stored keys can't be read."
  echo "SECRETS_KEY=$KEY"
} >> "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "✓ SECRETS_KEY added to $ENV_FILE: back this file up"
