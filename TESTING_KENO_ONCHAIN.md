# 🎮 TESTING KENO ON-CHAIN - LOCAL

## ✅ Estado Actual

**Contratos Desplegados en Hardhat Local:**
- **USDT Mock**: `0x5FbDB2315678afecb367f032d93F642f64180aa3`
- **VRF Coordinator**: `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`
- **KenoGame**: `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0`

**Configuración:**
- ✅ Backend `.env` configurado con `KENO_CONTRACT_ADDRESS`
- ✅ Frontend `.env` configurado con `VITE_KENO_CONTRACT_ADDRESS` y `VITE_KENO_MODE=onchain`
- ✅ ABI del contrato en `bolcoin-frontend/src/contracts/KenoGameABI.json`
- ✅ Hook `useKenoContract` listo para modo on-chain

---

## 🚀 INSTRUCCIONES DE TESTING

### Paso 1: Iniciar Hardhat Node (si no está corriendo)

```bash
cd contracts
npx hardhat node
```

**Importante**: El nodo debe estar corriendo en `http://127.0.0.1:8545`

---

### Paso 2: Configurar MetaMask

1. **Agregar Red Hardhat Local:**
   - Network Name: `Hardhat Local`
   - RPC URL: `http://127.0.0.1:8545`
   - Chain ID: `31337`
   - Currency Symbol: `ETH`

2. **Importar Wallet de Testing:**
   - Private Key: `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`
   - Esta wallet tiene 10000 ETH (mock) y es el owner del contrato

---

### Paso 3: Iniciar Backend

```bash
# En la raíz del proyecto
npm run dev
```

Esperar a que diga:
```
[Server] Listening on port 5000
[Keno] On-chain mode enabled
```

---

### Paso 4: Iniciar Frontend

```bash
cd bolcoin-frontend
npm run dev
```

Abrir: `http://localhost:5173`

---

### Paso 5: Probar Keno On-Chain

1. **Conectar Wallet:**
   - Click en "Connect Wallet"
   - Seleccionar MetaMask
   - Aprobar conexión

2. **Aprobar USDT:**
   - El hook automáticamente hace `approve()` del contrato Keno
   - Primera transacción: aprobar gasto de USDT

3. **Jugar Keno:**
   - Seleccionar 1-10 números (ej: 7, 14, 21, 35, 42)
   - Click en "Jugar"
   - Transacción `placeBet()` se envía al contrato
   - Esperar ~5-10 segundos (VRF mock es instantáneo)

4. **Ver Resultado:**
   - Si gana: muestra payout y nuevos números dibujados
   - Si pierde: muestra hits y mensaje de intento

---

## 🔍 VERIFICACIÓN DE FUNCIONAMIENTO

### Backend Logs

Deberías ver:
```
[Keno] On-chain mode enabled
[Keno] Contract initialized: 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
```

### Frontend Console

Deberías ver:
```
[Keno] On-chain placeBet with [7, 14, 21, 35, 42]
[Keno] BetPlaced: { betId: 1, vrfRequestId: 1 }
[Keno] BetResolved event received
```

### Hardhat Node Logs

Deberías ver:
```
eth_sendTransaction
  Contract call: KenoGame.placeBet([7, 14, 21, 35, 42])
  Transaction: 0x...
eth_call
  Contract call: KenoGame.bets(1)
```

---

## 🧪 CASOS DE PRUEBA

### Test 1: Apuesta Simple (5 números)
- **Números**: 7, 14, 21, 35, 42
- **Apuesta**: 1 USDT (automático)
- **Esperado**: 
  - Balance disminuye 1 USDT
  - VRF genera 20 números
  - Si 2+ hits → posible premio

### Test 2: Apuesta Máxima (10 números)
- **Números**: 1, 10, 20, 30, 40, 50, 60, 70, 75, 80
- **Apuesta**: 1 USDT
- **Esperado**:
  - Multiplicador más alto (10000x si 10 hits)
  - Max payout cap: 50 USDT (pool de 10000)

