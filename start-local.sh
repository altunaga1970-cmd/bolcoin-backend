#!/bin/bash
# ============================================
# Keno Local Test Environment
# ============================================
# Starts backend (port 5000) + frontend (port 3000)
# Auto-funds $100 USDT on wallet connect
# Pool starts at $500 (max payout $50)
#
# Usage: bash start-local.sh
# ============================================

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

echo "============================================"
echo "  Keno Local Test Environment"
echo "============================================"
echo ""

# 1. Check PostgreSQL
echo "[1/5] Checking PostgreSQL..."
if command -v pg_isready &> /dev/null; then
  pg_isready -h localhost -p 5432 -q && echo "  PostgreSQL is running" || echo "  WARNING: PostgreSQL may not be running"
else
  echo "  pg_isready not found, skipping check"
fi

# 2. Install deps if needed
echo "[2/5] Checking dependencies..."
if [ ! -d "node_modules" ]; then
  echo "  Installing backend deps..."
  npm install
fi
if [ ! -d "bolcoin-frontend/node_modules" ]; then
  echo "  Installing frontend deps..."
  cd bolcoin-frontend && npm install && cd ..
fi
echo "  Dependencies OK"

# 3. Run DB migrations
echo "[3/5] Running database migrations..."
npm run db:init 2>&1 | tail -5
echo "  Migrations done"

# 4. Start backend
echo "[4/5] Starting backend (port 5000)..."
npm run dev > /tmp/keno-backend.log 2>&1 &
BACKEND_PID=$!
echo "  Backend PID: $BACKEND_PID"

# Wait for backend to be ready
echo "  Waiting for backend..."
for i in $(seq 1 15); do
  if curl -s http://localhost:5000/health > /dev/null 2>&1; then
    echo "  Backend ready!"
    break
  fi
  sleep 1
done

# 5. Start frontend
echo "[5/5] Starting frontend (port 3000)..."
cd bolcoin-frontend && npm run dev > /tmp/keno-frontend.log 2>&1 &
FRONTEND_PID=$!
cd ..
echo "  Frontend PID: $FRONTEND_PID"

sleep 3

echo ""
echo "============================================"
echo "  LOCAL TEST READY"
echo "============================================"
echo ""
echo "  Frontend:  http://localhost:3000"
echo "  Backend:   http://localhost:5000"
echo "  Health:    http://localhost:5000/health"
echo ""
echo "  HOW TO TEST:"
echo "  1. Open http://localhost:3000"
echo "  2. Connect MetaMask (any account)"
echo "  3. You get \$100 USDT automatically"
echo "  4. Play Keno! Watch the pool balance change"
echo ""
echo "  DEV ENDPOINTS:"
echo "  curl -X POST http://localhost:5000/api/dev/set-pool -H 'Content-Type: application/json' -d '{\"balance\": 5000}'"
echo "  curl -X POST http://localhost:5000/api/dev/give-balance -H 'Content-Type: application/json' -d '{\"address\": \"0x...\", \"amount\": 500}'"
echo ""
echo "  LOGS:"
echo "  tail -f /tmp/keno-backend.log"
echo "  tail -f /tmp/keno-frontend.log"
echo ""
echo "  Press Ctrl+C to stop both servers"
echo ""

# Cleanup on exit
cleanup() {
  echo ""
  echo "Stopping servers..."
  kill $BACKEND_PID 2>/dev/null
  kill $FRONTEND_PID 2>/dev/null
  echo "Done."
}
trap cleanup EXIT INT TERM

# Keep running
wait
