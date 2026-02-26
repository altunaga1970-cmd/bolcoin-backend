# BOLCOIN dApp - AUDITORIA INTEGRAL + PLAN PRO
## Fecha: 2026-02-25 | Auditor: Senior Engineer Review

---

# PARTE 1: HALLAZGOS DE SEGURIDAD

## CRITICO (Riesgo de perdida de fondos inmediata)

### C-01: retryUnpaidBet Double-Payment en LaBolitaGame.sol
- **Archivo**: `contracts/contracts/LaBolitaGame.sol:477-485`
- **Descripcion**: La funcion `retryUnpaidBet()` no tiene tracking de si ya se pago el retry. Puede llamarse N veces y drenar el pool completo.
- **Impacto**: Un atacante puede drenar TODOS los fondos del contrato con una sola apuesta ganadora que falle el pago inicial.
- **Fix**: Agregar campo `bool retryPaid` al struct Bet, o marcar payout=0 despues de pagar. El contrato de KenoGame.sol:331-340 lo hace correctamente con `b.status = BetStatus.PAID`.
- **Estado**: CONOCIDO, pendiente redeploy.

```solidity
// VULNERABLE (actual):
function retryUnpaidBet(uint256 betId) external nonReentrant {
    Bet storage b = bets[betId];
    require(b.resolved && b.won && b.payout > 0, "Not eligible");
    uint256 payout = uint256(b.payout);
    if (availablePool() < payout) revert InsufficientPool();
    paymentToken.safeTransfer(b.player, payout);
    // BUG: No marca como pagada, se puede llamar infinitas veces
}

// FIX REQUERIDO:
function retryUnpaidBet(uint256 betId) external nonReentrant {
    Bet storage b = bets[betId];
    require(b.resolved && b.won && b.payout > 0, "Not eligible");
    uint256 payout = uint256(b.payout);
    b.payout = 0; // MARCAR COMO PAGADA ANTES DEL TRANSFER
    if (availablePool() < payout) revert InsufficientPool();
    paymentToken.safeTransfer(b.player, payout);
}
```

### C-02: JWT_SECRET Hardcodeado en .env.example
- **Archivo**: `.env.example:144`
- **Descripcion**: `JWT_SECRET=mCUXggT7rU6Bm2xjQlA7ZdEZE1u7yoxmjDQmwK3pD2IUaaiDxxZURTYJas+SsuPQWoR57Yn+lZ7W1PTczkdcFg==` - secreto real commiteado.
- **Impacto**: Si este es el mismo secreto que produccion, cualquiera puede forjar tokens JWT admin/usuario.
- **Fix**: Rotar JWT_SECRET inmediatamente en Railway. Poner placeholder en .env.example.

### C-03: Credenciales en Historial Git
- **Descripcion**: Credenciales de DB, JWT_SECRET, y posiblemente OPERATOR_PRIVATE_KEY expuestos en historial git.
- **Impacto**: Acceso total a la base de datos y posibilidad de firmar transacciones como operador.
- **Fix**: Rotar TODAS las credenciales: DATABASE_URL password, JWT_SECRET, SESSION_SECRET, OPERATOR_PRIVATE_KEY.

### C-04: Settlement On-Chain es STUB (No Mueve Fondos)
- **Archivo**: `contracts/contracts/KenoGame.sol:442-464`
- **Descripcion**: `settleKenoSession()` solo emite un evento, no mueve fondos. Keno backend usa balance DB que no refleja realidad on-chain.
- **Impacto**: Desfase entre balance DB y balance real. Posible arbitraje: ganar en DB pero no perder USDT real.
- **Fix**: Implementar settlement real o migrar Keno a VRF on-chain (como ya esta diseñado el contrato).

---

## ALTO (Riesgo significativo)

