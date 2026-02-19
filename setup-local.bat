#!/bin/bash
# ===========================================
# SETUP LOCAL - Bolcoin dApp
# ===========================================
# Este script despliega contratos y configura el entorno local
# ===========================================

set -e

echo "=== BOLCOIN LOCAL SETUP ==="
echo ""

# 1. Iniciar nodo Hardhat en background
echo "[1/5] Iniciando Hardhat Node..."
cd contracts
npx hardhat node > ../hardhat.log 2>&1 &
HARDHAT_PID=$!
echo "      Hardhat Node PID: $HARDHAT_PID"
sleep 3

# 2. Desplegar contratos
echo ""
echo "[2/5] Desplegando contratos..."
npx hardhat run scripts/deploy-local.js --network localhost | tee ../deploy-output.log

# 3. Extraer direcciones del output
echo ""
echo "[3/5] Extrayendo direcciones de contratos..."
# (Se hace manualmente mirando deploy-output.log)

# 4. Volver al root
cd ..

echo ""
echo "=== SETUP COMPLETADO ==="
echo ""
echo "📝 DIRECCIONES DE CONTRATOS:"
echo "   Mirar deploy-output.log"
echo ""
echo "🔧 CONFIGURACIÓN:"
echo "   1. Copiar direcciones a .env (backend)"
echo "   2. Copiar direcciones a bolcoin-frontend/.env"
echo "   3. Reiniciar backend: npm run dev"
echo "   4. Iniciar frontend: cd bolcoin-frontend && npm run dev"
echo ""
echo "💰 WALLETS DE TESTING (Hardhat):"
echo "   Account #0: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
echo "   Private Key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
echo "   Balance: 10000 ETH (mock)"
echo ""
echo "🎮 PROBAR KENO:"
echo "   1. Abrir http://localhost:5173"
echo "   2. Conectar MetaMask a Hardhat Local (Chain ID 31337)"
echo "   3. Importar wallet con private key de arriba"
echo "   4. Aprobar USDT (mock token)"
echo "   5. Jugar Keno!"
echo ""
echo "📖 Para más detalles, ver SETUP_LOCAL.md"
echo ""

# Mantener Hardhat corriendo
echo "Hardhat Node corriendo (PID: $HARDHAT_PID)"
echo "Para detener: taskkill /F /T /PID $HARDHAT_PID"
