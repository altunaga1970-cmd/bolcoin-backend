# PROJECT_STATE - Bolcoin dApp

## Que es
dApp de loteria y juegos de azar en Polygon PoS con USDT. Tres juegos: Keno (live), La Bolita (coming soon), La Fortuna (coming soon). Backend Node.js/Express + PostgreSQL en Railway. Frontend React/Vite en Cloudflare Pages. Smart contracts en Solidity con Chainlink VRF.

## Donde se quedo
- Keno MVP en produccion (sesiones, pool dinamico, provably fair SHA-256)
- Auditoria Phase 0 completada (7 blockers criticos resueltos)
- Phase 1 (CHECK constraints, rate limiting, unique sessions) completada
- Phase 2 UX (confirmacion, doble-click, wrong chain) completada
- Bingo backend implementado (services, routes, config, migration, scheduler)
- Bingo frontend completo (7 componentes, state machine, VRF, i18n 9 idiomas, ruta /bingo activa)
- ABI mismatch resuelto en codigo (contrato y backend coinciden en 5 params para settleKenoSession)
- 252 tests pasando (18 suites): unit tests + integration tests completos
- AUDITORIA PRE-PRODUCCION completada (2026-02-24) con 5 agentes especializados
- Fixes Fase 0+1 aplicados (10 fixes, 252 tests green):
  - [C3] settlementService.js: fix destructuring de pool (era undefined)
  - [C4] web3Auth.js: eliminado bypass de firma en development, requiere UNSAFE_SKIP_AUTH explicitamente
  - [C5] /api/dev/enable-bingo: renombrado a /api/admin/enable-bingo + protegido con adminAuth
  - [H7] resultProcessor.js: multiplicadores ahora usan GAME_RULES como fuente unica (antes: fijos 80 vs 65, centenas 500 vs 300, parles 900 vs 1000)
  - [H8] walletService.js: optimistic lock ahora verifica rowCount en recharge y adjustBalance
  - [H9] payoutService.js: optimistic lock ahora verifica rowCount en pago de premios
  - [M6] bingoResolverService.js: round sin cards ahora revierte a vrf_fulfilled (antes quedaba atrapado en resolving)
  - [M7] errorHandler.js: mensajes internos ocultos en produccion (500 -> "Error interno del servidor")
  - database.js: query logging deshabilitado en produccion, SSL configurable via DATABASE_SSL_REJECT_UNAUTHORIZED
  - .gitignore: agregado backend/.env y backend/.env.*

## Bloqueos
1. Settlement on-chain: contrato settleKenoSession es stub (solo emite evento, no mueve fondos) + feature flag keno_settlement_enabled=false
2. VRF real on-chain pendiente para Keno (actualmente SHA-256 server-side)
3. La Bolita y La Fortuna deshabilitados via feature flags (no implementados)
4. [CRITICO] LaBolitaGame.sol retryUnpaidBet permite doble pago (requiere fix en smart contract + redeploy)
5. [CRITICO] Credenciales de produccion expuestas en backend/.env (rotar: NOWPayments API key, DB password, JWT secret)
6. [CRITICO] directorio backend/ es codebase paralelo incompatible - Railway debe usar src/server.js
7. [CRITICO] bingoEventService.js tiene fix de getLogs sin commitear (necesario para Railway HTTP)
8. [HIGH] Frontend: USDT approval MaxUint256 en useBingoContract.js (debe ser monto exacto)
9. [HIGH] VRF Coordinator addresses inconsistentes entre scripts de deploy

## Proximos 3 pasos
1. Rotar credenciales expuestas + eliminar/archivar directorio backend/ + commitear fix getLogs en bingoEventService
2. Fix retryUnpaidBet en LaBolitaGame.sol (agregar b.payout=0 post-transfer) + plan de migracion + redeploy
3. Fix frontend: MaxUint256 approval en useBingoContract.js + runtime guard para zero-address contracts

## Ultima sesion: 2026-02-24