### H-01: Keno Usa SHA-256 Server-Side (No Trustless)
- **Archivo**: `src/services/kenoService.js:106-123`
- **Descripcion**: RNG generado con `crypto.createHash('sha256')` en el servidor. El operador controla el `serverSeed`.
- **Impacto**: Aunque hay commit-reveal, en modo legacy (commit_reveal_enabled=false) el servidor ve los numeros del usuario ANTES de generar los resultados. Posible manipulacion.
- **Mitigacion actual**: Provably fair con seed hash publicado. Pero no es trustless.
- **Fix**: Migrar a VRF on-chain (el contrato KenoGame.sol ya lo soporta).

### H-02: Geoblock Fail-Open
- **Archivo**: `src/middleware/geoblock.js:152-156`
- **Descripcion**: Si la API de geolocalizacion falla, el middleware permite el acceso (`next()`).
- **Impacto**: Un atacante puede causar timeout en la API geo y bypass la restriccion. Usuarios de paises bloqueados (US, ES, etc.) pueden acceder.
- **Fix**: Cambiar a fail-close en produccion, o usar servicio geo mas robusto (Cloudflare headers, MaxMind local DB).

### H-03: No Hay Rate Limiting en Keno Play Endpoint
- **Archivo**: `src/routes/keno.js` (necesita verificar rate limit config)
- **Descripcion**: Un usuario puede spam el endpoint de jugar Keno a alta velocidad.
- **Impacto**: Si hay alguna condicion de carrera residual, podria explotar timing. Tambien DoS.
- **Fix**: Rate limit estricto en endpoints de juego (max 1 juego/segundo por wallet).

### H-04: Withdrawal Auto-Processing Sin Verificacion On-Chain
- **Archivo**: `src/services/withdrawalService.js:39-50`
- **Descripcion**: `processWithdrawal` solo deduce balance en DB y llama `Withdrawal.markCompleted()`. No verifica que la transferencia on-chain realmente ocurrio.
- **Impacto**: El balance DB se deduce pero el usuario puede no recibir fondos. O inversamente, recibir fondos sin deduccion si hay error de timing.
- **Fix**: Implementar patron: 1) mark processing 2) execute on-chain 3) verify tx receipt 4) mark completed.

### H-05: Admin Permissions Leidas del JWT (No Verificadas en Cada Request)
- **Archivo**: `src/middleware/adminAuth.js:48-53`
- **Descripcion**: `req.admin.permissions` se toman del JWT decodificado (linea 52). Si se cambian permisos de un admin, el JWT viejo sigue siendo valido hasta que expire (4h).
- **Fix**: Leer permisos frescos de `ROLE_PERMISSIONS[getAdminRole(address)]` en cada request en vez del JWT.

---

## MEDIO

### M-01: Card Generation con prevrandao Manipulable
- **Archivo**: `contracts/contracts/BingoGame.sol:553-577`
- **Descripcion**: `_generateCardNumbers` usa `block.prevrandao + block.timestamp`. Un validador puede influenciar los numeros de la tarjeta.
- **Impacto**: Limitado porque el sorteo de bolas usa VRF (independiente), pero un validador podria generar tarjetas favorables.
- **Fix**: Usar VRF seed para generar tarjetas despues de cerrar la ronda, o generar off-chain con firma del operador.

### M-02: No Hay Upgrade Pattern en Contratos
- **Descripcion**: Los 3 contratos son monoliticos sin proxy/upgrade pattern.
- **Impacto**: Cualquier bug requiere deploy de contrato nuevo + migracion de estado + migracion de fondos.
- **Fix**: Para proximos contratos, considerar OpenZeppelin TransparentProxy o UUPS.

### M-03: Floating Point Arithmetic en Backend
- **Archivo**: `src/services/withdrawalService.js:87-91`, `src/services/betService.js:73`
- **Descripcion**: Uso de `parseFloat()` para operaciones monetarias. JavaScript floating point tiene errores de precision.
- **Impacto**: Errores de redondeo en balances (1 centavo de diferencia acumulado = discrepancia).
- **Fix**: Usar integer arithmetic (centavos) o libreria como `decimal.js` para todas las operaciones monetarias.

