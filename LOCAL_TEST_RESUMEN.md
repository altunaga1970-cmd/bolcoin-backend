# Resumen - Keno Phase 3 + Local Testing

## Estado Actual

Todo corriendo en localhost para testing con Hardhat + MetaMask.

### Servicios Activos

| Servicio | URL | Estado |
|----------|-----|--------|
| Hardhat Node | http://127.0.0.1:8545 | Corriendo (Chain ID: 31337) |
| Backend API | http://localhost:5000 | Corriendo |
| Frontend | http://localhost:3000 | Corriendo |
| PostgreSQL | localhost:5432 | Corriendo (DB: labolita) |

---

## Contratos Desplegados (Hardhat Local)

| Contrato | Direccion |
|----------|-----------|
| MockERC20 (USDT) | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| MockVRFCoordinator | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| KenoGame | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |

---

## Cuentas Hardhat (para MetaMask)

| # | Address | Private Key | USDT | Rol |
|---|---------|-------------|------|-----|
| 0 | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` | 10,000 | Owner/Admin |
| 1 | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` | 99 | Player |
| 2 | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` | `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a` | 10,000 | Operator (backend signer) |

### Configurar MetaMask

1. **Agregar red:** Network Name: `Hardhat Local`, RPC: `http://127.0.0.1:8545`, Chain ID: `31337`, Symbol: `ETH`
2. **Importar cuenta:** MetaMask > Import Account > Paste private key de Account #0 o #1
3. **Importar token USDT:** MetaMask > Import Token > Address: `0x5FbDB2315678afecb367f032d93F642f64180aa3`

---

## Archivos .env Configurados

### Backend (`/.env`)
```
NODE_ENV=development
PORT=5000
DATABASE_URL=postgresql://postgres:Erik2018@localhost:5432/labolita
RPC_URL=http://127.0.0.1:8545
CHAIN_ID=31337
CONTRACT_ADDRESS=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
TOKEN_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3
KENO_CONTRACT_ADDRESS=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
OPERATOR_PRIVATE_KEY=5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
OPERATOR_WALLET=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
ADMIN_WALLETS=0x1AeFB2C09CD44AF8Ff40D530B880A00208aA54A1:superadmin,0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266:superadmin
FRONTEND_URL=http://localhost:3000
ALLOWED_ORIGINS=http://localhost:3000
ENABLE_GEOBLOCK=false
ENABLE_SCHEDULER=true
```

### Frontend (`/bolcoin-frontend/.env`)
```
VITE_API_URL=http://localhost:5000/api
VITE_CHAIN_ID=31337
VITE_CONTRACT_ADDRESS=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
VITE_TOKEN_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3
VITE_KENO_CONTRACT_ADDRESS=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
VITE_KENO_MODE=onchain
```

---

## Phase 3 - Lo que se implemento

### 1. Migration DB (Completada)
- Tabla `keno_seed_commits` para commit-reveal
- Columnas `seed_hash`, `commit_id` en `keno_games`
- 6 entradas en `game_config` (loss limits + feature flags)
- Ejecutar: `node src/db/migrations/add-keno-phase3.js up`

### 2. Loss Limits / Responsible Gaming
- `checkLossLimits()` en `kenoService.js` - verifica daily/session/games limits
- Endpoint `GET /api/keno/limits` - retorna limites + uso actual
- Frontend: `LossLimitsBar` con barras de progreso (warning 80%, rojo 95%)
- Fail-closed: si API de limites falla, bloquea juego
- Config defaults: daily=$100, session=$50, max_games=200 (0=sin limite)

### 3. Commit-Reveal Fairness
- `createSeedCommit()` / `consumeSeedCommit()` en `kenoVrfService.js`
- Endpoint `POST /api/keno/commit` con rate limiter (15/min)
- Max 5 commits pendientes por wallet
- Cleanup automatico de commits expirados
- Feature flag: `keno_commit_reveal_enabled` (default: false)

### 4. VRF Batch Enhancement
- `checkCompletedVrfRequests()` intenta on-chain primero, fallback local
- `initVrfContract()` exportado para uso externo
- Feature flag: `keno_vrf_enabled` (default: false)

