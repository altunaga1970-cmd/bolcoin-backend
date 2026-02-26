# GUÍA COMPLETA DE PRODUCCIÓN — CONTRATOS BOLCOIN
## Auditoría y Despliegue Mainnet Polygon

**Versión**: 1.0 — 2026-02-26
**Dirigida a**: Propietario del proyecto (sin conocimiento técnico)
**Nivel de detalle**: Cada paso explicado, sin dar nada por supuesto

---

## TUS WALLETS — ROLES EN EL PROYECTO

Antes de empezar, confirma que tienes estas 4 wallets y guarda sus direcciones (0x...) de forma segura:

| Wallet | Rol | Para qué se usa |
|--------|-----|-----------------|
| **Personal** | Owner de contratos | Desplegar contratos, hacer cambios admin, retirar fees |
| **Admin** | Operador backend | El backend (Railway) firma transacciones automáticas |
| **Tesorería** | Receptor de fees | Aquí van las comisiones de los juegos |
| **Contrato** | Fondo inicial | Para fondear los pools de premios al inicio |

> ⚠️ **REGLA DE ORO**: La **Private Key** de la wallet **Admin** es la que va en Railway (`OPERATOR_PRIVATE_KEY`). NUNCA pongas la de tu wallet Personal en Railway.

---

## AUDITORÍA DE CONTRATOS — LO QUE ENCONTRÉ

### Estado actual de cada juego

| Juego | Estado Contrato | Seguridad | Listo para Prod |
|-------|----------------|-----------|-----------------|
| **Keno** | Desplegado (sin VRF real aún) | ✅ Sólido | ⚠️ Falta activar VRF |
| **Bingo** | Off-chain scheduler activo | ✅ Sólido | ⚠️ Falta contrato mainnet |
| **La Bolita** | Bug corregido en código | ⚠️ Requiere redeploy | ❌ Pausar y redesplegar |
| **La Fortuna** | Solo frontend parcial | N/A | ❌ Sin contrato |

### Problemas críticos encontrados (ya corregidos en código)

1. **La Bolita — `retryUnpaidBet` bug**: Un usuario podía llamar esta función múltiples veces y drenar el pool. **Fix aplicado** en `LaBolitaGame.sol:484` — `b.payout = 0` antes del transfer. **REQUIERE REDEPLOY del contrato**.

2. **Inconsistencia de direcciones VRF (Amoy testnet)**: Dos scripts usaban direcciones diferentes. Corregido en esta guía.

3. **OPERATOR_PRIVATE_KEY en Railway**: Debe ser la wallet Admin, no la personal.

---

## ARQUITECTURA DE FEES (cómo fluye el dinero)

```
KENO:
  Usuario paga 1 USDT por apuesta
  Si PIERDE: fee = 12% de la pérdida → va a accruedFees (en contrato)
  Si GANA: sin fee
  Retiro fees → tu wallet Tesorería

BINGO:
  Usuario paga 1 USDT por cartón
  Fee = 10% del total recaudado → accruedFees
  Reserve = 10% → jackpotBalance
  Winner pot = 80% → ganadores (15% línea + 85% bingo)
  Si no hay ganadores: 90% del total → jackpot
  Retiro fees → tu wallet Tesorería

LA BOLITA:
  Fee = 5% en TODAS las apuestas (se cobra al apostar)
  Ganadores cobran: (apuesta - fee) × multiplicador
  Retiro fees → tu wallet Tesorería

MULTIPLICADORES LA BOLITA:
  Fijo (2 dígitos): 65x
  Centena (3 dígitos): 300x
  Parle (4 dígitos): 1000x
```

---

## FASE 1: PREPARACIÓN (hacer antes de todo)

### 1.1 Herramientas necesarias

Instala en tu ordenador:
1. **Node.js 20+**: https://nodejs.org (descargar versión LTS)
2. **Git**: ya lo tienes (tienes el proyecto)
3. **MetaMask**: extensión del navegador Chrome

