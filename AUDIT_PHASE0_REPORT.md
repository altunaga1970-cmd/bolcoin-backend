# PHASE 0 AUDIT REPORT - La Bolita Platform

**Date**: January 20, 2026
**Auditor**: Claude Code (Senior Full-Stack Web3 Engineer)
**Project**: La Bolita - Decentralized Lottery Platform

---

## 1. EXECUTIVE SUMMARY

La Bolita is a decentralized lottery platform on Polygon with two games:
- **La Bolita**: 2/3/4 digit number betting (Fijos/Centenas/Parles)
- **La Fortuna**: 5-number lottery (1-54) + key number (0-9)

### Current State

| Module | Status | Completion |
|--------|--------|------------|
| Backend (Node/Express) | ✅ Operational | 90% |
| Frontend (React) | ⚠️ Partial | 60% |
| Smart Contracts | ✅ Implemented | 85% |
| VRF Integration | ✅ Implemented | 80% |
| Geoblocking | ✅ Implemented | 100% |
| Admin Panel | ⚠️ Basic | 40% |
| Legal Pages | ❌ Missing | 0% |
| i18n (EN/ES) | ❌ Missing | 0% |
| Scheduler/Worker | ❌ Missing | 0% |
| Merkle Claims | ❌ Missing | 0% |

---

## 2. CURRENT REPOSITORY MAP

```
gold/
├── backend/                      # Node.js + Express API
│   ├── src/
│   │   ├── config/               # database.js, constants.js, auth.js
│   │   ├── controllers/          # auth, bet, draw, wallet, admin, payment
│   │   ├── middleware/           # auth.js, validation.js, geoblock.js
│   │   ├── models/               # User, Bet, Draw, Transaction, Payment
│   │   ├── routes/               # auth, bet, draw, wallet, admin, payments
│   │   ├── services/             # bet, draw, wallet, payout, nowPayments
│   │   ├── app.js                # Express config
│   │   └── server.js             # Entry point
│   └── package.json
│
├── frontend/                     # React 19 Application
│   ├── src/
│   │   ├── api/                  # authApi, betApi, drawApi, walletApi
│   │   ├── components/
│   │   │   ├── auth/             # ProtectedRoute, AdminRoute, LoginForm
│   │   │   ├── bets/             # BetForm, BetList, BetSlip
│   │   │   ├── common/           # Button, Input, Spinner, GeoBlock
│   │   │   ├── draws/            # DrawCard, DrawCountdown, DrawList
│   │   │   ├── wallet/           # DepositForm, WithdrawalForm
│   │   │   └── web3/             # ConnectWallet, JackpotBanner
│   │   ├── contexts/             # Auth, Web3, Wallet, Bet, Draw, Toast
│   │   ├── hooks/                # useContract.js (29KB), useAuth, etc.
│   │   ├── pages/
│   │   │   ├── public/           # HomePage, LoginPage, ResultsPage
│   │   │   ├── user/             # Dashboard, Betting, Wallet, Lottery
│   │   │   └── admin/            # AdminDashboard, ManageDraws, Users
│   │   ├── config/               # geoblocking.js
│   │   └── App.js                # Router configuration
│   └── package.json
│
├── contracts/                    # Solidity Smart Contracts
│   ├── contracts/
│   │   ├── LaBolita.sol          # Main contract (61KB)
│   │   ├── LaBolitaVRF.sol       # VRF version (28KB)
│   │   ├── MockERC20.sol         # Test token
│   │   └── mocks/VRFCoordinatorV2Mock.sol
│   ├── scripts/                  # deploy.js, deployVRF.js
│   └── hardhat.config.js
│
└── Documentation files
```

---

## 3. EXISTING ROUTES ANALYSIS

### Currently Implemented Routes