### M-04: getOpenDraws() Loop No Acotado
- **Archivo**: `contracts/contracts/LaBolitaGame.sol:509-522`
- **Descripcion**: `getOpenDraws()` itera sobre TODOS los draws creados. Si drawCounter crece, el gas aumenta linealmente.
- **Impacto**: View function se vuelve inutilizable con muchos draws. Puede afectar frontend.
- **Fix**: Mantener array de open draw IDs como hace BingoGame.sol.

### M-05: BingoGame _safePay Usa transfer() No safeTransfer()
- **Archivo**: `contracts/contracts/BingoGame.sol:586`
- **Descripcion**: `_safePay` usa `IERC20.transfer()` directo en un try/catch. USDT en algunas chains no retorna bool.
- **Impacto**: Si USDT en Polygon no retorna bool (no es el caso actualmente), transfer podria fallar silenciosamente.
- **Mitigacion**: El try/catch con fallback a pendingPrizes maneja el caso. Riesgo bajo en Polygon.

### M-06: No Hay Monitoring ni Alerting
- **Descripcion**: No hay sistema de monitoreo, logging estructurado, ni alertas.
- **Impacto**: Problemas en produccion (pool vacio, VRF stuck, DB down) no se detectan hasta que un usuario reporta.
- **Fix**: Implementar health checks avanzados, alertas (PagerDuty/Discord/Telegram), logging estructurado (Winston/Pino).

---

## BAJO

### L-01: Nonce Store en Memoria (SIWE)
- **Archivo**: `src/middleware/siweAuth.js:15`
- **Descripcion**: `nonceStore` es un `Map()` en memoria. Se pierde en restart.
- **Impacto**: Bajo - solo afecta logins admin en progreso durante un restart.

### L-02: Geo API Hace Requests HTTP (No HTTPS)
- **Archivo**: `src/middleware/geoblock.js:73`
- **Descripcion**: `http://ip-api.com/json/` usa HTTP sin TLS.
- **Impacto**: MITM podria interceptar/manipular respuestas geo.
- **Fix**: Usar HTTPS o MaxMind local DB.

### L-03: Password Validation Debil
- **Archivo**: `src/middleware/validation.js:43`
- **Descripcion**: Solo requiere 6 caracteres minimos, sin complejidad.
- **Impacto**: Legacy (sistema usa SIWE ahora), pero si algun path usa username/password login, es debil.

### L-04: JWT_SECRET Exportado como Modulo
- **Archivo**: `src/config/auth.js:101`
- **Descripcion**: `module.exports = { JWT_SECRET, ... }` - el secreto es importable por cualquier modulo.
- **Impacto**: Si hay alguna vulnerabilidad de code injection, el secreto es accesible.
- **Fix**: No exportar JWT_SECRET, solo exportar generateToken/verifyToken.

---

## INFO

### I-01: Dual Auth System (Legacy JWT + SIWE)
- `src/middleware/auth.js` usa JWT de usuario legacy (username/password)
- `src/middleware/siweAuth.js` + `adminAuth.js` usan JWT con SIWE
- Considerar eliminar el path legacy si no se usa

### I-02: VRF Config en .env.example
- `VRF_COORDINATOR`, `VRF_KEY_HASH` son valores de Polygon Amoy, no mainnet
- Verificar que produccion use los valores correctos de mainnet

### I-03: BingoGame vrfRequestConfirmations = 10
- Mas alto que los 3 standard. Agrega latencia (~20 segundos extra) pero es mas seguro contra reorgs.

---

# PARTE 2: REVIEW DE ARQUITECTURA

## Estado Actual - Diagrama