### 1.2 Configurar MetaMask con Polygon Mainnet

En MetaMask → Configuración → Redes → Agregar red → Agregar manualmente:

```
Nombre de red: Polygon Mainnet
URL RPC: https://polygon-bor-rpc.publicnode.com
Chain ID: 137
Símbolo: POL (antes MATIC)
Explorador: https://polygonscan.com
```

### 1.3 Lo que necesitas tener antes de desplegar en mainnet

Necesitas tener en tu **wallet Personal** (la que hace de Owner):

| Recurso | Cantidad mínima | Para qué |
|---------|----------------|----------|
| **POL (MATIC)** | 5 POL | Gas de despliegue de 3 contratos (~1.5 POL cada uno) |
| **LINK** | 20 LINK | Financiar suscripción Chainlink VRF |
| **USDT (Polygon)** | 500 USDT | Fondear pools iniciales (Keno: 100, Bingo: 200, Bolita: 200) |

> 📍 Compra LINK en Polygon en Uniswap o cualquier DEX. LINK en Polygon: `0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39`

### 1.4 Crear cuenta en servicios externos

1. **Alchemy** (RPC profesional): https://www.alchemy.com
   - Crear app → Network: Polygon Mainnet → copiar HTTPS URL
   - También crear app para Polygon Amoy (testnet)

2. **Polygonscan API Key** (verificar contratos): https://polygonscan.com/myapikey
   - Crear cuenta → My API Keys → Add

3. **Chainlink VRF**: https://vrf.chain.link
   - Conectar con tu wallet Personal

---

## FASE 2: TESTNET AMOY (practicar primero)

> ⚠️ **MUY IMPORTANTE**: Siempre prueba en testnet antes de mainnet. Aquí los errores no cuestan dinero real.

### 2.1 Agregar Polygon Amoy a MetaMask

```
Nombre de red: Polygon Amoy Testnet
URL RPC: https://rpc-amoy.polygon.technology
Chain ID: 80002
Símbolo: POL
Explorador: https://amoy.polygonscan.com
```

### 2.2 Conseguir tokens de prueba

1. **POL de prueba**: https://faucet.polygon.technology
   - Conectar wallet, seleccionar Amoy, pedir tokens

2. **LINK de prueba**: https://faucets.chain.link/polygon-amoy
   - Necesitas POL de prueba primero

### 2.3 Crear suscripción VRF en Amoy

1. Ir a: https://vrf.chain.link/amoy
2. Conectar MetaMask con wallet Personal (en red Amoy)
3. Click "Create Subscription"
4. Confirmar transacción en MetaMask
5. **GUARDAR EL SUBSCRIPTION ID** — lo necesitarás para desplegar contratos
6. Click "Fund subscription" → depositar 5 LINK de prueba

### 2.4 Preparar el entorno de desarrollo

Abre una terminal en la carpeta `contracts/`:

```bash
# Instalar dependencias
cd contracts
npm install

# Crear archivo de configuración
cp .env.example .env
```

Edita el archivo `contracts/.env`:

```bash
# Red de prueba (Amoy)
AMOY_RPC_URL=https://rpc-amoy.polygon.technology
# O mejor, usa tu URL de Alchemy para Amoy

# Tu wallet Personal (owner de contratos)
DEPLOYER_KEY=0xTU_PRIVATE_KEY_PERSONAL_AQUI

# VRF - Lo que obtuviste en vrf.chain.link/amoy
VRF_SUBSCRIPTION_ID=TU_SUBSCRIPTION_ID_AMOY

# API de Polygonscan (para verificar)
POLYGONSCAN_KEY=TU_API_KEY_POLYGONSCAN

# Token USDT de prueba (se crea en el primer script)
# PAYMENT_TOKEN_ADDRESS= (se rellena después)
```

