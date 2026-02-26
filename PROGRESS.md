# Progreso de Implementacion - Bolcoin dApp

## Flujos Principales

---

### 1. Flujo de Autenticacion (Wallet Signature)

```
1. Usuario conecta wallet (RainbowKit / MetaMask)
2. Frontend detecta cuenta via wagmi useAccount()
3. Auto-sign: firma mensaje "Bolcoin Auth: {address} at {dayNumber}"
   - dayNumber = Math.floor(Date.now() / 86400000)
   - Se guarda en localStorage: walletSignature, walletMessage, walletSignatureAddr
4. Cada request API envia headers:
   - x-wallet-address: 0x...
   - x-wallet-signature: 0x...
   - x-wallet-message: "Bolcoin Auth: 0x... at 12345"
5. Backend (web3Auth.js) verifica:
   - ethers.verifyMessage(message, signature) === address
   - Formato del mensaje: /^Bolcoin Auth: (0x[a-f0-9]{40}) at (\d+)$/
   - Expiracion: 2 dias desde dayNumber
6. Si usuario no existe en DB → se crea con balance 0
7. req.user = { address, userId, role }
```

**Archivos clave:**
- Frontend: `Web3Context.jsx` (auto-sign), `api/index.js` (interceptor headers)
- Backend: `src/middleware/web3Auth.js` (authenticateWallet, optionalWalletAuth)

---

### 2. Flujo de Autenticacion Admin (SIWE)

```
1. Admin navega a /admin/login
2. Conecta wallet → firma mensaje SIWE (Sign-In with Ethereum)
3. Backend verifica firma + address esta en ADMIN_WALLETS env var
4. Genera JWT con rol admin (duracion: ADMIN_SESSION_DURATION)
5. Frontend guarda JWT en localStorage (adminToken)
6. Requests admin envian: Authorization: Bearer {jwt}
```

**Archivos clave:**
- Frontend: `AdminAuthContext.jsx`, `pages/admin/AdminLoginPage.jsx`
- Backend: `src/middleware/adminAuth.js`, `src/routes/adminAuth.js`

**IMPORTANTE:** ADMIN_WALLETS vacio = ningun admin en produccion (en dev permite cualquier wallet)

---

### 3. Flujo del Juego Keno

```
INICIO DE SESION:
1. Usuario entra a /keno (o / que redirige a Keno)
2. Frontend llama POST /api/keno/session/start
3. Backend crea o retorna sesion activa en keno_sessions
4. Frontend muestra balance efectivo (contractBalance + sessionNetResult)

JUGAR:
1. Usuario selecciona 1-10 numeros del grid (1-80)
2. Click "Apostar 1 USDT" → modal de confirmacion
3. Confirma → POST /api/keno/play { numbers: [...], amount: 1 }
4. Backend (dentro de transaccion DB con FOR UPDATE):
   a. Valida numeros (enteros, rango 1-80, unicos)
   b. Obtiene sesion con lock: SELECT ... FOR UPDATE
   c. Obtiene balance usuario con lock: SELECT ... FOR UPDATE
   d. Verifica balance >= betAmount
   e. Genera nonce atomico
   f. Genera 20 numeros aleatorios (SHA-256 provably fair)
   g. Calcula hits, multiplier, payout (con cap dinamico del pool)
   h. Aplica fee (12% sobre perdidas netas)
   i. Actualiza: user balance, session stats, keno_pool, keno_games
5. Frontend recibe resultado y muestra panel de resultado
6. Actualiza balance efectivo

SETTLEMENT (al salir):
1. Frontend llama POST /api/keno/session/settle
2. Backend cierra sesion, ajusta balance final del usuario
3. Si falla: cron server-side auto-settle despues de 24h inactividad
```

**Rate limit:** 10 jugadas por minuto por wallet

**Archivos clave:**
- Frontend: `hooks/useKenoGame.js`, `pages/user/KenoPage.jsx`
- Backend: `src/routes/keno.js`, `src/services/kenoService.js`, `src/services/kenoSessionService.js`

---

### 4. Flujo del Pool de Premios (Cap Dinamico)

