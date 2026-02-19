# Engineering Standards - Bolcoin

## Stack
- Backend: Node.js + Express + PostgreSQL (Railway)
- Frontend: React + Vite + wagmi + RainbowKit (Cloudflare Pages)
- Blockchain: Polygon PoS (Chain ID 137), USDT, Chainlink VRF
- Contracts: Solidity + Hardhat + OpenZeppelin

## Reglas
1. Cambios minimos: no reescribir, no cambiar stack
2. Non-custodial: nunca custodiar fondos, claves, o seeds del usuario
3. SQL parametrizado siempre (nunca string interpolation)
4. FOR UPDATE lock en toda transaccion financiera
5. CHECK constraints en balances (>= 0)
6. Feature flags para juegos nuevos (deshabilitados por defecto)
7. Rate limiting en endpoints sensibles
8. Wallet signature obligatoria (sin fallback address-only)
9. Migraciones idempotentes (IF NOT EXISTS / ON CONFLICT)
10. Audit log en acciones admin

## Convenciones
- Commits: tipo(scope): mensaje (ej: fix(keno): prevent negative pool)
- Branches: feature/, fix/, security/
- Tests: *.test.js junto al archivo