> ⚠️ **NUNCA** hagas `git commit` con el archivo `.env`. Está en `.gitignore` por seguridad.

### 2.5 Desplegar en Amoy — paso a paso

**Paso 1: Desplegar USDT de prueba**
```bash
npx hardhat run scripts/deploy-mock-token-amoy.js --network amoy
```
Salida esperada:
```
MockERC20 deployed to: 0xABC123...
```
→ Copia esta dirección y ponla en `.env` como `PAYMENT_TOKEN_ADDRESS=0xABC123...`

**Paso 2: Desplegar Keno**
```bash
npx hardhat run scripts/deploy-amoy.js --network amoy
```
Guarda la dirección: `KenoGame deployed to: 0x...`

**Paso 3: Desplegar Bingo**
```bash
npx hardhat run scripts/deploy-bingo-amoy.js --network amoy
```
Guarda la dirección: `BingoGame deployed to: 0x...`

**Paso 4: Desplegar La Bolita** (con el bug corregido)
```bash
npx hardhat run scripts/deploy-bolita-amoy.js --network amoy
```
Guarda la dirección: `LaBolitaGame deployed to: 0x...`

### 2.6 Agregar contratos a la suscripción VRF (Amoy)

1. Ir a: https://vrf.chain.link/amoy
2. Click en tu suscripción
3. "Add consumer" × 3 veces:
   - Dirección del contrato Keno
   - Dirección del contrato Bingo
   - Dirección del contrato La Bolita
4. Confirmar cada transacción

### 2.7 Verificar contratos en Amoy PolygonScan

```bash
# Verificar Keno (reemplaza la dirección y parámetros)
npx hardhat verify --network amoy \
  DIRECCION_KENO \
  "DIRECCION_USDT_MOCK" \
  "0x343300b5d84D444B2ADc9116FEF1bED02BE49Cf2" \
  "TU_SUBSCRIPTION_ID" \
  "0x816bedba8a50b294e5cbd47842baf240c2385f2eaf719edbd4f250a137a8c899" \
  "DIRECCION_WALLET_ADMIN"
```

Repetir para Bingo y La Bolita con sus parámetros.

### 2.8 Fondear los pools de prueba

En la terminal, ejecuta estos scripts o usa la interfaz de PolygonScan:

```bash
# Mintearte USDT de prueba
npx hardhat run scripts/check-balances.js --network amoy
```

Para fondear, necesitas llamar `fundPool()` en cada contrato:
1. Ve a https://amoy.polygonscan.com
2. Busca la dirección del contrato (ej: Keno)
3. Click "Write Contract" → conectar MetaMask
4. Primero llama `approve` en el contrato USDT (dar permiso al contrato Keno para gastar tus USDT)
   - `spender`: dirección del contrato Keno
   - `amount`: 100000000 (= 100 USDT con 6 decimales)
5. Luego en el contrato Keno llama `fundPool`
   - `amount`: 100000000

---

## FASE 3: MAINNET POLYGON — DESPLIEGUE FINAL

> ✅ Solo haz esto después de haber probado todo en Amoy sin errores.

### 3.1 Crear suscripción VRF en Mainnet

1. Ir a: https://vrf.chain.link/polygon
2. Conectar MetaMask con wallet Personal (en red **Polygon Mainnet**)
3. "Create Subscription" → confirmar
4. **GUARDAR SUBSCRIPTION ID**
5. "Fund subscription" → mínimo **10 LINK**

> El VRF consume aprox. 0.1-0.5 LINK por sorteo/resultado. Con 10 LINK tienes margen para empezar.

### 3.2 Actualizar .env para mainnet