| Route | Type | Page | Status |
|-------|------|------|--------|
| `/` | Public | HomePage | ✅ |
| `/login` | Public | LoginPage | ✅ |
| `/register` | Public | RegisterPage | ✅ |
| `/results` | Public | ResultsPage | ✅ |
| `/web3` | Public | Web3BettingPage | ✅ |
| `/lottery` | Public | LotteryPage | ✅ |
| `/dashboard` | Protected | DashboardPage | ✅ |
| `/bet` | Protected | BettingPage | ✅ |
| `/my-bets` | Protected | MyBetsPage | ✅ |
| `/wallet` | Protected | WalletPage | ✅ |
| `/profile` | Protected | ProfilePage | ✅ |
| `/web3-wallet` | Public | Web3WalletPage | ✅ |
| `/referrals` | Protected | ReferralsPage | ✅ |
| `/history` | Protected | HistoryPage | ✅ |
| `/admin` | Admin | AdminDashboard | ⚠️ Basic |
| `/admin/draws` | Admin | ManageDrawsPage | ⚠️ Basic |
| `/admin/users` | Admin | ManageUsersPage | ⚠️ Basic |
| `/admin/withdrawals` | Admin | WithdrawalsPage | ⚠️ Basic |

### MISSING Routes (Required)

| Route | Type | Purpose | Priority |
|-------|------|---------|----------|
| `/how-it-works` | Public | Platform explanation | HIGH |
| `/transparency` | Public | Contract addresses, fees | HIGH |
| `/fairness` | Public | VRF explanation, verification | HIGH |
| `/statistics` | Public | Platform stats | MEDIUM |
| `/faq` | Public | Frequently asked questions | MEDIUM |
| `/contact` | Public | Contact information | MEDIUM |
| `/official-links` | Public | Anti-phishing, official domains | HIGH |
| `/legal/terms` | Public | Terms of service | HIGH |
| `/legal/rules` | Public | Game rules, prize distribution | HIGH |
| `/legal/privacy` | Public | Privacy policy | HIGH |
| `/legal/cookies` | Public | Cookie policy | MEDIUM |
| `/legal/responsible-gaming` | Public | Responsible gaming | HIGH |
| `/legal/jurisdictions` | Public | Restricted countries | HIGH |
| `/legal/disclaimer` | Public | Legal disclaimer | HIGH |
| `/app/claims` | Protected | Merkle claims for prizes | HIGH |

---

## 4. DATA STORAGE ANALYSIS

### Backend Database (PostgreSQL)

| Table | Purpose | Status |
|-------|---------|--------|
| `users` | User accounts, balance | ✅ Complete |
| `draws` | Lottery draws | ✅ Complete |
| `bets` | User bets | ✅ Complete |
| `transactions` | Balance movements | ✅ Complete |
| `payments` | NowPayments integration | ✅ Complete |
| `withdrawals` | Withdrawal requests | ✅ Complete |

### Missing Tables (Required)

| Table | Purpose | Priority |
|-------|---------|----------|
| `lottery_draws` | La Fortuna draws | HIGH |
| `lottery_tickets` | La Fortuna tickets | HIGH |
| `prize_configs` | Category configurations | HIGH |
| `merkle_roots` | Claims Merkle trees | HIGH |
| `admin_logs` | Audit trail | HIGH |
| `draw_states` | State machine history | MEDIUM |

### Smart Contract State

| Variable | Purpose | Status |
|----------|---------|--------|
| `draws` | La Bolita draws | ✅ |
| `bets` | La Bolita bets | ✅ |
| `lotteryDraws` | La Fortuna draws | ✅ |
| `lotteryTickets` | La Fortuna tickets | ✅ |
| `currentJackpot` | Progressive jackpot | ✅ |
| `referralInfo` | Referral tracking | ✅ |

---

## 5. API ENDPOINTS ANALYSIS

### Existing APIs

**Auth (4 endpoints)**: ✅ Complete
**Bets (4 endpoints)**: ✅ Complete
**Draws (5 endpoints)**: ✅ Complete
**Wallet (3 endpoints)**: ✅ Complete
**Payments (2+ endpoints)**: ✅ Complete
**Admin (8+ endpoints)**: ⚠️ Partial

### Missing APIs (Required)

| Endpoint | Method | Purpose | Priority |
|----------|--------|---------|----------|
| `/api/lottery/draws` | GET | La Fortuna draws | HIGH |
| `/api/lottery/tickets/buy` | POST | Buy tickets | HIGH |
| `/api/lottery/my-tickets` | GET | User's tickets | HIGH |
| `/api/claims/pending` | GET | User's pending claims | HIGH |
| `/api/claims/proof/:drawId` | GET | Merkle proof | HIGH |
| `/api/claims/claim` | POST | Execute claim | HIGH |
| `/api/stats/platform` | GET | Public statistics | MEDIUM |
| `/api/admin/logs` | GET | Audit logs | HIGH |
| `/api/admin/prize-config` | GET/PUT | Prize configuration | HIGH |
| `/api/admin/merkle/generate` | POST | Generate roots | HIGH |
| `/api/admin/merkle/publish` | POST | Publish roots | HIGH |