```
Pool Balance → determina Max Payout
- maxPayout = min(poolBalance * MAX_PAYOUT_RATIO, ABSOLUTE_MAX_PAYOUT)
- MAX_PAYOUT_RATIO = 10% del pool
- ABSOLUTE_MAX_PAYOUT = $10,000
- MIN_POOL_BALANCE = $500

Ejemplo:
- Pool = $5,000 → Max Payout = $500
- Pool = $100,000 → Max Payout = $10,000 (cap absoluto)

Cada jugada:
- Apuesta va al pool (betAmount)
- Payout sale del pool (capped por max payout)
- Pool nunca puede ir negativo (GREATEST(0, ...) + CHECK constraint)
```

**Archivos clave:**
- Backend: `src/services/kenoService.js` (playKeno), `src/services/kenoPoolHealthService.js`

---

### 5. Flujo Admin Ops Panel

```
1. Admin autenticado navega a /admin/ops
2. Sidebar: Overview | Finance | System | Risk | Legacy
3. Overview: health, DB status, uptime, totals, pending withdrawals, keno pool
4. Finance: depositos, retiros, fees, posicion neta
5. System: health, DB, uptime, feature flags
6. Risk Controls: toggles para maintenance_mode, withdrawals, deposits, keno, bolita, fortuna
7. Legacy: links a paginas admin antiguas (/admin/draws, /admin/users, etc.)
```

**Archivos clave:**
- Frontend: `pages/admin/OpsDashboard.jsx`, `components/admin/AdminLayout.jsx`
- Backend: `src/routes/adminOps.js`

---

## Estructura de Archivos

### Backend (gold/ → Railway)

```
src/
├── app.js                          # Express setup, todas las rutas
├── server.js                       # Inicio servidor + DB init
├── db.js                           # Pool PostgreSQL exportado
├── config/
│   ├── database.js                 # Pool config + degraded mode
│   ├── constants.js                # Reglas del juego
│   ├── auth.js                     # JWT config
│   ├── prizeConfig.js              # Tabla de premios
│   └── adminWallets.js             # ADMIN_WALLETS parsing
├── middleware/
│   ├── web3Auth.js                 # authenticateWallet (signature obligatoria)
│   ├── adminAuth.js                # authenticate + requireAdmin (JWT)
│   ├── siweAuth.js                 # SIWE login flow
│   ├── auth.js                     # Legacy JWT auth
│   ├── featureFlag.js              # requireFlag middleware
│   ├── geoblock.js                 # Geoblocking (desactivable)
│   ├── validation.js               # express-validator
│   └── errorHandler.js             # Global error handler
├── routes/
│   ├── keno.js                     # /api/keno/* (play, session, verify, admin)
│   ├── adminOps.js                 # /api/admin/ops/* (summary, toggles)
│   ├── adminAuth.js                # /api/admin/auth/* (SIWE login)
│   ├── payments.js                 # /api/payments/* (withdrawals, deposit history)
│   ├── bankroll.js                 # /api/bankroll/*
│   ├── claims.js                   # /api/claims/*
│   └── ... (auth, wallet, draw, bet, lottery, admin*)
├── services/
│   ├── kenoService.js              # Logica core del juego (playKeno)
│   ├── kenoSessionService.js       # Sesiones + settlement
│   ├── kenoVrfService.js           # VRF / provably fair
│   ├── kenoPoolHealthService.js    # Pool health + stats
│   ├── gameConfigService.js        # Config dinamica del juego
│   ├── featureFlagService.js       # Feature flags CRUD
│   ├── bankrollService.js          # Bankroll management
│   └── ... (wallet, payout, claims, lottery, etc.)
├── db/
│   ├── init.js                     # Schema + migrations runner
│   ├── schema.sql                  # Base schema (users, draws, bets, transactions)
│   └── migrations/
│       ├── 002-add-audit-logs.sql
│       ├── ...
│       ├── add-keno-tables.js
│       ├── add-keno-sessions.js
│       ├── add-keno-vrf.js
│       ├── add-feature-flags.js
│       └── add-keno-security-fixes.js  # CHECK constraints + unique index
└── scheduler/
    └── kenoVrfRequester.js         # VRF batch processor
```

### Frontend (gold/bolcoin-frontend/ → Cloudflare Pages)