```bash
# Mainnet Polygon
POLYGON_RPC_URL=https://TU-APP.g.alchemy.com/v2/TU-KEY-ALCHEMY

# Misma wallet Personal
DEPLOYER_KEY=0xTU_PRIVATE_KEY_PERSONAL

# Suscripción VRF mainnet (la nueva que acabas de crear)
VRF_SUBSCRIPTION_ID=TU_SUBSCRIPTION_ID_MAINNET

# USDT Polygon Mainnet (oficial — NO cambiar)
PAYMENT_TOKEN_ADDRESS=0xc2132D05D31c914a87C6611C10748AEb04B58e8F

# Tu wallet Admin (backend operator)
OPERATOR_ADDRESS=0xDIRECCION_WALLET_ADMIN

# API Polygonscan
POLYGONSCAN_KEY=TU_API_KEY
```

### 3.3 Desplegar en Mainnet

**PARA CADA COMANDO**: MetaMask te pedirá confirmar la transacción. Revisa el gas (no debe superar 5 POL por contrato).

**Keno:**
```bash
npx hardhat run scripts/deploy-polygon.js --network polygon
```
→ Guarda: `KenoGame deployed to: 0xKENO_MAINNET_ADDRESS`

**La Bolita** (con el fix de seguridad ya incluido en el código):
```bash
npx hardhat run scripts/deploy-bolita-polygon.js --network polygon
```
→ Guarda: `LaBolitaGame deployed to: 0xBOLITA_MAINNET_ADDRESS`

**Bingo** (crear script si no existe — ver Sección 3.4):
```bash
npx hardhat run scripts/deploy-bingo-polygon.js --network polygon
```
→ Guarda: `BingoGame deployed to: 0xBINGO_MAINNET_ADDRESS`

### 3.4 Script de despliegue Bingo para Mainnet

Si no existe `scripts/deploy-bingo-polygon.js`, crea uno con este contenido:

```javascript
// contracts/scripts/deploy-bingo-polygon.js
const hre = require("hardhat");

async function main() {
  // ─── MAINNET POLYGON — VALORES OFICIALES ───────────────────
  const USDT = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
  const VRF_COORDINATOR = "0xAE975071Be8F8eE67addBC1A82488F1C24858067";
  const KEY_HASH = "0xcc294a196eeeb44da2888d17c0625cc88d70d9760a69d58d853ba6581a9ab0cd";

  const VRF_SUBSCRIPTION_ID = process.env.VRF_SUBSCRIPTION_ID;
  const OPERATOR = process.env.OPERATOR_ADDRESS; // Tu wallet Admin

  if (!VRF_SUBSCRIPTION_ID || !OPERATOR) {
    throw new Error("VRF_SUBSCRIPTION_ID y OPERATOR_ADDRESS son requeridos en .env");
  }

  console.log("Deploying BingoGame...");
  console.log("  USDT:", USDT);
  console.log("  VRF Coordinator:", VRF_COORDINATOR);
  console.log("  Subscription ID:", VRF_SUBSCRIPTION_ID);
  console.log("  Operator:", OPERATOR);

  const BingoGame = await hre.ethers.getContractFactory("BingoGame");
  const bingo = await BingoGame.deploy(
    USDT,
    VRF_COORDINATOR,
    BigInt(VRF_SUBSCRIPTION_ID),
    KEY_HASH,
    OPERATOR
  );

  await bingo.waitForDeployment();
  const address = await bingo.getAddress();

  console.log("\n✅ BingoGame deployed to:", address);
  console.log("   Tx hash:", bingo.deploymentTransaction().hash);
  console.log("\n📋 Guarda estas variables en Railway:");
  console.log("   BINGO_CONTRACT_ADDRESS=" + address);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

### 3.5 Agregar los 3 contratos a la suscripción VRF Mainnet

1. Ir a: https://vrf.chain.link/polygon
2. Click en tu suscripción
3. "Add consumer" × 3 veces (una por cada contrato):
   - `0xKENO_MAINNET_ADDRESS`
   - `0xBINGO_MAINNET_ADDRESS`
   - `0xBOLITA_MAINNET_ADDRESS`
4. Confirmar cada transacción en MetaMask

> Sin este paso, los contratos no pueden pedir números aleatorios. Los juegos no funcionarán.

### 3.6 Verificar contratos en PolygonScan

```bash
# Keno
npx hardhat verify --network polygon \
  0xKENO_MAINNET_ADDRESS \
  "0xc2132D05D31c914a87C6611C10748AEb04B58e8F" \
  "0xAE975071Be8F8eE67addBC1A82488F1C24858067" \
  "TU_SUBSCRIPTION_ID" \
  "0xcc294a196eeeb44da2888d17c0625cc88d70d9760a69d58d853ba6581a9ab0cd" \
  "0xDIRECCION_WALLET_ADMIN"