---

## 6. CRITICAL GAPS IDENTIFIED

### Security Gaps

1. **Admin Authentication**: Current admin check is basic role-based, needs:
   - SIWE (Sign-In with Ethereum) or secure password + 2FA
   - Session management with CSRF protection
   - Rate limiting on admin endpoints

2. **Result Manipulation Risk**: Must verify admin cannot:
   - Manually set winning numbers post-VRF
   - Override contract results
   - Force winners outside normal flow

3. **Missing Audit Trail**: No logging of:
   - Admin actions
   - Configuration changes
   - State transitions

### Functionality Gaps

1. **No Scheduler/Worker**: Missing automation for:
   - Creating draws automatically
   - Closing betting periods
   - Requesting VRF
   - Processing results

2. **No Merkle Claims System**: Missing:
   - Winner calculation indexer
   - Merkle tree generation
   - Root publication flow
   - Claim verification

3. **No Prize Category System**: Missing:
   - Configurable prize percentages
   - Jackpot CAP and overflow logic
   - Per-category distribution

### UX/Legal Gaps

1. **No Legal Pages**: Missing all required legal documentation
2. **No i18n**: All text hardcoded in Spanish
3. **No Transparency Page**: Users can't verify contracts
4. **No VRF Verification Page**: Users can't verify fairness

---

## 7. INTEGRATION RISKS

### High Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| Admin can manipulate results | Critical | Audit all admin endpoints, remove result editing |
| No VRF callback handling | High | Implement event listener/polling |
| Database schema changes | High | Use migrations, backup before changes |
| Contract ABI mismatch | High | Sync ABIs after any contract change |

### Medium Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| Frontend state management | Medium | Test all context changes |
| Route conflicts | Medium | Map all routes before adding |
| API breaking changes | Medium | Version APIs, add backwards compatibility |

### Low Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| CSS conflicts | Low | Use scoped/modular CSS |
| Build size increase | Low | Code splitting, lazy loading |

---

## 8. IMPLEMENTATION PLAN

### PHASE 1: Web Structure (No logic changes)
**Estimated files: 25-30 new files**

1. Create layout components:
   - `PublicLayout.jsx` (Header + Footer + Container)
   - `AppLayout.jsx` (With wallet guard)
   - `AdminLayout.jsx` (With secure auth)
   - `Footer.jsx` with legal links

2. Create all missing pages:
   - `/how-it-works` → HowItWorksPage.jsx
   - `/transparency` → TransparencyPage.jsx
   - `/fairness` → FairnessPage.jsx
   - `/statistics` → StatisticsPage.jsx
   - `/faq` → FAQPage.jsx
   - `/contact` → ContactPage.jsx
   - `/official-links` → OfficialLinksPage.jsx
   - `/legal/*` → All legal pages

3. Update App.js with new routes

### PHASE 2: Prize Categories System
**Estimated files: 8-10 files**

1. Define PrizeConfig structure
2. Create configuration API endpoints
3. Implement calculation utilities
4. Update UI to show breakdown

### PHASE 3: Scheduler/Worker
**Estimated files: 10-15 files**

1. Create `/server` folder (or extend backend)
2. Implement scheduler (node-cron)
3. Implement worker (queue system)
4. Create Draw State Machine
5. Implement VRF request/callback handling

### PHASE 4: Merkle Claims
**Estimated files: 8-12 files**

1. Create indexer service
2. Implement Merkle tree generation
3. Create admin publication flow
4. Build claims UI page

### PHASE 5: Admin Security
**Estimated files: 15-20 files**

1. Implement SIWE authentication
2. Create role system (superadmin, operator, auditor)
3. Build complete admin dashboard
4. Implement audit logging

### PHASE 6: UI Quality
**Estimated files: 10-15 files**

1. Improve error handling
2. Add accessibility features
3. Implement anti-phishing measures
4. Enhance geoblocking UI

### PHASE 7: Documentation & Delivery
**Estimated files: 5-10 files**

