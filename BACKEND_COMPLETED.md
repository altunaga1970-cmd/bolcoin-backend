# Backend Bolcoin - Referencia Completa

## API Endpoints

### Salud
```
GET  /                              → { status: 'ok', version, uptime }
GET  /health                        → { status: 'healthy', db, uptime }
```

### Autenticacion Usuario (wallet signature)
```
Todas las rutas protegidas requieren headers:
  x-wallet-address: 0x...
  x-wallet-signature: 0x...
  x-wallet-message: "Bolcoin Auth: 0x... at {dayNumber}"
```

### Autenticacion Admin (SIWE + JWT)
```
POST /api/admin/auth/nonce          → { nonce } (para SIWE)
POST /api/admin/auth/verify         → { token, admin } (verifica firma SIWE)
GET  /api/admin/auth/me             → { admin } (verifica JWT)
POST /api/admin/auth/logout         → { success }

Todas las rutas /api/admin/* requieren header:
  Authorization: Bearer {jwt}
```

### Config Publica
```
GET  /api/public-config             → { config } (sin auth)
GET  /api/keno/config               → { payoutTable, betAmount, maxPayout, pool }
```

### Keno - Juego (requiere wallet auth + feature flag game_keno)
```
GET  /api/keno/balance              → { contractBalance, effectiveBalance }
POST /api/keno/play                 → { gameId, drawnNumbers, hits, payout, ... }
     Body: { numbers: [1,5,10,...], amount: 1 }
     Rate limit: 10/min por wallet
GET  /api/keno/history              → [{ gameId, selectedNumbers, hits, payout, ... }]
     Query: ?limit=20 (max 100)
GET  /api/keno/verify/:gameId       → { serverSeed, clientSeed, nonce, ... } (provably fair)
```

### Keno - Sesion (requiere wallet auth + feature flag)
```
POST /api/keno/session/start        → { sessionId, balances }
GET  /api/keno/session              → { hasActiveSession, session, balances }
POST /api/keno/session/settle       → { settled, netResult }
```

### Keno - Admin
```
GET  /api/keno/admin/stats          → { totalGames, totalWagered, ... }
GET  /api/keno/admin/pool           → { pool, sessions, health }
GET  /api/keno/admin/sessions       → [{ id, wallet, status, netResult, ... }]
GET  /api/keno/admin/pool-history   → [{ timestamp, balance, ... }]
GET  /api/keno/admin/vrf/stats      → { pending, completed, system }
POST /api/keno/admin/vrf/batch      → { batchId, gamesProcessed }
```

### Admin Ops
```
GET  /api/admin/ops/summary         → { health, db, uptime, totals, pendingWithdrawals, kenoPool, flags }
GET  /api/admin/ops/toggles         → { maintenance_mode, feature_withdrawals, game_keno, ... }
POST /api/admin/ops/toggles         → { key, enabled } → actualiza flag + audit log
```

### Wallet
```
GET  /api/wallet/balance            → { balance, pendingBets }
GET  /api/wallet/transactions       → [{ type, amount, balanceBefore, balanceAfter, ... }]
```

### Pagos (NOWPayments)
```
POST /api/payments/create           → { paymentUrl, paymentId }
GET  /api/payments/status/:id       → { status, amount }
POST /api/payments/ipn              → webhook callback
```

### Sorteos (La Bolita - Coming Soon)
```
GET  /api/draws/active              → [{ id, drawNumber, scheduledTime, status }]
GET  /api/draws/upcoming            → [{ id, drawNumber, scheduledTime }]
GET  /api/draws/completed           → [{ id, drawNumber, winningNumber }]
GET  /api/draws/:id                 → { draw details }
GET  /api/draws/:id/results         → { winners, stats }
```

### Apuestas (La Bolita - Coming Soon)
```
POST /api/bets/place                → { bet, transaction }
GET  /api/bets/my-bets              → [{ id, gameType, betNumber, amount, status }]
GET  /api/bets/stats                → { totalBets, totalWon, totalLost }
```