# La Bolita
npx hardhat verify --network polygon \
  0xBOLITA_MAINNET_ADDRESS \
  "0xc2132D05D31c914a87C6611C10748AEb04B58e8F" \
  "0xAE975071Be8F8eE67addBC1A82488F1C24858067" \
  "TU_SUBSCRIPTION_ID" \
  "0xcc294a196eeeb44da2888d17c0625cc88d70d9760a69d58d853ba6581a9ab0cd"

# Bingo
npx hardhat verify --network polygon \
  0xBINGO_MAINNET_ADDRESS \
  "0xc2132D05D31c914a87C6611C10748AEb04B58e8F" \
  "0xAE975071Be8F8eE67addBC1A82488F1C24858067" \
  "TU_SUBSCRIPTION_ID" \
  "0xcc294a196eeeb44da2888d17c0625cc88d70d9760a69d58d853ba6581a9ab0cd" \
  "0xDIRECCION_WALLET_ADMIN"
```

Si da error `Already verified`, está bien — ya está verificado.

### 3.7 Configurar el contrato Keno — activar VRF real

En PolygonScan → dirección Keno → Write Contract → conectar MetaMask:

1. `setSettlementEnabled(false)` — mantener MVP por ahora (VRF directo)
2. `setVrfConfig(TU_SUBSCRIPTION_ID, KEY_HASH_500GWEI, 300000, 3)` — solo si ya no está configurado desde el constructor

### 3.8 Fondear los pools (con USDT real)

Desde PolygonScan (conectado con wallet Personal o Contrato):

**USDT en Polygon tiene la dirección**: `0xc2132D05D31c914a87C6611C10748AEb04B58e8F`

**Paso A: Dar permiso (approve)**
1. Ve a: https://polygonscan.com/address/0xc2132D05D31c914a87C6611C10748AEb04B58e8F
2. Write Contract → `approve`
   - `spender`: dirección del contrato (Keno, Bingo, o Bolita)
   - `amount`: cantidad en microUSDT (100 USDT = `100000000`)

**Paso B: Fondear pool**
1. Ve a la dirección del contrato en PolygonScan
2. Write Contract → `fundPool`
   - `amount`: misma cantidad que aprobaste

**Fondos iniciales recomendados**:

| Juego | Pool inicial | Motivo |
|-------|-------------|--------|
| Keno | 100 USDT | Cubre ~100 apuestas perdedoras antes de acumular fees |
| Bingo | 200 USDT | Jackpot inicial + buffer de prizes |
| La Bolita | 200 USDT | Cubre múltiples parles |

---

## FASE 4: CONFIGURACIÓN RAILWAY

Ve a tu proyecto en Railway → **Variables**. Añade/actualiza cada una:

### Variables obligatorias (sin estas no funciona nada)

```bash
NODE_ENV=production

# Base de datos (ya la tienes)
DATABASE_URL=postgresql://...  # ya configurada

# JWT — genera uno nuevo en: https://generate-secret.vercel.app/64
JWT_SECRET=GENERA_UNO_NUEVO_AQUI_MINIMO_64_CHARS