```
[Usuario] --> [MetaMask/Wallet]
    |              |
    v              v
[Frontend]    [Smart Contracts]     (Polygon PoS)
(Cloudflare)   - LaBolitaGame.sol   - USDT transfers
    |          - KenoGame.sol        - VRF randomness
    v          - BingoGame.sol       - Prize payouts
[Backend API]
(Railway)
    |
    v
[PostgreSQL]    [Chainlink VRF]
(Railway)       (Polygon)
```

## Analisis por Componente

### Smart Contracts: 7/10
- **Bueno**: ReentrancyGuard, Pausable, SafeERC20, exposure limits, VRF integration
- **Bueno**: BingoGame tiene excelente diseño (frozen BPS, co-winners, pendingPrizes, emergencyCancel)
- **Malo**: retryUnpaidBet bug critico en LaBolita
- **Malo**: No upgradeable
- **Faltante**: Tests automatizados visibles

### Backend: 5/10
- **Bueno**: SIWE auth, role-based permissions, optimistic locking, session-based Keno
- **Bueno**: Feature flags, graceful degradation (DB optional), audit logging
- **Malo**: Floating point para dinero, settlement stub, dual auth confuso
- **Malo**: No CI/CD, no monitoring, no structured logging
- **Faltante**: Integration tests para flujos de dinero, end-to-end tests

### Frontend: 6/10
- **Bueno**: Balance prioriza blockchain (non-custodial), i18n (10 idiomas), responsive
- **Bueno**: Design system con variables CSS, glass morphism moderno
- **Malo**: Submodule git complica deployment
- **Faltante**: Error boundaries, offline handling, tx pending states review needed

### DevOps: 2/10
- **Bueno**: Railway deploy, Cloudflare Pages
- **Malo**: No CI/CD pipeline, no automated tests en deploy, no staging environment
- **Malo**: No monitoring, no alertas, no log aggregation
- **Faltante**: Todo

---

# PARTE 3: PLAN PROFESIONAL - ROADMAP

## FASE 0: EMERGENCIA (Semana 1) - "Stop the Bleeding"

### 0.1 Rotar Credenciales [CRITICO]
- [ ] Rotar JWT_SECRET en Railway
- [ ] Rotar DATABASE_URL password
- [ ] Rotar SESSION_SECRET
- [ ] Rotar OPERATOR_PRIVATE_KEY (generar nueva wallet, transferir fondos, actualizar VRF subscription)
- [ ] Limpiar .env.example (remover JWT_SECRET hardcodeado, poner placeholder)
- [ ] Verificar que .env esta en .gitignore

### 0.2 Pausar LaBolita [CRITICO]
- [ ] Llamar `pause()` en LaBolitaGame.sol via owner wallet
- [ ] Desactivar feature flag `game_bolita` en backend
- [ ] Mostrar "Maintenance" en frontend para La Bolita

### 0.3 Fix retryUnpaidBet [CRITICO]
- [ ] Escribir LaBolitaGameV2.sol con fix (b.payout = 0 antes del transfer)
- [ ] Escribir tests exhaustivos (Hardhat)
- [ ] Deploy a testnet (Amoy), verificar
- [ ] Deploy a mainnet
- [ ] Migrar estado: resolver bets pendientes del contrato viejo
- [ ] Actualizar CONTRACT_ADDRESS en Railway

### 0.4 Git Hygiene
- [ ] Eliminar archivos sueltos de la raiz (AUDIT_BINGO_*.md, DEPLOYMENT_*.md, etc.)
- [ ] Mover documentacion util a `/docs`
- [ ] `.gitignore` actualizado

---

## FASE 1: HARDENING (Semanas 2-4) - "Production Grade"

### 1.1 Settlement Real para Keno
**Opcion A (Recomendada): Migrar a VRF On-Chain**
- El contrato KenoGame.sol YA soporta VRF on-chain (placeBet -> fulfillRandomWords)
- Frontend llama `placeBet()` directo al contrato
- Eliminar flujo backend de Keno game (DB balance, SHA-256)
- Beneficio: 100% trustless, no necesita settlement