```
src/
├── App.js                          # Router + providers
├── main.jsx                        # Entry point
├── contexts/
│   ├── Web3Context.jsx             # Wallet connection + auto-sign auth
│   ├── AdminAuthContext.jsx        # Admin SIWE auth
│   ├── BalanceContext.jsx          # Balance (contract + session)
│   ├── ToastContext.jsx            # Notificaciones
│   ├── BetContext.jsx              # Estado de apuestas
│   ├── DrawContext.jsx             # Sorteos
│   ├── WalletContext.jsx           # Wallet operations
│   ├── ConfigContext.jsx           # App config
│   └── AuthContext.jsx             # Legacy auth
├── hooks/
│   ├── useKenoGame.js              # Estado + logica Keno (hook principal)
│   ├── useDirectBalance.js         # Balance directo de wallet
│   ├── useContract.js              # Interaccion smart contract
│   └── ... (useAuth, useWallet, useBets, useDraws, etc.)
├── api/
│   ├── index.js                    # Axios instance + interceptor (wallet headers)
│   ├── kenoApi.js                  # Keno endpoints
│   ├── adminOpsApi.js              # Admin ops endpoints
│   ├── adminAuthApi.js             # Admin SIWE login
│   └── ... (auth, wallet, draw, bet, payment, claims, jackpot)
├── pages/
│   ├── user/
│   │   ├── KenoPage.jsx            # Pagina principal del juego
│   │   ├── KenoPage.css
│   │   ├── Web3WalletPage.jsx      # Wallet del usuario
│   │   ├── HistoryPage.jsx
│   │   ├── ClaimsPage.jsx
│   │   └── ReferralsPage.jsx
│   ├── admin/
│   │   ├── AdminLoginPage.jsx      # Login SIWE
│   │   ├── OpsDashboard.jsx        # Overview ops
│   │   ├── FinanceDashboard.jsx    # Finanzas
│   │   ├── SystemStatus.jsx        # Estado del sistema
│   │   ├── RiskControls.jsx        # Toggles feature flags
│   │   ├── LegacyHome.jsx          # Links a admin legacy
│   │   └── ... (ManageDraws, ManageUsers, Withdrawals, etc.)
│   └── info/
│       └── ... (HowItWorks, FAQ, legal pages)
├── components/
│   ├── admin/
│   │   └── AdminLayout.jsx         # Layout sidebar admin
│   ├── layout/
│   │   ├── Header.jsx              # Header global (con boton Admin)
│   │   └── Layout.css
│   ├── web3/
│   │   └── ConnectWallet.jsx       # RainbowKit connect
│   └── common/
│       └── ... (Button, Spinner, etc.)
└── wagmi.config.js                 # wagmi + RainbowKit config (Polygon)
```

---

## Base de Datos (PostgreSQL)

### Tablas Principales
- `users` — wallet_address, balance, role (CHECK balance >= 0)
- `draws` — sorteos programados (La Bolita)
- `bets` — apuestas La Bolita (fijos, centenas, parles, corrido)
- `transactions` — auditoria de todas las transacciones
- `game_settings` — configuracion del juego

### Tablas Keno
- `keno_games` — cada jugada individual (numeros, resultado, payout)
- `keno_sessions` — sesiones por wallet (UNIQUE index en activas)
- `keno_pool` — balance del pool de premios (CHECK balance >= 0)
- `keno_vrf_batches` — batches de VRF para fairness

### Tablas Admin/Sistema
- `audit_logs` — logs de acciones admin
- `feature_flags` — feature flags del sistema
- `payments` — pagos NOWPayments
- `withdrawals` — retiros pendientes/completados
- `operator_fees` — fees cobrados

---

## Variables de Entorno Requeridas

### Criticas (produccion)
```
DATABASE_URL=postgresql://...
ADMIN_WALLETS=0x...,0x...          # Wallets admin separadas por coma
SESSION_SECRET=random-secret
SIWE_DOMAIN=tu-dominio.com
RPC_URL=https://polygon-rpc.com
CONTRACT_ADDRESS=0x...
TOKEN_ADDRESS=0xc2132D05D31c914a87C6611C10748AEb04B58e8F
FRONTEND_URL=https://tu-frontend.pages.dev
ALLOWED_ORIGINS=https://tu-frontend.pages.dev
```

### Frontend (.env)
```
VITE_API_URL=https://tu-backend.railway.app
VITE_WALLETCONNECT_PROJECT_ID=...
```

---

## Ultima actualizacion: 2026-02-10