# Wallet Admin — la que firma transacciones automáticas
OPERATOR_PRIVATE_KEY=0xPRIVATE_KEY_DE_TU_WALLET_ADMIN

# CORS — tu dominio Cloudflare
FRONTEND_URL=https://bolcoin-frontend.pages.dev
ALLOWED_ORIGINS=https://bolcoin-frontend.pages.dev,https://bolcoin.pages.dev
```

### Variables de contratos mainnet

```bash
# RPC — usa Alchemy para mejor fiabilidad
RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/TU_API_KEY
POLYGON_RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/TU_API_KEY

# Chain ID Polygon Mainnet
CHAIN_ID=137

# Token USDT Polygon (oficial — NO cambiar)
TOKEN_ADDRESS=0xc2132D05D31c914a87C6611C10748AEb04B58e8F

# Contratos (poner las direcciones que obtuviste al desplegar)
CONTRACT_ADDRESS=0xDIRECCION_BOLITA_MAINNET
KENO_CONTRACT_ADDRESS=0xDIRECCION_KENO_MAINNET
BINGO_CONTRACT_ADDRESS=0xDIRECCION_BINGO_MAINNET

# VRF (info del subscription)
VRF_COORDINATOR=0xAE975071Be8F8eE67addBC1A82488F1C24858067
VRF_SUBSCRIPTION_ID=TU_SUBSCRIPTION_ID_MAINNET
VRF_KEY_HASH=0xcc294a196eeeb44da2888d17c0625cc88d70d9760a69d58d853ba6581a9ab0cd
```

### Variables del Bingo scheduler

```bash
ENABLE_BINGO_SCHEDULER=true
NUM_ROOMS=4
BUY_WINDOW_SECONDS=45
ROUND_INTERVAL_SECONDS=120
ENABLE_ORPHAN_RECOVERY=true
```

### Variables de seguridad opcionales pero recomendadas

```bash
# Geoblock — mantener activado
ENABLE_GEOBLOCK=true
# GEOBLOCK_FAIL_OPEN=true  # Solo activar si el geo lookup da problemas

# Session
SESSION_SECRET=GENERA_UNO_NUEVO_32_CHARS_MINIMO

# Log level
LOG_LEVEL=info
```

### Variables de Wallet Connect (frontend en Railway si aplica)

```bash
VITE_WALLETCONNECT_PROJECT_ID=TU_PROJECT_ID  # De https://cloud.walletconnect.com
```

---

## FASE 5: CONFIGURACIÓN CLOUDFLARE PAGES (frontend)

En Cloudflare Pages → tu proyecto → Settings → Environment Variables → Production:

```bash
VITE_API_URL=https://bolcoin-backend-production.up.railway.app/api
VITE_CHAIN_ID=137

# Contratos mainnet
VITE_BINGO_CONTRACT_ADDRESS=0xDIRECCION_BINGO_MAINNET
VITE_TOKEN_ADDRESS=0xc2132D05D31c914a87C6611C10748AEb04B58e8F
VITE_BOLITA_CONTRACT_ADDRESS=0xDIRECCION_BOLITA_MAINNET
VITE_KENO_CONTRACT_ADDRESS=0xDIRECCION_KENO_MAINNET

# WalletConnect (necesitas crear proyecto en https://cloud.walletconnect.com)
VITE_WALLETCONNECT_PROJECT_ID=TU_PROJECT_ID

# Geoblock (activar siempre en prod)
VITE_ENABLE_GEOBLOCK=true
```

Después de guardar → **Trigger new deployment** (botón en Cloudflare Pages).

---

## FASE 6: ACTUALIZAR ABIs EN EL BACKEND

Después de desplegar, los ABIs deben estar actualizados:

```bash
# Desde el directorio contracts/
npx hardhat compile

