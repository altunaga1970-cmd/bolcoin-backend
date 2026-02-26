# PROJECT_STATE - Bolcoin dApp

## Que es
dApp de loteria y juegos de azar en Polygon PoS con USDT. Cuatro juegos: Keno (live), Bingo (live), La Bolita (coming soon), La Fortuna (coming soon). Backend Node.js/Express + PostgreSQL en Railway. Frontend React/Vite en Cloudflare Pages. Smart contracts en Solidity con Chainlink VRF.

## Arquitectura
- **Backend**: `src/server.js` (Railway) - Node.js/Express + PostgreSQL
- **Frontend**: `bolcoin-frontend/` (submodulo git separado) -> repo `altunaga1970-cmd/bolcoin-frontend.git` (branch: main) -> Cloudflare Pages
- **Contratos**: `contracts/` - Solidity + Hardhat + Chainlink VRF
- **API URL produccion**: `https://bolcoin-backend-production.up.railway.app/api`
- **Frontend URL**: Cloudflare Pages (auto-deploy desde repo bolcoin-frontend)

## Estado actual (2026-02-25)

### Juegos en produccion
- **Keno**: Live. Sesiones, pool dinamico, provably fair SHA-256
- **Bingo**: Live. 4 salas, 24/7, scheduler cada 45s, feature flag habilitado

### Juegos pendientes
- **La Bolita**: Frontend existe (`Web3BettingPage.jsx`), smart contract desplegado pero con bugs criticos
- **La Fortuna**: Frontend parcial (`LotteryPage.jsx`), "Coming Soon"

### Fixes aplicados sesion 2026-02-25

#### NOWPayments eliminado (COMPLETADO)
- **Motivo**: No se usa en el proyecto. Depositos/retiros son on-chain via USDT en Polygon
- Eliminado: `src/services/nowPaymentsService.js`, `src/controllers/webhookController.js`
- Limpiado: `paymentController.js` (solo withdrawals + deposit history), `payments.js` route, `withdrawalService.js`
- Eliminado de `.env.example`: variables NOWPAYMENTS_*
- Eliminado test: `src/routes/__tests__/payments.test.js`
- `Payment.js` model conservado (tabla DB existe, historial)

#### Directorio frontend/ paralelo eliminado (COMPLETADO)
- Era codebase viejo (localhost/hardhat config), no el frontend real
- Frontend real: `bolcoin-frontend/` (submodule git -> Cloudflare Pages)

#### Directorio backend/ paralelo (YA NO EXISTIA)
- Verificado: fue eliminado en sesion anterior

#### MaxUint256 approval en useBingoContract.js (NO ERA BUG)
- Verificado: el codigo YA aprueba monto exacto (`totalCost`), no MaxUint256

#### Frontend submodule actualizado
- 5 commits de redesign nuevos: Admin, Keno, Bingo, La Fortuna, Results/Claims/History
- Parent repo actualizado para trackear commits hasta `1312426`

### Fixes aplicados sesion 2026-02-24

#### Cloudflare build fixes
- `d9898a8`: `git add src/i18n/` - directorio i18n no estaba trackeado (43 archivos)
- `28f024d`: `git add src/` - 59 archivos faltantes (BingoPage, componentes, hooks, ABIs)
- `700edc0`: `npm install` para sincronizar package-lock.json (i18next 25.8.5 vs 25.8.13)

#### Balance real vs datos de prueba (RESUELTO)
- **Problema**: DB backend tiene `users.balance = 1000` (datos de prueba). El frontend mostraba 1000 USDT en vez del balance real on-chain (~264 USDT)
- **`44b80b2`**: BalanceContext.jsx - priorizar `directBalance.usdtBalance` sobre backend para `balance` alias
- **`ae3d113`**: BalanceContext.jsx - override TODOS los exports: `effectiveBalance`, `balance`, `formattedContractBalance`, `formattedEffectiveBalance` con `realBalance` de blockchain
- **`9091664`**: Web3BettingPage.jsx (La Bolita) - su balance local fetch de `/wallet/balance-by-address` (DB) ahora prioriza `directBalance.usdt` de blockchain
- **Logica**: `directBalance` hook lee USDT directamente del contrato ERC20 via RPC publico (chain 137 Polygon). Si > 0, se usa como fuente de verdad

#### Bingo 403 FEATURE_DISABLED (RESUELTO)
- **Problema**: `requireFlag('bingo_enabled')` lee de tabla `feature_flags`, pero migracion solo escribia a `game_config`
- **`481b844`** (backend): Nueva migracion `add-bingo-feature-flag.js` inserta `bingo_enabled=true` en `feature_flags`
- Tambien fix en `enable-bingo.js` y endpoint `/api/admin/enable-bingo` para escribir a AMBAS tablas
- Railway logs confirman: `[BingoScheduler] Starting 4-room staggered scheduler`

#### ConfigContext staging mode (RESUELTO)
- `.env.production` tenia `VITE_API_URL=` (vacio) -> ConfigContext entraba en "Staging mode"
- Fix: `VITE_API_URL=https://bolcoin-backend-production.up.railway.app/api`

#### Redesign Homepage (COMPLETADO)
- **`8fc4741`**: Redesign completo Apple-inspired minimalist "Dark Gold Theater"
  - Hero: 4 game cards prominentes con colores de acento, iconos SVG, animaciones spring hover
  - La Bolita y La Fortuna YA NO son invisibles (antes: outline buttons oscuros sobre fondo oscuro)
  - Glass morphism: `backdrop-filter: blur(20px)`, bordes sutiles `rgba(255,255,255,0.06)`
  - Scroll animations: IntersectionObserver fade-in por seccion
  - Nav: frosted glass effect
  - Tipografia: DM Sans + JetBrains Mono
  - Variables: transiciones spring, colores de acento por juego (`--color-bolita/fortuna/keno/bingo`)
  - Responsive: 4-col > 2-col > 1-col
