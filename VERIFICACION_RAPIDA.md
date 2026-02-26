# ⚡ VERIFICACIÓN RÁPIDA PRE-DEPLOYMENT

Sigue estos pasos en orden:

---

## 📍 PASO 1: Obtener tu BINGO_CONTRACT_ADDRESS

Ve a Railway Dashboard → Variables → Busca `BINGO_CONTRACT_ADDRESS`

Copia ese valor (debe empezar con `0x...`)

---

## 🔍 PASO 2: Ejecutar Verificación

```bash
cd contracts

# Reemplaza 0x... con tu dirección del contrato
BINGO_CONTRACT_ADDRESS=0x... npx hardhat run scripts/pre-deployment-check.js --network amoy
```

Este script verificará:
- ✅ Que el contrato existe y responde
- ✅ Cuál es la dirección del operator
- ✅ Si hay rounds huérfanas
- ✅ Configuración de VRF

---

## 📊 INTERPRETACIÓN DE RESULTADOS

### ✅ Si todo está bien:

```
✅ ALL CHECKS PASSED

Ready to deploy!
```

**→ Continúa al PASO 3 (deployment)**

### ❌ Si hay orphan rounds:

```
❌ Found 4 orphan rounds
```

**Fix:**
```bash
npx hardhat run scripts/emergency-cancel-rounds.js --network amoy
```

Luego **vuelve a ejecutar el PASO 2**

### ❌ Si hay operator mismatch:

```
❌ OPERATOR MISMATCH!
Contract operator: 0xAAA...
Your wallet:       0xBBB...
```

**Significa:** La OPERATOR_PRIVATE_KEY que vas a usar no coincide.

**Fix:** Necesitas usar la private key del wallet `0xAAA...`

---

## 🚀 PASO 3: Configurar Railway

Una vez que el check pase ✅, abre:

📄 **`RAILWAY_VARIABLES.txt`** → Tiene la lista completa de variables

📖 **`GUIA_DEPLOYMENT_RAILWAY.md`** → Guía paso a paso

---

## 📝 RESUMEN DE VARIABLES MÍNIMAS

```bash
# 1. Ya la tienes ✅
BINGO_CONTRACT_ADDRESS=0x...

# 2. Tu RPC de Alchemy/Infura
RPC_URL=https://polygon-amoy.g.alchemy.com/v2/TU_KEY

# 3. Private key del operator (del check del PASO 2)
OPERATOR_PRIVATE_KEY=0x...

# 4. Habilitar scheduler
ENABLE_BINGO_SCHEDULER=true
```

---

## ⚡ DEPLOYMENT RÁPIDO

1. Railway Dashboard → Variables → Raw Editor
2. Pega las 4 variables de arriba
3. Save
4. Railway redeploy automáticamente
5. Ver logs (debe decir "Scheduler corriendo...")

---

## 🆘 SI NO TIENES LA CONTRACT ADDRESS

Si no encuentras `BINGO_CONTRACT_ADDRESS` en Railway:

**Opción A: Buscar en deployment anterior**

```bash
# Buscar en archivos
grep -r "0x" contracts/ --include="*.txt" --include="*.md"

# O revisar scripts de deployment
cat contracts/scripts/deploy-bingo-amoy.js
```

**Opción B: Deployar nuevo contrato**

```bash
cd contracts

# Configurar .env primero
cp .env.example .env
# Editar .env y agregar:
# - DEPLOYER_KEY
# - PAYMENT_TOKEN_ADDRESS (USDT testnet)
# - VRF_SUBSCRIPTION_ID

# Deploy
npx hardhat run scripts/deploy-bingo-amoy.js --network amoy
```

---

**¿Cuál es tu BINGO_CONTRACT_ADDRESS?**

Necesito ese valor para continuar con la verificación.