# Los ABIs quedan en: contracts/artifacts-v2/contracts/
# Copia los ABIs al backend:
cp artifacts-v2/contracts/KenoGame.sol/KenoGame.json ../src/chain/abi/KenoGame.abi.json
cp artifacts-v2/contracts/BingoGame.sol/BingoGame.json ../src/chain/abi/BingoGame.abi.json
cp artifacts-v2/contracts/LaBolitaGame.sol/LaBolitaGame.json ../src/chain/abi/LaBolita.abi.json
```

Verifica que el ABI tiene el formato correcto (debe ser el array JSON dentro del campo `"abi":`).

---

## FASE 7: VERIFICACIÓN FINAL ANTES DE ABRIR AL PÚBLICO

### Checklist en PolygonScan (por cada contrato)

Ir a cada contrato → Read Contract, verificar:

**Keno** (`0xKENO_ADDRESS`):
- [ ] `paymentToken()` = `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` (USDT)
- [ ] `owner()` = dirección de tu wallet Personal
- [ ] `operator()` = dirección de tu wallet Admin
- [ ] `paused()` = `false` (debe estar despaused)
- [ ] `betAmount()` = `1000000` (1 USDT)
- [ ] `feeBps()` = `1200` (12%)
- [ ] `settlementEnabled()` = `false` (MVP mode activo)
- [ ] Balance USDT en contrato ≥ 100 USDT (via ERC20 `balanceOf`)

**Bingo** (`0xBINGO_ADDRESS`):
- [ ] `paymentToken()` = USDT
- [ ] `owner()` = wallet Personal
- [ ] `operator()` = wallet Admin
- [ ] `paused()` = `false`
- [ ] `cardPrice()` = `1000000` (1 USDT)
- [ ] `feeBps()` = `1000` (10%)
- [ ] `reserveBps()` = `1000` (10%)
- [ ] Balance USDT ≥ 200 USDT

**La Bolita** (`0xBOLITA_ADDRESS`):
- [ ] `paymentToken()` = USDT
- [ ] `owner()` = wallet Personal
- [ ] `paused()` = `false` (o `true` si aún no la activas)
- [ ] `feeBps()` = `500` (5%)
- [ ] Balance USDT ≥ 200 USDT

### Checklist en Railway

- [ ] Railway logs muestran `[GeoBlock] Geoblocking enabled`
- [ ] Railway logs muestran `[BingoScheduler] Starting 4-room staggered scheduler`
- [ ] Railway logs NO muestran `CORS: origin ... not allowed`
- [ ] Endpoint health: `https://bolcoin-backend-production.up.railway.app/health` devuelve `{"status":"healthy"}`
- [ ] Endpoint bingo rooms: `https://bolcoin-backend-production.up.railway.app/api/bingo/rooms` devuelve 4 salas

### Checklist en el frontend (móvil y PC)

- [ ] La página carga sin spinner infinito
- [ ] Se pueden ver las 4 salas de Bingo
- [ ] Al conectar wallet aparece spinner "Conectando wallet…" (no el panel de conexión)
- [ ] Después de conectar aparece la dirección truncada en el header
- [ ] Página Keno carga y muestra el formulario de apuesta
- [ ] La Bolita muestra "Coming Soon" o el formulario (según si está activa)

---

## FASE 8: MONITOREO Y MANTENIMIENTO

### Control de fees acumuladas

Las fees se acumulan en cada contrato. Para retirarlas:

En PolygonScan → Write Contract → `withdrawFees`:
- `amount`: en microUSDT (100 USDT = `100000000`)
- `to`: dirección de tu wallet **Tesorería**

> Hazlo cuando acruedFees sea > 50 USDT para optimizar gas.

### Control del LINK en VRF

Entra a https://vrf.chain.link/polygon periódicamente.
- Si LINK < 5: recargar con más LINK
- Cada sorteo/resultado VRF consume ~0.2-0.5 LINK en mainnet

### Rotación de credenciales (URGENTE si no se ha hecho)