### Bankroll
```
GET  /api/bankroll/status           → { balance, exposure, health }
GET  /api/bankroll/exposure         → { currentExposure, maxExposure }
```

### Claims
```
GET  /api/claims                    → [{ id, amount, status }]
POST /api/claims/submit             → { claimId }
```

### Admin Legacy
```
POST /api/admin/draws               → crear sorteo
PUT  /api/admin/draws/:id/results   → ingresar resultado
GET  /api/admin/users               → listar usuarios
PUT  /api/admin/users/:id/balance   → ajustar balance
GET  /api/admin/bets                → listar apuestas
GET  /api/admin/statistics          → estadisticas generales
GET  /api/admin/dashboard/overview  → overview completo
GET  /api/admin/audit               → audit logs
GET  /api/admin/flags               → feature flags
POST /api/admin/flags               → crear/actualizar flag
```

---

## Middleware Pipeline

```
Request → CORS → Helmet → Geoblock → Rate Limit → JSON Parser
    → Route Handler
        → authenticateWallet (user routes) / authenticate+requireAdmin (admin routes)
        → requireFlag('game_keno') (keno routes)
        → Controller/Handler
    → Error Handler → Response
```

### authenticateWallet (web3Auth.js)
1. Lee headers: x-wallet-address, x-wallet-signature, x-wallet-message
2. Valida formato address: /^0x[a-f0-9]{40}$/i
3. Valida formato mensaje: /^Bolcoin Auth: (0x[a-f0-9]{40}) at (\d+)$/
4. Verifica signature con ethers.verifyMessage()
5. Verifica expiracion: dayNumber dentro de 2 dias
6. Busca o crea usuario en DB (balance inicial = 0)
7. Sets req.user = { address, userId, role }

### authenticate + requireAdmin (adminAuth.js)
1. Lee header: Authorization: Bearer {jwt}
2. Verifica JWT con SESSION_SECRET
3. Verifica address esta en ADMIN_WALLETS
4. Sets req.admin = { address, role }

---

## Migraciones (src/db/init.js)

Ejecutadas automaticamente al iniciar el servidor.
Todas son idempotentes (IF NOT EXISTS / ON CONFLICT).

### SQL Migrations
1. `002-add-audit-logs.sql`
2. `003-add-claims-tables.sql`
3. `004-add-prize-config-tables.sql`
4. `005-update-draw-status-check.sql`
5. `006-add-winning-columns.sql`
6. `007-create-operator-fees-table.sql`
7. `008-add-risk-management-tables.sql`
8. `009-add-wallet-address.sql`
9. `011-bankroll-exposure-system.sql`
10. `012-admin-metrics-referrals.sql`
11. `013-add-lottery-columns.sql`

### JS Migrations
1. `add-payments-tables.js`
2. `add-vrf-columns.js`
3. `add-keno-tables.js`
4. `add-keno-sessions.js`
5. `add-keno-vrf.js`
6. `add-feature-flags.js`
7. `add-keno-security-fixes.js` — CHECK constraints + unique index

---

## Seguridad

### Protecciones Activas
- Wallet signature obligatoria (no optional, no fallback)
- FOR UPDATE locks en transacciones financieras
- CHECK(balance >= 0) en users y keno_pool
- Rate limiting: 10 plays/min por wallet, auth rate limit global
- Parametrized queries (sin string interpolation)
- CORS restringido a FRONTEND_URL
- Helmet headers
- Geoblock configurable

### Decisiones de Seguridad
- Sin clave privada hardcodeada (requiere OPERATOR_PRIVATE_KEY en env)
- Settlement on-chain deshabilitado (ABI mismatch pendiente de fix)
- Sessions auto-settle por cron despues de 24h
- ADMIN_WALLETS vacio = sin admin en prod (seguro por defecto)
- Balance nuevo usuario = 0 (no 1000)

---

## Ultima actualizacion: 2026-02-10
