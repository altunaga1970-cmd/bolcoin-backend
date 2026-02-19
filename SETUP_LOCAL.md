# ===========================================
# BOLCOIN - Local Development (.env)
# ===========================================
# ESTE ARCHIVO ES PARA TESTING LOCAL CON HARDHAT
# NO COMMITIR A GIT

# ===========================================
# BACKEND (.env en root)
# ===========================================
NODE_ENV=development
PORT=5000
API_BASE_URL=http://localhost:5000

# PostgreSQL Local
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/labolita
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10

# SIWE Admin
SIWE_DOMAIN=localhost
ADMIN_WALLETS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
SESSION_SECRET=local-dev-secret-key-not-for-production
ADMIN_SESSION_DURATION=8h

# Blockchain - Local Hardhat
RPC_URL=http://127.0.0.1:8545
CHAIN_ID=31337

# Contract addresses (se actualizan con deploy-local)
CONTRACT_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3
TOKEN_ADDRESS=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512

# Operator key (de hardhat accounts[0])
OPERATOR_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# VRF Mock (local)
VRF_COORDINATOR=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
VRF_SUBSCRIPTION_ID=1
VRF_KEY_HASH=0x0000000000000000000000000000000000000000000000000000000000000000

# CORS
FRONTEND_URL=http://localhost:5173
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000

# Rate Limiting (relajado para testing)
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=1000

# Game Settings
MAX_BET_AMOUNT=1000
MIN_BET_AMOUNT=1
TICKET_PRICE=1

# Scheduler (deshabilitado en local)
ENABLE_SCHEDULER=false

# Security
ENABLE_HELMET=true
ENABLE_GEOBLOCK=false
TRUST_PROXY=0

# Logging
LOG_LEVEL=debug
LOG_SQL_QUERIES=false

# ===========================================
# FRONTEND (bolcoin-frontend/.env)
# ===========================================
VITE_API_URL=http://localhost:5000/api

# Hardhat Local
VITE_CHAIN_ID=31337
VITE_CONTRACT_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3
VITE_TOKEN_ADDRESS=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512

# WalletConnect (no necesario en local, solo MetaMask)
VITE_WALLETCONNECT_PROJECT_ID=

# Debug
VITE_ENABLE_GEOBLOCK=false
VITE_DEBUG=true
