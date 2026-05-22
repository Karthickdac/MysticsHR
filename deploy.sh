#!/usr/bin/env bash
# Deploy MysticsHR on the VPS.
# Run from anywhere — the script cd's to the project root.
set -euo pipefail

PROJECT_DIR="/home/automystics-mysticshr/htdocs/mysticshr.automystics.tech"
BRANCH="${BRANCH:-main}"

cd "$PROJECT_DIR"

echo "==> Pulling latest from origin/$BRANCH"
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "==> Installing dependencies (pnpm)"
pnpm install --frozen-lockfile

echo "==> Regenerating API client from OpenAPI spec"
pnpm --filter @workspace/api-spec run codegen

echo "==> Building all packages and artifacts"
pnpm -r build

echo "==> Restarting services"
# Adjust the names below to match how you run the api-server and web app.
# Examples for the common process managers — uncomment whichever you use.

# --- pm2 ---
# pm2 restart mysticshr-api mysticshr-web
# pm2 save

# --- systemd ---
# sudo systemctl restart mysticshr-api.service
# sudo systemctl restart mysticshr-web.service

echo "==> Done. Verify the api-server and web app are up."