En Railway, rota estas variables cuanto antes:
1. `JWT_SECRET` → nuevo valor aleatorio (64 chars)
2. `SESSION_SECRET` → nuevo valor aleatorio (32 chars)
3. `DATABASE_URL` → cambiar password desde panel Railway/Postgres
4. `OPERATOR_PRIVATE_KEY` → si el proyecto lleva tiempo, considera crear una wallet Admin nueva y transferir el rol con `setOperator()`

### Cambiar el operator en contratos (si necesitas rotar la wallet Admin)

En cada contrato, Write Contract → `setOperator`:
- `_operator`: dirección de la nueva wallet Admin

Luego actualiza `OPERATOR_PRIVATE_KEY` en Railway con la private key de la nueva wallet.

---

## DIRECCIONES DE REFERENCIA (Mainnet Polygon — NO CAMBIAR)

| Contrato externo | Dirección | Para qué |
|----------------|-----------|----------|
| USDT (Polygon) | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` | Token de pago |
| Chainlink VRF V2.5 | `0xAE975071Be8F8eE67addBC1A82488F1C24858067` | Generación aleatoria |
| VRF Key Hash 500gwei | `0xcc294a196eeeb44da2888d17c0625cc88d70d9760a69d58d853ba6581a9ab0cd` | Gas lane estándar |
| LINK (Polygon) | `0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39` | Para pagar VRF |

## DIRECCIONES DE REFERENCIA (Amoy Testnet — Solo pruebas)

| Contrato externo | Dirección | Para qué |
|----------------|-----------|----------|
| Chainlink VRF V2.5 Amoy | `0x343300b5d84D444B2ADc9116FEF1bED02BE49Cf2` | VRF testnet |
| VRF Key Hash Amoy | `0x816bedba8a50b294e5cbd47842baf240c2385f2eaf719edbd4f250a137a8c899` | Gas lane testnet |
| LINK Amoy | `0x0Fd9e8d3aF1aaee056EB9e802c3A762a667b1904` | Para VRF testnet |

---

## GLOSARIO RÁPIDO

| Término | Qué significa |
|---------|--------------|
| **Gas** | Comisión que se paga en POL/MATIC por cada transacción en Polygon |
| **VRF** | Chainlink Verifiable Random Function — genera números aleatorios imposibles de manipular |
| **LINK** | Token de Chainlink — se consume cada vez que VRF genera un número aleatorio |
| **Owner** | El dueño del contrato (tu wallet Personal) — puede hacer todo |
| **Operator** | El "gerente automático" (tu wallet Admin) — solo puede operar el juego diariamente |
| **BPS** | Basis Points — 100 BPS = 1%, 1000 BPS = 10% |
| **accruedFees** | Fees acumuladas dentro del contrato esperando ser retiradas |
| **fundPool** | Función para añadir USDT al pool de premios del contrato |
| **Pausable** | El contrato puede ser "congelado" para emergencias — nadie puede jugar mientras está pausado |
| **approve + transferFrom** | Mecanismo de ERC20 para dar permiso a un contrato de gastar tus USDT |

---

## PRÓXIMOS PASOS (después de prod estable)

1. **Keno on-chain VRF**: Activar con `setSettlementEnabled(false)` — ya está listo en MVP
2. **Keno settlement Phase 2**: Completar el stub `settleKenoSession()` si se quiere batch settlement
3. **La Bolita**: Necesita draws manuales periódicos (owner llama `createDraw`, `openDraw`, `closeDraw`)
4. **Automatización draws La Bolita**: Crear un cron job en Railway que llame al backend para crear/abrir/cerrar draws automáticamente
5. **Monitoring**: Configurar alertas (Discord webhook) cuando `accruedFees > umbral` o `poolBalance < umbral`
6. **La Fortuna**: Implementar contrato desde cero cuando se decida el diseño

---

*Documento generado: 2026-02-26*
*Próxima revisión recomendada: después de primer despliegue en testnet*