1. Update all documentation
2. Create deployment guides
3. Verify security
4. Final testing

---

## 9. FILES TO MODIFY/CREATE

### Files to MODIFY

| File | Changes |
|------|---------|
| `frontend/src/App.js` | Add new routes, layouts |
| `frontend/src/components/common/index.js` | Export new components |
| `backend/src/app.js` | Add new routes, middleware |
| `backend/src/routes/admin.js` | Secure endpoints, add audit |
| `backend/src/middleware/auth.js` | Add SIWE, roles |

### Files to CREATE (Priority Order)

**Phase 1 - Layouts & Pages**
```
frontend/src/components/layout/
  ├── PublicLayout.jsx
  ├── AppLayout.jsx
  ├── AdminLayout.jsx
  ├── Footer.jsx
  ├── Header.jsx
  └── index.js

frontend/src/pages/public/
  ├── HowItWorksPage.jsx
  ├── TransparencyPage.jsx
  ├── FairnessPage.jsx
  ├── StatisticsPage.jsx
  ├── FAQPage.jsx
  ├── ContactPage.jsx
  └── OfficialLinksPage.jsx

frontend/src/pages/legal/
  ├── TermsPage.jsx
  ├── RulesPage.jsx
  ├── PrivacyPage.jsx
  ├── CookiesPage.jsx
  ├── ResponsibleGamingPage.jsx
  ├── JurisdictionsPage.jsx
  └── DisclaimerPage.jsx
```

**Phase 3 - Scheduler**
```
backend/src/
  ├── scheduler/
  │   ├── index.js
  │   ├── drawScheduler.js
  │   └── vrfHandler.js
  ├── workers/
  │   ├── index.js
  │   └── drawWorker.js
  └── services/
      └── drawStateMachine.js
```

**Phase 4 - Claims**
```
backend/src/services/
  ├── merkleService.js
  └── indexerService.js

frontend/src/pages/user/
  └── ClaimsPage.jsx
```

**Phase 5 - Admin**
```
backend/src/
  ├── middleware/siweAuth.js
  ├── services/auditService.js
  └── models/AuditLog.js

frontend/src/pages/admin/
  ├── AdminLoginPage.jsx
  ├── AuditLogsPage.jsx
  ├── PrizeConfigPage.jsx
  └── MerkleRootsPage.jsx
```

---

## 10. ENVIRONMENT VARIABLES NEEDED

### Frontend (.env)
```env
REACT_APP_API_URL=http://localhost:5000/api
REACT_APP_CONTRACT_ADDRESS=0x...
REACT_APP_TOKEN_ADDRESS=0x...
REACT_APP_CHAIN_ID=137
REACT_APP_ENABLE_GEOBLOCK=true
REACT_APP_VRF_COORDINATOR=0x...
```

### Backend (.env)
```env
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/labolita

# Auth
JWT_SECRET=super-secret-key
ADMIN_WALLET_ALLOWLIST=0x...,0x...

# Blockchain
RPC_URL=https://polygon-rpc.com
CONTRACT_ADDRESS=0x...
PRIVATE_KEY=...

# VRF
VRF_COORDINATOR=0x...
VRF_SUBSCRIPTION_ID=...
VRF_KEY_HASH=0x...

# Scheduler
SCHEDULER_ENABLED=true
DRAW_TIMES=10:00,15:00,21:00

# Geoblocking
ENABLE_GEOBLOCK=true
```

---

## 11. NEXT STEPS

1. **Approve this plan** and proceed to PHASE 1
2. **No changes** to existing game logic until all phases complete
3. **Incremental commits** after each sub-phase
4. **Testing** after each phase before moving to next

---

## 12. CONCLUSION

The La Bolita platform has a solid foundation but requires significant work to meet production-ready requirements:

- **Backend**: 90% complete, needs scheduler, Merkle, audit
- **Frontend**: 60% complete, needs legal pages, layouts, i18n
- **Admin**: 40% complete, needs secure auth, full dashboard
- **Security**: Needs audit trail, role system, SIWE

**Recommendation**: Proceed with PHASE 1 immediately to establish complete web structure without breaking existing functionality.

---

**End of Phase 0 Report**

---
---

# PHASE 0.5 — ADMIN OPS PANEL IMPLEMENTATION LOG

