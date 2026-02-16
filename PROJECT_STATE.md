# PROJECT_STATE - Bolcoin dApp

## Que es
dApp de loteria y juegos de azar en Polygon PoS con USDT. Tres juegos: Keno (live), La Bolita (coming soon), La Fortuna (coming soon). Backend Node.js/Express + PostgreSQL en Railway. Frontend React/Vite en Cloudflare Pages. Smart contracts en Solidity con Chainlink VRF.

## Donde se quedo
- Keno MVP en produccion (sesiones, pool dinamico, provably fair SHA-256)
- Auditoria Phase 0 completada (7 blockers criticos resueltos)
- Phase 1 (CHECK constraints, rate limiting, unique sessions) completada
- Phase 2 UX (confirmacion, doble-click, wrong chain) completada
- 23 archivos modificados sin commitear (feature flags, lottery, keno security, bolita indexer)

## Bloqueos
1. Settlement on-chain deshabilitado (ABI mismatch contrato 3 params vs backend 5 params)
2. VRF real on-chain pendiente (actualmente SHA-256 server-side)
3. Zero test coverage en backend
4. La Bolita y La Fortuna deshabilitados via feature flags (no implementados en frontend funcional)

## Proximos 3 pasos
1. Revisar y commitear los 23 archivos modificados (staging limpio)
2. Escribir tests para servicios criticos (kenoService, betService, bankrollService)
3. Resolver ABI mismatch para habilitar settlement on-chain

## Ultima sesion: 2026-02-16