- **`ccc1e28`**: Hero title cambiado de "LA BOLITA" a "BOLCOIN" en 10 idiomas

### Archivos clave modificados (frontend)
- `src/styles/variables.css` - Design system completo (colores, tipografia, transiciones, glass morphism)
- `src/pages/public/HomePage.jsx` + `HomePage.css` - Homepage redesign completo
- `src/components/layout/MainNav.jsx` + `MainNav.css` - Nav frosted glass
- `src/components/common/Button/Button.css` - Botones refinados con hover lift
- `src/components/layout/Layout.css` - Footer minimalista
- `src/contexts/BalanceContext.jsx` - Balance real blockchain como fuente de verdad
- `src/pages/user/Web3BettingPage.jsx` - Balance La Bolita usa directBalance
- `src/i18n/locales/*/games.json` - hero_title = "BOLCOIN" (10 idiomas)
- `.env.production` - VITE_API_URL configurada

### Archivos clave modificados (backend)
- `src/db/migrations/add-bingo-feature-flag.js` - Nueva migracion
- `src/db/migrations/enable-bingo.js` - Fix: escribe a feature_flags + game_config
- `src/db/init.js` - Registra nueva migracion
- `src/app.js` - Endpoint enable-bingo escribe a ambas tablas

## Bloqueos conocidos
1. **Settlement on-chain**: contrato settleKenoSession es stub (solo emite evento, no mueve fondos) + feature flag keno_settlement_enabled=false
2. **VRF real on-chain**: pendiente para Keno (actualmente SHA-256 server-side)
3. ~~**La Bolita retryUnpaidBet**: fix aplicado en codigo (b.payout=0 antes del transfer). REQUIERE REDEPLOY del contrato~~ FIX EN CODIGO
4. **Credenciales**: rotar en Railway: DB password, JWT secret, OPERATOR_PRIVATE_KEY. JWT_SECRET removido de .env.example
5. ~~**directorio backend/**: eliminado~~ RESUELTO
6. ~~**Frontend approval**: verificado, usa monto exacto~~ RESUELTO
7. **VRF addresses**: inconsistentes entre scripts de deploy

## Sistema de balances (importante)
- `useDirectBalance` hook: lee USDT directamente del contrato ERC20 via RPC publico
- `BalanceContext`: computa `realBalance` = directBalance si > 0, sino effectiveBalance del backend
- Todos los exports (`balance`, `effectiveBalance`, `formattedContractBalance`) usan `realBalance`
- `Web3BettingPage` tiene su propio fetch de balance pero ahora prioriza directBalance
- DB backend tiene datos de prueba (users.balance = 1000) - NO confiar como display

## Feature flags (importante)
- `feature_flags` tabla: usada por middleware `requireFlag()` -> 403 si no existe/deshabilitado
- `game_config` tabla: usada por BingoScheduler y otros servicios
- Son TABLAS DIFERENTES - hay que escribir a ambas al habilitar un juego
- Flags activos: `bingo_enabled=true`, `game_keno=true`, `game_bolita`, `game_fortuna`

## Plan de migracion: retryUnpaidBet (LaBolitaGame.sol)
**Bug**: `retryUnpaidBet(betId)` no marca la apuesta como pagada. Se puede llamar N veces y drenar el pool.
**Fix aplicado**: `b.payout = 0` antes del `safeTransfer` (CEI pattern). No requiere campo nuevo.
**Estado**: FIX EN CODIGO. Requiere: compilar, test en Amoy, deploy a mainnet.
**Proceso de deploy**:
1. Pausar La Bolita via `pause()` en contrato actual
2. Resolver bets pendientes del contrato viejo
3. Deploy nuevo contrato con fix
4. Actualizar CONTRACT_ADDRESS en Railway
5. Transferir fondos del pool al nuevo contrato

## Fixes aplicados sesion 2026-02-25 (segunda parte)

### Security Fixes
- **C-01 retryUnpaidBet**: `b.payout = 0` antes del transfer (CEI pattern) - `LaBolitaGame.sol:484`
- **C-02 JWT_SECRET**: Removido de `.env.example`, reemplazado con placeholder
- **L-04 JWT_SECRET export**: Removido de `module.exports` en `auth.js`
- **H-05 Admin permissions**: `adminAuth.js` ahora lee permisos frescos de config, no del JWT
- **H-02 Geoblock fail-close**: En produccion, bloquea si geo lookup falla (configurable con GEOBLOCK_FAIL_OPEN)
- **L-02 Geo API HTTPS**: Cambiado primario a ipapi.co (HTTPS), ip-api.com como fallback
- **H-03 Rate limiting**: Keno play reducido a 6/min por wallet (era 10)

### Auditoria completa
- `AUDIT_PROFESSIONAL_2026-02-25.md` - Reporte integral con hallazgos y plan de 3 fases

## Proximos pasos
1. **URGENTE**: Rotar credenciales en Railway (JWT_SECRET, DB password, OPERATOR_PRIVATE_KEY)
2. **URGENTE**: Pausar LaBolita en mainnet + compilar/test/deploy contrato con fix
3. Migrar Keno a VRF on-chain (contrato ya lo soporta)
4. CI/CD pipeline (GitHub Actions)
5. Monitoring + alertas (Discord/Telegram webhook)
6. Ver plan completo en AUDIT_PROFESSIONAL_2026-02-25.md

## Ultima sesion: 2026-02-25
