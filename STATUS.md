# Estado Actual del Proyecto - Bolcoin dApp

## Resumen Ejecutivo

| Componente | Estado | Progreso |
|------------|--------|----------|
| **Backend (Node.js/Express)** | Produccion (Railway) | **100%** |
| **Frontend (React/Vite)** | Produccion (Cloudflare Pages) | **100%** |
| **Base de Datos (PostgreSQL)** | Produccion (Railway) | **100%** |
| **Smart Contracts (Solidity)** | Polygon Mainnet | **80%** |
| **Auth (SIWE + Wallet Signature)** | Produccion | **100%** |
| **Juego Keno** | Produccion (auditado) | **100%** |
| **Admin Panel (Ops/Finanzas)** | Produccion | **100%** |
| **La Bolita / Fortuna** | Coming Soon (deshabilitado) | **0%** |

---

## Arquitectura General

```
Usuario (Browser)
    |
    v
[Cloudflare Pages] -- bolcoin-frontend (React + Vite)
    |                   - Wallet: wagmi + RainbowKit (Polygon)
    |                   - Auth: Firma criptografica (day-based)
    |                   - Game: Keno (1-80, 1 USDT fijo)
    |
    v (HTTPS API calls con x-wallet-signature headers)
    |
[Railway] -- bolcoin-backend (Express + PostgreSQL)
    |           - Auth: SIWE admin + wallet signature users
    |           - Keno: sesiones virtuales, settlement batch
    |           - Pool: balance dinamico, cap de payout
    |           - VRF: SHA-256 provably fair (on-chain VRF pendiente)
    |
    v
[Polygon Mainnet]
    - USDT (0xc2132D05D31c914a87C6611C10748AEb04B58e8F)
    - Contract: BolcoinGame (depositos/retiros on-chain)
```

---

## Deployment

| Servicio | Plataforma | URL |
|----------|-----------|-----|
| Frontend | Cloudflare Pages | bolcoin-frontend repo (main branch) |
| Backend | Railway | bolcoin-backend repo (master branch) |
| Database | Railway PostgreSQL | Interno (DATABASE_URL) |
| Blockchain | Polygon PoS | Chain ID 137 |

---

## Repositorios Git

| Repo | Branch | Plataforma |
|------|--------|------------|
| `bolcoin-backend` (raiz gold/) | `master` | GitHub → Railway |
| `bolcoin-frontend` (gold/bolcoin-frontend/) | `main` | GitHub → Cloudflare Pages |

---

## Seguridad Implementada (Post-Auditoria)

### Fase 0 - Blockers Criticos (COMPLETADO)
- [x] Wallet signature obligatoria en cada request (day-based expiration)
- [x] Eliminado endpoint GET /session/settle sin autenticacion
- [x] Eliminada clave privada hardcodeada (DEFAULT_PRIVATE_KEY)
- [x] ADMIN_WALLETS vacio = sin admin en produccion (solo dev)
- [x] Balance inicial de nuevo usuario = 0 (era 1000)
- [x] Settlement on-chain deshabilitado (ABI mismatch 3 vs 5 params)
- [x] FOR UPDATE lock en balance check atomico (race condition fix)
- [x] SQL injection corregido (parameterized queries con make_interval)

### Fase 1 - HIGH Priority (COMPLETADO)
- [x] CHECK(balance >= 0) constraint en keno_pool y users
- [x] Unique partial index: una sesion activa por wallet
- [x] Rate limiting: 10 jugadas/min por wallet en /play
- [x] Pool balance usa GREATEST(0, ...) para prevenir negativo

### Fase 2 - UX Critico (COMPLETADO)
- [x] Modal de confirmacion antes de apostar
- [x] Proteccion doble-click con ref mutex
- [x] Validacion de red antes de jugar (wrong chain blocked)
- [x] Panel de error con retry/clear
- [x] Boton muestra monto real "Apostar 1 USDT"
- [x] Toast cuando max numeros alcanzado
- [x] Fix layout tablet (grid no se esconde)

### Pendiente (Fase 3 - Post-Launch)
- [ ] VRF real on-chain (actualmente SHA-256 server-side)
- [ ] Commit-reveal para fairness absoluta
- [ ] Loss limits / responsible gaming
- [ ] Settlement on-chain (requiere fix ABI del contrato)

---

## Ultima actualizacion: 2026-02-10
