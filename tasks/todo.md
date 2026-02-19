# Bolcoin - TODO

## Sesion 2026-02-05

### Completado
- [x] Diagnostico de estructura del repositorio
- [x] Identificar frontend activo: `frontend/` (no `bolcoin-frontend/`)
- [x] Corregir `.env.production`: REACT_APP_* -> VITE_*
- [x] Corregir `wagmi.js`: appName "La Bolita" -> "Bolcoin"
- [x] Agregar VITE_WALLETCONNECT_PROJECT_ID a .env.production

### Pendiente
- [x] Verificar build: `cd frontend && npm run build` - OK (25.71s)
- [x] Implementar fallback de balance directo (sin backend)
- [x] Hook useDirectBalance.js creado
- [x] BalanceContext modificado con fallback
- [x] KenoPage muestra banner cuando usa balance directo
- [x] Probar wallet connect en preview local - OK
- [x] Probar wallet connect en movil (MetaMask mobile) - OK
- [x] Verificar que muestra balance USDT - OK (4.10 USDT en Amoy testnet)
- [ ] Configurar variables en Cloudflare Dashboard
- [ ] Confirmar que Cloudflare Pages usa branch y carpeta correctos

### Configuracion Cloudflare Pages (pendiente)
Variables a configurar en dashboard:
- `VITE_API_URL` = URL del backend (cuando este disponible)
- `VITE_CHAIN_ID` = 80002 (Amoy) o 137 (Polygon mainnet)

Build settings:
- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: `frontend`

---

## Proximas tareas (backlog)
- [ ] Backend: desplegar en Railway/Render/etc
- [ ] Contratos: desplegar en Amoy testnet
- [ ] Conectar frontend con backend real
- [ ] Pruebas E2E de flujo Keno completo