**Opcion B: Implementar Settlement EIP-712**
- Activar `settlementEnabled` en KenoGame.sol
- Backend firma settlements con OPERATOR_PRIVATE_KEY
- Implementar userBalances mapping + withdraw()
- Riesgo: Mas complejo, sigue dependiendo del operador

**Recomendacion**: Opcion A es superior para un dApp non-custodial. Requiere:
1. LINK tokens para VRF subscription
2. Frontend integration con contrato directo
3. Eliminar kenoService.js backend path
4. Pool funding on-chain

### 1.2 Integer Arithmetic
- [ ] Reemplazar `parseFloat()` con integer cents en:
  - `withdrawalService.js`
  - `betService.js`
  - `bankrollService.js`
  - `kenoService.js`
- [ ] Alternativa: usar `Decimal.js` o `big.js`
- [ ] Agregar tests que verifiquen precision monetaria

### 1.3 Security Hardening
- [ ] Fix geoblock fail-open -> fail-close (con whitelist de rutas publicas)
- [ ] Rate limiting estricto en endpoints de juego
- [ ] No exportar JWT_SECRET
- [ ] Actualizar admin permissions: leer fresh de config, no del JWT
- [ ] HTTPS para geo API (o MaxMind local)
- [ ] CSP headers en frontend

### 1.4 CI/CD Pipeline
```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  backend-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_DB: test
          POSTGRES_PASSWORD: test
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test

  contract-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: cd contracts && npm ci && npx hardhat test

  frontend-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { submodules: true }
      - run: cd bolcoin-frontend && npm ci && npm run build
```

### 1.5 Testing
- [ ] Contract tests (Hardhat):
  - LaBolitaGameV2: retryUnpaidBet no puede ser llamada 2x
  - KenoGame: VRF flow completo (mock VRF coordinator)
  - BingoGame: resolveRound con co-winners, emergencyCancel
- [ ] Backend integration tests:
  - Keno play + session lifecycle
  - Withdrawal flow (con mock on-chain)
  - Admin auth SIWE flow
- [ ] E2E tests (Playwright/Cypress):
  - Connect wallet -> buy bingo card -> round resolved -> claim
  - Keno play flow -> verify provably fair

### 1.6 Monitoring & Alerting
- [ ] Structured logging (Pino/Winston) con JSON output
- [ ] Health check endpoint avanzado (`/health/deep` - check DB, RPC, VRF)
- [ ] Railway metrics dashboard
- [ ] Alertas via Discord/Telegram webhook:
  - Pool balance < threshold
  - VRF request no respondido en 30min
  - Error rate > 5%
  - DB connection lost
  - Withdrawal queue growing

---

## FASE 2: ESCALA (Semanas 5-8) - "Ready for Users"

### 2.1 La Fortuna (Lottery)
- [ ] Completar smart contract (usar BingoGame como template)
- [ ] Frontend LotteryPage funcional
- [ ] VRF integration
- [ ] Tests

### 2.2 Subgraph / Indexer
- [ ] Deploy The Graph subgraph para indexar eventos de los 3 contratos
- [ ] Reemplazar polling del backend con subgraph queries
- [ ] Frontend lee historial de juegos del subgraph

### 2.3 Multi-RPC Failover
- [ ] Implementar fallback RPC provider (ethers FallbackProvider)
- [ ] Configurar 3+ RPC endpoints (Alchemy, Infura, QuickNode)
- [ ] Health check por RPC

### 2.4 Database Optimization
- [ ] Indices en queries frecuentes (wallet_address, draw_id, status)
- [ ] Connection pooling optimizado (pgbouncer si necesario)
- [ ] Particionamiento de tablas grandes (keno_games, bets)
- [ ] Backup automatico + point-in-time recovery

