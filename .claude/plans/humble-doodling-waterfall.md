# Plan: Preparar Keno para Produccion (Amoy Testnet primero)

## Contexto
Keno funciona en modo off-chain local. Para produccion necesitamos:
1. Scripts de deploy del contrato `KenoGame.sol` en Polygon Amoy (testnet)
2. Script de setup payout table + fund pool
3. Templates `.env.production` para backend y frontend
4. Guia paso-a-paso completa

## Archivos a crear

| # | Archivo | Descripcion |
|---|---------|-------------|
| 1 | `contracts/scripts/deploy-keno.js` | Hardhat deploy script (lee red del `--network` flag) |
| 2 | `contracts/scripts/setup-payout-table.js` | Popula tabla de pagos + activa + fondea pool |
| 3 | `backend/.env.production.example` | Template backend con todos los secretos documentados |
| 4 | `bolcoin-frontend/.env.production.example` | Template frontend VITE_* vars |
| 5 | `DEPLOY_KENO_PRODUCTION.md` | Guia completa paso a paso |

## Detalles de cada archivo

### 1. `contracts/scripts/deploy-keno.js`
```
Lee de env: OPERATOR_ADDRESS, VRF_SUB_ID
Detecta red por hardhat --network flag
Direcciones hardcodeadas por red:
  amoy: USDT=0x41E9..., VRF_COORD=0x3433..., KEY_HASH=0x816b...
  polygon: USDT=0xc213..., VRF_COORD=0xec0E..., KEY_HASH=0xcc29...
Despliega KenoGame(token, vrfCoord, vrfSubId, vrfKeyHash, operator)
Imprime: address, constructor args (para verify)
```

### 2. `contracts/scripts/setup-payout-table.js`
```
Lee KENO_ADDRESS de env
Payout table exacta del backend (kenoService.js):
  1: [0, 300]          (0 hits=0x, 1 hit=3x)
  2: [0, 100, 900]
  3: [0, 0, 200, 2700]
  4: [0, 0, 100, 500, 7500]
  5: [0, 0, 0, 300, 1200, 30000]
  6: [0, 0, 0, 200, 500, 5000, 100000]
  7: [0, 0, 0, 100, 300, 2000, 10000, 200000]
  8: [0, 0, 0, 0, 200, 1000, 5000, 50000, 500000]
  9: [0, 0, 0, 0, 100, 500, 2500, 20000, 200000, 750000]
  10: [0, 0, 0, 0, 0, 300, 1500, 10000, 100000, 500000, 1000000]
Llama updatePayoutRow(spots, multipliers) x10
Llama commitPayoutUpdate()
Opcionalmente fundPool(amount) si FUND_AMOUNT env var esta seteado
```

### 3. `backend/.env.production.example`
Todas las variables con comentarios, valores placeholder:
- NODE_ENV=production
- DATABASE_URL, JWT_SECRET, SESSION_SECRET (generar con openssl)
- RPC_URL (Alchemy/Infura Polygon)
- CHAIN_ID=137 (o 80002 para Amoy)
- KENO_CONTRACT_ADDRESS (del deploy)
- OPERATOR_PRIVATE_KEY (wallet nueva, NUNCA hardhat keys)
- OPERATOR_WALLET
- ADMIN_WALLETS (wallets reales, no hardhat)
- ALLOWED_ORIGINS (dominio produccion)
- ENABLE_GEOBLOCK=true
- NOWPayments keys

### 4. `bolcoin-frontend/.env.production.example`
- VITE_API_URL=https://api.tudominio.com/api
- VITE_CHAIN_ID=137
- VITE_CONTRACT_ADDRESS (del deploy)
- VITE_TOKEN_ADDRESS=0xc2132D05D31c914a87C6611C10748AEb04B58e8F
- VITE_KENO_CONTRACT_ADDRESS (del deploy)
- VITE_KENO_MODE=onchain
- VITE_ENABLE_GEOBLOCK=true

### 5. `DEPLOY_KENO_PRODUCTION.md`
Guia paso a paso:

**Fase 0: Pre-requisitos**
- Wallet deployer (con MATIC para gas)
- Wallet operator (para firmar settlements)
- Suscripcion Chainlink VRF en vrf.chain.link
- USDT para fondear pool
- PostgreSQL de produccion
- Dominio + SSL

**Fase 1: Deploy contrato (Amoy primero)**
```bash
cd contracts
cp .env.example .env  # llenar valores
npx hardhat run scripts/deploy-keno.js --network amoy
# Anotar la direccion
npx hardhat verify --network amoy <ADDRESS> <CONSTRUCTOR_ARGS>
```

**Fase 2: Setup payout table + fund pool**
```bash
KENO_ADDRESS=0x... npx hardhat run scripts/setup-payout-table.js --network amoy
# Opcional: FUND_AMOUNT=1000 para fondear 1000 USDT
```

**Fase 3: Chainlink VRF**
- Ir a vrf.chain.link
- Agregar contrato como consumer
- Fondear suscripcion con LINK

**Fase 4: Backend produccion**
- Copiar backend/.env.production.example → .env
- Llenar todos los valores
- npm run db:init (migraciones)
- pm2 start src/server.js --name bolcoin-api

**Fase 5: Frontend produccion**
- Copiar .env.production.example → .env.production
- npm run build
- Servir dist/ con nginx

**Fase 6: Verificacion**
- Conectar wallet → ver balance
- Aprobar USDT → jugar Keno → verificar VRF resuelve
- Verificar fees se acumulan en contrato
- Verificar pool cambia con wins/losses

**Checklist de seguridad**
- [ ] NODE_ENV=production (desactiva auto-faucet, dev routes, signature skip)
- [ ] Secretos nuevos (JWT_SECRET, SESSION_SECRET, OPERATOR_PRIVATE_KEY)
- [ ] ADMIN_WALLETS = solo wallets reales
- [ ] ENABLE_GEOBLOCK=true
- [ ] CORS = solo dominio produccion
- [ ] Contrato verificado en Polygonscan
- [ ] VRF subscription fondeada con LINK
- [ ] Pool fondeado con USDT suficiente

## No se modifica
- Codigo de negocio existente (kenoService.js, KenoGame.sol, etc.)
- Solo se crean archivos nuevos (scripts, templates, guia)