**Date**: February 10, 2026
**Engineer**: Claude Code (Opus 4.6)
**Scope**: Admin Ops/Finanzas Panel + Legacy Migration + Production Hardening

---

## ROUND 1: Admin Ops Panel Creation (14 files)

### Backend

**CREATED `backend/src/routes/adminOps.js`**
- Three endpoints protected with `requireAdmin` middleware:
  - `GET /api/admin/ops/summary` — Aggregated system health, DB status, uptime, user/deposit/withdrawal/fee totals, pending withdrawals, keno pool status, feature flags
  - `GET /api/admin/ops/toggles` — Read all operational feature flags
  - `POST /api/admin/ops/toggles` — Set a flag + write AuditLog entry
- Graceful degradation: if DB unavailable, returns `health: 'degraded'` with zeroed totals instead of crashing

**EDITED `backend/src/app.js`**
- Added `const adminOpsRoutes = require('./routes/adminOps');`
- Registered route: `app.use('/api/admin/ops', adminOpsRoutes);` (placed BEFORE catch-all `/api/admin`)

### Frontend — API Client

**CREATED `bolcoin-frontend/src/api/adminOpsApi.js`**
- `getOpsSummary()` → GET `/admin/ops/summary`
- `getToggles()` → GET `/admin/ops/toggles`
- `setToggle(key, enabled)` → POST `/admin/ops/toggles`

### Frontend — Layout

**CREATED `bolcoin-frontend/src/components/admin/AdminLayout.jsx`**
- Topbar: logo "BOLCOIN", badge "ADMIN OPS", wallet address, logout button
- Sidebar: NavLink items with active state — Overview, Finance, System, Risk, separator, Legacy
- Uses `useAdminAuth()` for admin data, `useWeb3()` for address formatting