### 5. Settlement On-Chain
- ABI corregido: 5 parametros `settleKenoSession(address, uint256, bool, bytes32, bytes)`
- Firma EIP-712 con `deadline` para replay protection
- BigInt chainId (ethers.js v6)
- Estado `settlement_failed` si on-chain falla (no marca como `settled`)
- Feature flag: `keno_settlement_enabled` (default: false)

---

## 15 Fixes de Seguridad Aplicados

1. featureFlag.js catch -> return 503 (fail-closed, no next())
2. EIP-712 deadline + BigInt chainId
3. settlement_failed status on chain error
4. clientSeed desde input usuario (no hardcoded '')
5. gameId con crypto.randomBytes(4) (collision-safe)
6. isWin = netResult > 0 (no payout > 0) en playKeno
7. isWin = netResult > 0 en getGameHistory
8. Sin double ROLLBACK (catch block unico)
9. Rate limiter en /commit (15/min)
10. Max 5 commits pendientes por wallet
11. Cleanup TTL configurable (configTTL * 2)
12. Migration FK VARCHAR(50) match
13. LossLimitsBar muestra limite de sesion
14. Retry button -> handlePlayClick (con confirmacion)
15. lossLimitsError = fail-closed

---

## Archivos Modificados (Phase 3)

| Archivo | Cambios |
|---------|---------|
| `src/db/migrations/add-keno-phase3.js` | NUEVO - migration |
| `src/services/gameConfigService.js` | +getLossLimitConfig(), +6 defaults |
| `src/services/kenoService.js` | +checkLossLimits(), commit-reveal en playKeno, fixes |
| `src/services/kenoVrfService.js` | +createSeedCommit(), +consumeSeedCommit(), +cleanupExpiredCommits() |
| `src/services/kenoSessionService.js` | Fix ABI 5 params, +signSettlement() EIP-712, settlement_failed |
| `src/routes/keno.js` | +GET /limits, +POST /commit, +POST /admin/vrf/toggle |
| `src/scheduler/kenoVrfRequester.js` | +on-chain VRF check, +cleanup commits |
| `src/middleware/featureFlag.js` | Fix catch -> 503 (fail-closed) |
| `bolcoin-frontend/src/api/kenoApi.js` | +getLimits(), +commitSeed(), playKeno con commitId |
| `bolcoin-frontend/src/hooks/useKenoGame.js` | +lossLimits state, commit-reveal flow, clientSeed |
| `bolcoin-frontend/src/pages/user/KenoPage.jsx` | +LossLimitsBar, fix retry button |

---

## Comandos para Reiniciar

```bash
# 1. Hardhat node (terminal 1)
cd contracts && npx hardhat node

# 2. Deploy contratos (terminal 2, una vez)
cd contracts && npx hardhat run scripts/deploy-local.js --network localhost

# 3. Mint USDT de prueba
cd contracts && npx hardhat run scripts/mint-local-usdt.js --network localhost

# 4. DB init + migration
cd /ruta/al/proyecto && node src/db/init.js && node src/db/migrations/add-keno-phase3.js up

# 5. Backend (terminal 3)
node src/server.js

# 6. Frontend (terminal 4)
cd bolcoin-frontend && npx vite --port 3000
```

---

## Bug Encontrado y Corregido Durante Testing

**Problema:** Al verificar resultado de un juego daba error.
**Causa:** Las games viejas (pre-Phase 3) no tenian `server_seed` guardado en DB. La funcion `getGameVerificationStatus()` intentaba hashear `null` y fallaba.
**Fix:**
- El codigo actualizado SI guarda `server_seed` en el INSERT.
- Se limpiaron las games viejas sin server_seed de la DB.
- Juegos nuevos guardaran correctamente el server_seed para verificacion.

**Segundo problema:** `VITE_TOKEN_ADDRESS` en frontend apuntaba a un deploy viejo (`0xD843...`) en vez del USDT actual (`0x5FbDB...`). Corregido.

---

## Pendiente / Proximos Pasos

- [ ] Testear juego completo: conectar wallet, jugar, verificar resultado
- [ ] Testear loss limits: jugar hasta alcanzar limite
- [ ] Habilitar commit-reveal: `UPDATE game_config SET value='true' WHERE key='keno_commit_reveal_enabled'`
- [ ] Testear settlement on-chain (requiere habilitar flag)
- [ ] i18n para mensajes de error (future)
- [ ] Toast activos al 80%/95% de limites (future)
