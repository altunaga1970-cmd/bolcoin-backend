# SCOPE_CONTRACT - Bolcoin dApp

## Alcance del proyecto
- Backend API para 3 juegos: Keno, La Bolita, La Fortuna
- Frontend React SPA con wallet connection (Polygon)
- Smart contracts para depositos, retiros, y VRF
- Admin panel con ops dashboard y feature flags

## Restricciones (NO hacer sin aprobacion explicita)
- NO cambiar stack (Node.js/Express/PostgreSQL/React/Vite/Polygon)
- NO custodiar fondos de usuario (non-custodial)
- NO almacenar private keys, seeds, o mnemonics
- NO reescribir modulos existentes (cambios minimos)
- NO cambiar arquitectura de autenticacion (wallet signature + SIWE)
- NO modificar smart contracts deployados sin plan de migracion

## Scope Change requiere
1. Justificacion escrita
2. Senior Review Board approval
3. Plan de rollback
4. Actualizacion de este contrato

## Ultima revision: 2026-02-16