### 2.5 Frontend Improvements
- [ ] Error boundaries globales
- [ ] Transaction pending/confirmation UI
- [ ] Offline/network error handling
- [ ] PWA support (service worker)
- [ ] Analytics (Plausible/Fathom - privacy-first)

### 2.6 Compliance Foundations
- [ ] Terms of Service
- [ ] Privacy Policy
- [ ] Responsible Gaming page (limits, self-exclusion)
- [ ] Age verification (18+ confirmation)
- [ ] Jurisdiccion legal definida (no-US, no-EU)
- [ ] AML considerations (threshold monitoring)

---

## FASE 3: PROFESIONAL (Semanas 9-16) - "Competitive Product"

### 3.1 External Audit
- [ ] Contratar auditoria de seguridad profesional para contratos (CertiK, Trail of Bits, OpenZeppelin)
- [ ] Publicar reporte de auditoria
- [ ] Bug bounty program (Immunefi)

### 3.2 Upgrade Pattern
- [ ] Migrar contratos nuevos a UUPS proxy
- [ ] Timelock controller para upgrades
- [ ] Multi-sig owner (Gnosis Safe)
- [ ] Governor contract para cambios criticos

### 3.3 Advanced Features
- [ ] Referral system (on-chain o hibrido)
- [ ] VIP tiers con beneficios
- [ ] Torneos de Keno
- [ ] Chat en tiempo real (WebSocket)
- [ ] Mobile app (React Native wrapper)

### 3.4 Infrastructure Pro
- [ ] Staging environment (Railway + Amoy testnet)
- [ ] Blue-green deployments
- [ ] Database read replicas
- [ ] CDN optimization
- [ ] DDoS protection (Cloudflare Pro)

---

# PARTE 4: METRICAS DE EXITO

| Metrica | Actual | Fase 1 Target | Fase 3 Target |
|---------|--------|---------------|---------------|
| Test Coverage | ~20% | 70% | 90% |
| Uptime | Unknown | 99.5% | 99.9% |
| Deploy Time | Manual | < 10 min (CI) | < 5 min |
| Mean Time to Detect | Hours/Days | < 15 min | < 5 min |
| Mean Time to Recover | Hours | < 1 hour | < 15 min |
| Security Audit | Internal | Internal + Fixes | External (CertiK) |
| Contract Upgrade | Impossible | Planned | UUPS + Timelock |
| Settlement | STUB | On-chain VRF | On-chain VRF |
| RNG Trust | Server SHA-256 | VRF On-chain | VRF + External Audit |

---

# PARTE 5: PRIORIDAD DE EJECUCION

```
SEMANA 1:  C-02 + C-03 (Rotar credenciales)
           C-01 (Pausar + fix retryUnpaidBet)

SEMANA 2:  H-04 (Withdrawal verification)
           H-05 (Fresh permissions)
           M-03 (Integer arithmetic)

SEMANA 3:  H-01 + C-04 (Keno VRF migration planning)
           CI/CD pipeline

SEMANA 4:  H-02 (Geoblock fix)
           Monitoring setup
           Contract tests

SEMANA 5+: Fase 2 features
```

---

# RESUMEN EJECUTIVO

**Bolcoin es un proyecto con buena base arquitectonica** - los contratos usan patrones correctos (ReentrancyGuard, SafeERC20, VRF, exposure limits), el auth SIWE es solido, y la separacion frontend/backend/contracts es clara.

**Sin embargo, hay 4 bloqueadores criticos** que deben resolverse antes de considerar el producto "production-ready" con dinero real:

1. **retryUnpaidBet puede drenar el pool** - Fix urgente, pausar La Bolita ahora
2. **Credenciales expuestas** - Rotar TODO, riesgo de compromise activo
3. **Keno no es trustless** - SHA-256 server-side necesita migrar a VRF on-chain
4. **Settlement es stub** - El backend maneja balances ficticios para Keno

El plan de 3 fases lleva el proyecto de "MVP con bugs criticos" a "dApp profesional auditable" en ~16 semanas.