### Test 3: Balance Insuficiente
- **Preparación**: Gastar todo el USDT
- **Intentar jugar**: Debería fallar
- **Error esperado**: "Balance insuficiente"

### Test 4: Números Duplicados
- **Números**: 7, 7, 14 (inválido)
- **Esperado**: Error de validación antes de enviar tx

### Test 5: Fuera de Rango
- **Números**: 0, 81 (inválidos)
- **Esperado**: Error "Número fuera de rango (1-80)"

---

## 🛠️ DEBUGGING

### Verificar Contrato

```javascript
// En hardhat console o ethers.js
const keno = await ethers.getContractAt("KenoGame", "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0");

// Ver pool disponible
const pool = await keno.availablePool();
console.log("Pool:", ethers.formatUnits(pool, 6), "USDT");

// Ver apuesta
const bet = await keno.bets(1);
console.log("Bet 1:", bet);
```

### Verificar USDT

```javascript
const usdt = await ethers.getContractAt("MockERC20", "0x5FbDB2315678afecb367f032d93F642f64180aa3");

// Balance de tu wallet
const balance = await usdt.balanceOf("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
console.log("Balance:", ethers.formatUnits(balance, 6), "USDT");

// Allowance al contrato Keno
const allowance = await usdt.allowance(
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0"
);
console.log("Allowance:", ethers.formatUnits(allowance, 6), "USDT");
```

---

## 📊 ESTADÍSTICAS

### Pool Inicial
- **Balance**: 10,000 USDT
- **Max Payout**: 1,000 USDT (10% del pool)
- **Fee**: 12% de cada pérdida

### Jugador Inicial
- **Balance**: 100 USDT (mock)
- **Apuesta**: 1 USDT fija

---

## ⚠️ PROBLEMAS CONOCIDOS

### 1. Frontend no detecta on-chain
**Síntoma**: Hook `isOnChain` es `false`

**Solución**:
```bash
# Verificar .env del frontend
cat bolcoin-frontend/.env | grep KENO

# Debe decir:
VITE_KENO_CONTRACT_ADDRESS=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
VITE_KENO_MODE=onchain
```

### 2. Backend rechaza /api/keno/play
**Síntoma**: Error "Keno is in on-chain mode"

**Esto es CORRECTO** - En modo on-chain, el play es directo al contrato, no via API.

### 3. VRF timeout
**Síntoma**: "Timeout esperando resultado VRF"

**Causa**: VRF mock no está corriendo o hay problema de red

**Solución**:
```bash
# Reiniciar hardhat node
taskkill /F /IM node.exe
cd contracts
npx hardhat node
```

---

## 📝 NOTAS

### On-Chain vs Off-Chain

| Característica | On-Chain | Off-Chain |
|----------------|----------|-----------|
| **Juego** | Contrato `placeBet()` | API `/api/keno/play` |
| **Balance** | USDT en wallet | DB `users.balance` |
| **VRF** | Chainlink (mock en local) | SHA-256 backend |
| **Gas** | Sí (ETH mock) | No |
| **Velocidad** | ~10-30s | Instantáneo |
| **Custodia** | Non-custodial | Backend custodia |

### Producción

En producción (Polygon mainnet):
- Mismo flujo on-chain
- USDT real (no mock)
- Chainlink VRF real
- Gas en MATIC
- Pool real con fondos de usuarios

---

## ✅ CHECKLIST FINAL

- [ ] Hardhat Node corriendo
- [ ] MetaMask configurado con Hardhat Local
- [ ] Wallet importada con private key
- [ ] Backend iniciado (puerto 5000)
- [ ] Frontend iniciado (puerto 5173)
- [ ] Wallet conectada en frontend
- [ ] USDT aprobado al contrato
- [ ] Primera apuesta realizada
- [ ] Resultado mostrado correctamente

---

**Última actualización**: 2026-02-17  
**Estado**: ✅ Listo para testing