**CREATED `bolcoin-frontend/src/components/admin/AdminLayout.css`**
- Full CSS: topbar, sidebar, content area, cards grid, toggle switches, legacy cards
- Dark theme (FFD700 gold, #0a0a0a background), responsive (sidebar hidden on mobile)

### Frontend — Pages

**CREATED `bolcoin-frontend/src/pages/admin/OpsDashboard.jsx`**
- Overview dashboard: health indicator, DB status, uptime, total users, deposits, withdrawals, fees, pending withdrawals, keno pool, feature flags quick view
- Fetches `getOpsSummary()` on mount with loading/error states

**CREATED `bolcoin-frontend/src/pages/admin/FinanceDashboard.jsx`**
- Financial cards: deposits total, withdrawals total, fees collected, net position, pending withdrawals detail
- Same `getOpsSummary()` endpoint, financial subset

**CREATED `bolcoin-frontend/src/pages/admin/SystemStatus.jsx`**
- System health, DB connection, server uptime, scheduler status, feature flags read-only list

**CREATED `bolcoin-frontend/src/pages/admin/RiskControls.jsx`**
- Toggle switches for: maintenance_mode, feature_withdrawals, feature_deposits, game_keno, game_bolita, game_fortuna
- Confirmation dialog before toggling maintenance_mode
- Uses `getToggles()` and `setToggle()` API

**CREATED `bolcoin-frontend/src/pages/admin/LegacyHome.jsx`**
- Card links to 7 legacy admin pages: draws, users, withdrawals, audit-logs, web3, bankroll, keno-pool

### Frontend — Routing & UI

**EDITED `bolcoin-frontend/src/App.js`**
- Added 5 lazy imports for new pages
- Removed dead `AdminDashboard` import
- Changed `/admin` from rendering AdminDashboard to `<Navigate to="/admin/ops" replace />`
- Added 5 new admin routes wrapped in `<AdminRoute>`
- Added catch-all: `/admin/*` → redirect to `/admin/ops`

**EDITED `bolcoin-frontend/src/components/layout/Header.jsx`**
- Added Admin button using `useAdminAuth()`: links to `/admin/ops` if authenticated, `/admin/login` if not

**EDITED `bolcoin-frontend/src/components/layout/Layout.css`**
- Added `.header-admin-link` styles (gold border, hover fill)

**EDITED `bolcoin-frontend/src/pages/admin/AdminLoginPage.jsx`**
- Changed both `navigate('/admin')` to `navigate('/admin/ops')`

---

## ROUND 2: SIWE / Web3 / Wagmi Fixes (5 files)

### Problem: WalletConnect "connector.getProvider is not a function"
**Root cause**: RainbowKit tried to init WalletConnect connector with placeholder/invalid projectId when `VITE_WALLETCONNECT_PROJECT_ID` is missing.

**EDITED `bolcoin-frontend/src/config/wagmi.js`**
- When no `VITE_WALLETCONNECT_PROJECT_ID`, restricts wallets to `injectedWallet` only (MetaMask)
- Prevents WalletConnect connector from initializing with invalid config

### Problem: "Acceso Denegado" on admin login for all errors
**Root cause**: SIWELogin catch block swallowed all errors (network, CORS, backend down) and always showed "Acceso Denegado".

**EDITED `bolcoin-frontend/src/components/admin/SIWELogin.jsx`**
- Now distinguishes HTTP 403 (real "not admin") from network/API errors
- Shows actual error message for non-403 errors

### Other fixes

**EDITED `bolcoin-frontend/src/components/auth/AdminRoute.jsx`**
- Changed permission denied redirect from `/admin` to `/admin/ops`

**EDITED `bolcoin-frontend/.env.example`**
- Updated from `REACT_APP_` to `VITE_` prefix
- Added `VITE_WALLETCONNECT_PROJECT_ID`

---

## ROUND 3: Admin Routing Hardening (2 files)

### Problem: AdminDashboard dead import with broken refs
**Root cause**: `AdminDashboard` was still imported in App.js but never rendered. Had references to `adminRole`/`logout` which don't exist in AdminAuthContext.

**EDITED `bolcoin-frontend/src/App.js`**
- Removed dead AdminDashboard import
- Added `/admin/*` catch-all route → redirect to `/admin/ops`

### Problem: LoginPage redirected admins to bare `/admin`

**EDITED `bolcoin-frontend/src/pages/public/LoginPage.jsx`**
- Changed 2 occurrences of `navigate('/admin')` to `navigate('/admin/ops')`

---

## ROUND 4: Production Readiness — 401 Spam Fix (2 files)

### Problem: 401 "Wallet no proporcionada" spam on admin pages
**Root cause (multi-layered)**:
1. `BalanceContext` called `/wallet/balance` and `/keno/session` on every page, including admin routes
2. Axios request interceptor early-returned when `admin_jwt` existed, skipping `x-wallet-address` header
3. Backend `authenticateWallet` middleware returned 401 "Wallet no proporcionada"
4. The 401 response handler removed `admin_jwt` from localStorage for ANY 401, silently logging out admin

**EDITED `bolcoin-frontend/src/api/index.js`** — Complete interceptor rewrite:
- **Request interceptor** is now route-aware:
  - Admin API calls (`/admin/`) → use `admin_jwt` as Bearer token
  - Non-admin API calls → use user `token` as Bearer token
  - Wallet address (`x-wallet-address`) → ALWAYS sent regardless of route
- **Response interceptor 401 handler** is now scoped:
  - Admin API 401 → only clears `admin_jwt`
  - Non-admin API 401 → only clears user `token`/`user`

**EDITED `bolcoin-frontend/src/contexts/BalanceContext.jsx`**:
- Added `isAdminRoute()` helper: checks `window.location.pathname.startsWith('/admin')`
- Initial load `useEffect` → returns early if on admin route
- Auto-refresh interval → returns early if on admin route, re-checks inside interval callback
- `loadDatabaseBalance` → added `!account` guard, explicit wallet params and headers in API call

---

## UPDATED STATUS TABLE

| Module | Before | After | Completion |
|--------|--------|-------|------------|
| Backend (Node/Express) | ✅ Operational | ✅ Operational | 92% |
| Frontend (React) | ⚠️ Partial | ✅ Operational | 75% |
| Smart Contracts | ✅ Implemented | ✅ Implemented | 85% |
| Admin Panel | ⚠️ Basic (40%) | ✅ Full Ops Panel | 75% |
| Admin Auth (SIWE) | ❌ Missing | ✅ Implemented | 90% |
| API Interceptors | ⚠️ Basic | ✅ Route-aware | 95% |
| Balance System | ⚠️ 401 spam | ✅ Admin-safe | 90% |
| Feature Flags UI | ❌ Missing | ✅ Toggle controls | 85% |
| Audit Logging | ⚠️ Partial | ✅ Toggle actions logged | 70% |

---

## COMPLETE FILE CHANGE LOG

| # | File | Action | Round |
|---|------|--------|-------|
| 1 | `backend/src/routes/adminOps.js` | CREATED | R1 |
| 2 | `backend/src/app.js` | EDITED (2 lines) | R1 |
| 3 | `bolcoin-frontend/src/api/adminOpsApi.js` | CREATED | R1 |
| 4 | `bolcoin-frontend/src/components/admin/AdminLayout.jsx` | CREATED | R1 |
| 5 | `bolcoin-frontend/src/components/admin/AdminLayout.css` | CREATED | R1 |
| 6 | `bolcoin-frontend/src/pages/admin/OpsDashboard.jsx` | CREATED | R1 |
| 7 | `bolcoin-frontend/src/pages/admin/FinanceDashboard.jsx` | CREATED | R1 |
| 8 | `bolcoin-frontend/src/pages/admin/SystemStatus.jsx` | CREATED | R1 |
| 9 | `bolcoin-frontend/src/pages/admin/RiskControls.jsx` | CREATED | R1 |
| 10 | `bolcoin-frontend/src/pages/admin/LegacyHome.jsx` | CREATED | R1 |
| 11 | `bolcoin-frontend/src/App.js` | EDITED | R1, R3 |
| 12 | `bolcoin-frontend/src/components/layout/Header.jsx` | EDITED | R1 |
| 13 | `bolcoin-frontend/src/components/layout/Layout.css` | EDITED | R1 |
| 14 | `bolcoin-frontend/src/pages/admin/AdminLoginPage.jsx` | EDITED | R1 |
| 15 | `bolcoin-frontend/src/config/wagmi.js` | EDITED | R2 |
| 16 | `bolcoin-frontend/src/components/admin/SIWELogin.jsx` | EDITED | R2 |
| 17 | `bolcoin-frontend/src/components/auth/AdminRoute.jsx` | EDITED | R2 |
| 18 | `bolcoin-frontend/.env.example` | EDITED | R2 |
| 19 | `bolcoin-frontend/src/pages/public/LoginPage.jsx` | EDITED | R3 |
| 20 | `bolcoin-frontend/src/api/index.js` | EDITED | R4 |
| 21 | `bolcoin-frontend/src/contexts/BalanceContext.jsx` | EDITED | R4 |

**Total: 10 files created, 11 files edited across 4 rounds**

---

## BUGS FIXED

| Bug | Root Cause | Fix | Round |
|-----|-----------|-----|-------|
| WalletConnect `connector.getProvider` crash | RainbowKit init with invalid projectId | Restrict to injectedWallet when no WC projectId | R2 |
| "Acceso Denegado" for all login errors | Catch block swallowed network/CORS errors | Distinguish 403 from other errors | R2 |
| Admin JWT silently wiped | 401 handler cleared admin_jwt for ANY 401 | Scoped 401 handler per route type | R4 |
| 401 "Wallet no proporcionada" spam | BalanceContext called user endpoints on admin pages | Admin route guard in BalanceContext | R4 |
| x-wallet-address skipped when admin_jwt exists | Interceptor early-returned after setting admin auth | Always send wallet address regardless of route | R4 |
| Dead AdminDashboard import | Removed component still imported with broken refs | Removed import | R3 |
| Unknown `/admin/*` paths → home page | No catch-all for admin subroutes | Added `/admin/*` → `/admin/ops` redirect | R3 |
| LoginPage sent admins to `/admin` (not `/admin/ops`) | Legacy redirect target | Updated to `/admin/ops` | R3 |

---

## REMAINING WORK

### High Priority
- [ ] Scheduler/Worker (auto-draws, VRF callback handling)
- [ ] Merkle Claims system (indexer, tree generation, claims UI)
- [ ] i18n (EN/ES language support)
- [ ] Full audit trail (all admin actions, not just toggles)

### Medium Priority
- [ ] Prize category configuration UI
- [ ] Platform statistics page (live data)
- [ ] Admin role system (superadmin, operator, auditor)
- [ ] Rate limiting on admin endpoints

### Low Priority
- [ ] Progressive Web App (PWA) support
- [ ] Email/push notifications
- [ ] Advanced analytics dashboard
