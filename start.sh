#!/usr/bin/env bash
set -e

echo "==============================================================="
echo "         CINEGEN AI — Launching Production Server              "
echo "==============================================================="
echo ""

if [ ! -f ".env" ]; then
    echo "[Notice] .env file not found. Copying .env.example to .env ..."
    cp .env.example .env
fi

if [ ! -d ".next" ]; then
    echo "[Build] First-time setup detected. Running production build ..."
    npm run build
fi

echo "[2/2] Starting server at http://localhost:3000 ..."
npm run start
