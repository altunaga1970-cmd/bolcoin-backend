#!/bin/bash

echo "🔧 Agregando red Hardhat Local a MetaMask..."
echo ""
echo "1. Abre MetaMask"
echo "2. Haz clic en el desplegable de redes (arriba)"
echo "3. Selecciona 'Agregar red'"
echo ""
echo "Datos de la red:"
echo "================="
echo "Nombre de la red: Hardhat Local"
echo "URL de RPC: http://127.0.0.1:8545"
echo "ID de cadena: 31337"
echo "Símbolo de moneda: ETH"
echo "================="
echo ""
echo "¡O puedes usar el botón 'Agregar Red Hardhat' en la dapp!"
echo ""
echo "Verificando que Hardhat esté corriendo..."

# Verificar que Hardhat esté corriendo
if curl -s -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' http://127.0.0.1:8545 > /dev/null; then
    echo "✅ Hardhat está corriendo en localhost:8545"
else
    echo "❌ Hardhat no está corriendo. Ejecuta: cd contracts && npm run node"
fi