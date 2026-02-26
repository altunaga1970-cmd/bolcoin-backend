# 🔒 PHASE 2: SECURITY AUDIT GUIDE

**Status:** 🟡 IN PROGRESS
**Date:** 2026-02-19
**Duration:** 5-7 days
**Objective:** 0 P0/P1 vulnerabilities, >95% test coverage, >80% code coverage

---

## 📋 OVERVIEW

Phase 2 validates the security, correctness, and performance of the Bolcoin platform before production hardening.

**Key Focus Areas:**
1. Smart contract security (BingoGame, KenoGame, La Bolita)
2. Backend API security (SQL injection, auth, secrets)
3. Game logic correctness (math, payouts, edge cases)
4. Integration testing (E2E flows)
5. Performance testing (100+ concurrent users)

---

## 🛠️ TOOLS CREATED

### 1. Smart Contract Security Audit Script
**File:** `contracts/scripts/security-audit.sh`

**Tools Used:**
- **Slither:** Static analysis (detects 70+ vulnerability types)
- **Mythril:** Symbolic execution (finds edge cases)
- **Custom checks:** Project-specific patterns

**Usage:**
```bash
cd contracts

# Audit BingoGame
bash scripts/security-audit.sh BingoGame

# Audit all contracts
bash scripts/security-audit.sh all
```

**What it checks:**
- ✅ Reentrancy vulnerabilities
- ✅ Integer overflow/underflow
- ✅ Unchecked external calls
- ✅ Access control issues
- ✅ Unprotected ether withdrawal
- ✅ Timestamp dependence
- ✅ DoS with block gas limit
- ✅ 70+ other patterns

**Setup:**
```bash
# Install Slither
pip install slither-analyzer

# Install Mythril (optional)
pip install mythril

# Verify installation
slither --version
myth version
```

---

### 2. Backend Security Audit Script
**File:** `backend/scripts/security-check.js`

**Usage:**
```bash
cd backend
node scripts/security-check.js
```

**What it checks:**
- ❌ SQL injection vulnerabilities
- ❌ Hardcoded credentials/API keys
- ❌ Weak cryptography (MD5, SHA1, DES)
- ❌ Insecure randomness (Math.random for secrets)
- ❌ Dangerous functions (eval, new Function)
- ❌ Command injection
- ❌ CORS misconfiguration
- ❌ Missing authentication middleware
- ⚠️ TODO/FIXME in security-critical code

**Exit codes:**
- `0`: PASS (no critical/high issues)
- `1`: FAIL (critical/high issues found)

---

## 🚀 PHASE 2.1: SMART CONTRACT SECURITY AUDIT

**Duration:** 2 days
**Owner:** Security Engineer + Tech Lead

### Checklist

#### Setup
- [ ] Install Slither: `pip install slither-analyzer`
- [ ] Install Mythril: `pip install mythril`
- [ ] Compile contracts: `npx hardhat compile`

#### BingoGame.sol Audit
- [ ] Run Slither: `bash scripts/security-audit.sh BingoGame`
- [ ] Run Mythril: `myth analyze contracts/BingoGame.sol`
- [ ] Manual review: Reentrancy in `buyCards()`, `claimRefund()`
- [ ] Manual review: Access control on `createRound()`, `cancelRound()`
- [ ] Manual review: Prize math in `_distributeRevenue()`
- [ ] Manual review: VRF callback (`fulfillRandomWords()`)
- [ ] Validate timelock: Payout table can't change within 24h
- [ ] Check for front-running vulnerabilities
- [ ] Test max gas for `resolveRound()` (100+ cards)

#### KenoGame.sol Audit
- [ ] Run Slither
- [ ] Validate payout table math (12% house edge)
- [ ] Check for overflow in bet calculations
- [ ] Validate session anti-replay logic

#### La Bolita Contracts Audit
- [ ] Run Slither on LaBolitaGame.sol
- [ ] Validate draw resolution logic
- [ ] Check for operator manipulation vectors

### Known Issues to Verify

From audit document (`AUDIT_BINGO_RAILWAY_2026-02-19.md`):

1. **F-01: Reentrancy protection** → Verify `nonReentrant` on all external calls
2. **F-02: VRF timeout** → Verify `vrfTimeoutSeconds` properly enforced
3. **F-03: Prize distribution** → Verify 10% fee + 10% reserve + 80% winners
4. **F-04: Refund logic** → Verify no transfer loops in `claimRefund()`
5. **F-05: Co-winner cap** → Verify `MAX_CO_WINNERS = 10` prevents DoS

### Exit Criteria

- ✅ Slither: 0 high/medium findings (except known false positives)
- ✅ Mythril: 0 vulnerabilities found
- ✅ Manual review: All critical paths validated
- ✅ Test coverage: >90% for critical functions
- ✅ Gas optimization: `resolveRound()` <3M gas for 100 cards

**Report:** `audit-reports/smart-contracts-audit-YYYYMMDD.md`

---

## 🔒 PHASE 2.2: BACKEND API SECURITY AUDIT

**Duration:** 2 days
**Owner:** Backend Engineer + Security Officer

### Checklist

#### Critical Security Issues (S-01)

- [ ] **OPERATOR_PRIVATE_KEY exposure**
  - [ ] Verify key NOT in `.env` file in git history
  - [ ] Migrate to Railway Secrets
  - [ ] Update `backend/src/chain/provider.js` to read from `process.env`
  - [ ] Test that key works from Railway Secrets
  - [ ] Document key rotation procedure

#### SQL Injection Audit

```bash
# Scan for SQL injection patterns
node scripts/security-check.js
```

- [ ] Audit all `db.query()` calls for parameterization
- [ ] Verify no string concatenation in queries
- [ ] Test with SQL injection payloads:
  ```
  ' OR '1'='1
  '; DROP TABLE users--
  ' UNION SELECT * FROM users--
  ```
- [ ] Use prepared statements everywhere

**Files to audit:**
- `backend/src/routes/*.js`
- `backend/src/controllers/*.js`
- `backend/src/services/*.js`

#### Authentication & Authorization

- [ ] Verify SIWE (Sign-In With Ethereum) implementation
- [ ] Verify `/admin/*` routes require authentication
- [ ] Test session expiration (8h default)
- [ ] Verify admin wallet whitelist works
- [ ] Test role-based access control (RBAC)
- [ ] Verify JWT secret is strong and from env
- [ ] Check for session fixation vulnerabilities

#### Rate Limiting

- [ ] Verify rate limiting on `/api/*` routes
- [ ] Default: 100 req/min per IP
- [ ] Stricter limits on:
  - `/api/auth/*`: 10 req/min
  - `/api/bet/*`: 20 req/min
  - `/api/admin/*`: 50 req/min
- [ ] Test rate limit enforcement
- [ ] Verify Redis/in-memory rate limit store

#### CORS Configuration

```javascript
// Verify CORS config
const allowedOrigins = [
  'https://bolcoin.app',
  'https://www.bolcoin.app'
];

// MUST NOT include '*' in production
```

- [ ] Verify CORS whitelist includes only production domains
- [ ] NO wildcard `*` in production
- [ ] Test CORS with Postman/curl
- [ ] Verify credentials: true works

#### Input Validation

- [ ] Verify all API inputs validated (joi, express-validator)
- [ ] Sanitize HTML/XSS vectors
- [ ] Validate bet amounts (min/max)
- [ ] Validate wallet addresses (checksum)
- [ ] Test with malformed inputs

#### Secrets Management

- [ ] All secrets in `.env` or Railway Secrets
- [ ] `.env` in `.gitignore`
- [ ] No secrets committed to git history
- [ ] Verify `.env.example` has placeholders only
- [ ] Document secret rotation procedure

### Security Testing

```bash
# Run automated security scan
npm audit
npm audit fix

# Check for known vulnerabilities
npm outdated

# Scan dependencies
npm install -g snyk
snyk test
```

### Exit Criteria

- ✅ OPERATOR_PRIVATE_KEY migrated to Railway Secrets
- ✅ 0 SQL injection vulnerabilities
- ✅ SIWE auth validated on all `/admin/*` routes
- ✅ Rate limiting configured and tested
- ✅ CORS whitelist configured (no `*`)
- ✅ npm audit: 0 high/critical vulnerabilities
- ✅ All TODOs in security code resolved

**Report:** `audit-reports/backend-security-audit-YYYYMMDD.md`

---

## 🧮 PHASE 2.3: GAME LOGIC VALIDATION

**Duration:** 2 days
**Owner:** Backend Engineer + QA

### Keno Game Logic

**Payout Table Math:**
```javascript
// Verify house edge = 12%
// For each (numbers_matched, numbers_selected):
const expectedReturn = payout * probability;
const houseEdge = 1 - totalExpectedReturn;

// Target: houseEdge ≈ 0.12 (12%)
```

- [ ] Calculate probabilities for all combinations
- [ ] Verify payout table RTP = 88% (house edge = 12%)
- [ ] Test edge cases:
  - 0 numbers selected
  - 11+ numbers selected
  - All 10 numbers matched (max payout)
- [ ] Verify max payout cap works
- [ ] Test with 1,000 simulated bets

**Files:**
- `contracts/contracts/KenoGame.sol`
- `backend/src/services/kenoService.js`

### Bingo Game Logic

**Revenue Distribution:**
```
Total Revenue = cardPrice × totalCards
├─ Fee (10%):     accruedFees
├─ Reserve (10%): poolReserve
└─ Winners (80%):
   ├─ Line Prize (15% of 80% = 12%)
   └─ Bingo Prize (85% of 80% = 68%)
```

- [ ] Verify split: 10% fee + 10% reserve + 80% prize pool
- [ ] Verify line prize = 15% of winner pot
- [ ] Verify bingo prize = 85% of winner pot
- [ ] Test co-winner division (2-10 winners)
- [ ] Test jackpot only on ball ≤25
- [ ] Test round with 0 cards (cancelled)
- [ ] Test round with 100+ cards (gas limit)

**Files:**
- `contracts/contracts/BingoGame.sol` (lines 415-450)
- `backend/src/services/bingoService.js`

### Session Anti-Replay

- [ ] Verify `sessionId` cannot be reused
- [ ] Test with duplicate `sessionId`
- [ ] Verify session expires after use
- [ ] Test concurrent sessions from same user

### Edge Cases

- [ ] User wins multiple times in same round
- [ ] Round resolves with 0 winners
- [ ] VRF timeout (>4 hours)
- [ ] Contract paused mid-round
- [ ] User tries to claim after 30 days

### Exit Criteria

- ✅ Keno payout table RTP = 88% ± 0.5%
- ✅ Bingo revenue split validated (10/10/80)
- ✅ Co-winner division correct for 2-10 winners
- ✅ Jackpot only triggers on ball ≤25
- ✅ Session anti-replay works
- ✅ All edge cases handled gracefully

**Report:** `audit-reports/game-logic-audit-YYYYMMDD.md`

---

## 🧪 PHASE 2.4: INTEGRATION TESTING

**Duration:** 2 days
**Owner:** QA Engineer + Backend

### E2E Test: Bingo Full Flow

```javascript
// Test: Full round lifecycle with VRF
describe('Bingo E2E - VRF Flow', () => {
  it('should complete full round lifecycle', async () => {
    // 1. Create round
    const tx1 = await bingo.createRound(futureTimestamp);
    const roundId = (await tx1.wait()).events[0].args.roundId;

    // 2. Buy cards (3 users, 2 cards each)
    await bingo.connect(user1).buyCards(roundId, 2);
    await bingo.connect(user2).buyCards(roundId, 2);
    await bingo.connect(user3).buyCards(roundId, 2);

    // 3. Close and request VRF
    await bingo.closeAndRequestVRF(roundId);

    // 4. Wait for VRF fulfillment (Chainlink callback)
    await waitForVRFFulfillment(roundId, 120); // 2 min timeout

    // 5. Resolve round
    await bingo.resolveRound(roundId);

    // 6. Verify winners and prizes
    const round = await bingo.rounds(roundId);
    expect(round.status).to.equal(RoundStatus.RESOLVED);
    expect(round.lineWinners.length).to.be.gte(0);
    expect(round.bingoWinners.length).to.be.gte(0);

    // 7. Winners claim prizes
    // ... test claimRefund for winners
  });
});
```

### Test Suite Coverage

**Bingo Tests:**
- [ ] Create round
- [ ] Buy cards (1, 2, 4 cards)
- [ ] Buy cards exceeding MAX_CARDS_PER_USER (should fail)
- [ ] Close round with 0 cards (auto-cancel)
- [ ] Close round and request VRF
- [ ] VRF fulfillment callback
- [ ] Resolve round with winners
- [ ] Resolve round with 0 winners
- [ ] Claim prizes (line, bingo, jackpot)
- [ ] Cancel round and claim refund
- [ ] Emergency cancel after VRF timeout

**Keno Tests:**
- [ ] Place bet with valid numbers
- [ ] Place bet with invalid numbers (should fail)
- [ ] Draw winning numbers (server-side)
- [ ] Calculate payouts
- [ ] Claim winnings

**Scheduler Tests:**
- [ ] 4-room concurrent operation
- [ ] Orphan round recovery
- [ ] VRF request failure handling
- [ ] Circuit breaker triggers
- [ ] Event listener reconnection

### Load Testing (Scheduler)

```bash
# Stress test: 4 concurrent rooms for 1 hour
npm run test:scheduler:stress
```

- [ ] Run 4 rooms concurrently for 1 hour
- [ ] Simulate 3 backend restarts mid-round
- [ ] Verify 0 orphan rounds after recovery
- [ ] Verify all rounds resolve correctly
- [ ] Check for memory leaks

### Exit Criteria

- ✅ E2E test suite: >95% pass rate
- ✅ VRF fulfillment: 100% success (n=10 rounds)
- ✅ Scheduler stress test: 1h uptime, 0 orphans
- ✅ Integration tests automated (CI-ready)
- ✅ Test coverage report generated

**Report:** `test/reports/integration-tests-YYYYMMDD.html`

---

## ⚡ PHASE 2.5: PERFORMANCE TESTING

**Duration:** 1 day
**Owner:** DevOps + Backend

### Load Test Configuration

**Tool:** Artillery or k6

**Test Profile:**
```yaml
# artillery-load-test.yml
config:
  target: http://localhost:5000
  phases:
    - duration: 60
      arrivalRate: 10  # 10 users/sec
    - duration: 120
      arrivalRate: 50  # 50 users/sec
    - duration: 60
      arrivalRate: 100 # 100 users/sec (spike)
    - duration: 120
      arrivalRate: 50
    - duration: 60
      arrivalRate: 10

scenarios:
  - name: "Place Keno Bet"
    weight: 50
    flow:
      - post:
          url: "/api/keno/bet"
          json:
            numbers: [1, 5, 10, 15, 20]
            amount: 10
            sessionId: "{{ $randomString() }}"

  - name: "Get Round Status"
    weight: 30
    flow:
      - get:
          url: "/api/bingo/round/{{ $randomNumber(1, 100) }}"

  - name: "Buy Bingo Cards"
    weight: 20
    flow:
      - post:
          url: "/api/bingo/buy"
          json:
            roundId: 1
            count: 2
```

**Run:**
```bash
artillery run artillery-load-test.yml
```

### Performance Targets

| Metric | Target | Critical |
|--------|--------|----------|
| p50 latency | <200ms | <500ms |
| p95 latency | <500ms | <1000ms |
| p99 latency | <1000ms | <2000ms |
| Error rate | <0.5% | <1% |
| Throughput | >100 req/s | >50 req/s |
| DB connections | <50 | <100 |

### Database Query Optimization

```sql
-- Find slow queries
SELECT query, calls, total_time, mean_time
FROM pg_stat_statements
WHERE mean_time > 50
ORDER BY mean_time DESC
LIMIT 10;

-- Analyze query plan
EXPLAIN ANALYZE
SELECT * FROM bingo_rounds WHERE status = 'OPEN';
```

**Optimization Checklist:**
- [ ] Run `EXPLAIN ANALYZE` on all main queries
- [ ] Add missing indexes (see Phase 3.3)
- [ ] Optimize N+1 queries
- [ ] Tune connection pool (min=5, max=20)
- [ ] Enable query result caching (Redis)

### Exit Criteria

- ✅ 100 concurrent users: p95 <500ms, error <1%
- ✅ Database query p95 <50ms
- ✅ No connection pool exhaustion
- ✅ Memory usage stable (no leaks)
- ✅ CPU usage <80% at peak load

**Report:** `test/reports/load-test-YYYYMMDD.html`

---

## 📊 PHASE 2 SUCCESS METRICS

### Security Metrics

| Metric | Target | Status |
|--------|--------|--------|
| Slither high/medium findings | 0 | ⏳ Pending |
| Mythril vulnerabilities | 0 | ⏳ Pending |
| SQL injection vulns | 0 | ⏳ Pending |
| Hardcoded secrets | 0 | ⏳ Pending |
| npm audit high/critical | 0 | ⏳ Pending |
| OPERATOR_KEY in Secrets | Yes | ⏳ Pending |

### Quality Metrics

| Metric | Target | Status |
|--------|--------|--------|
| E2E test pass rate | >95% | ⏳ Pending |
| Code coverage | >80% | ⏳ Pending |
| Game logic validated | 100% | ⏳ Pending |
| Load test passed | Yes | ⏳ Pending |

---

## 🚦 DECISION GATE 2: PROCEED TO PHASE 3?

**Criteria:**
- [ ] ✅ 0 P0/P1 vulnerabilities (Slither + manual)
- [ ] ✅ OPERATOR_KEY migrated to Railway Secrets
- [ ] ✅ E2E tests >95% pass rate
- [ ] ✅ Load test: 100 users, <1% error, p95 <500ms
- [ ] ✅ Code coverage >80%
- [ ] ✅ All game logic validated (math correct)
- [ ] ✅ npm audit clean (0 high/critical)

**Approval Required:**
- [ ] Tech Lead sign-off
- [ ] Security Officer sign-off
- [ ] QA Engineer sign-off

**Decision:** ⏸️ PENDING

---

## 🔧 TROUBLESHOOTING

### Slither false positives

**Issue:** Slither reports issues in OpenZeppelin libraries

**Fix:**
```bash
slither . --exclude-dependencies --filter-paths "node_modules"
```

### Mythril timeout

**Issue:** Mythril takes >10 minutes on large contracts

**Fix:**
```bash
# Increase timeout
myth analyze --solv 0.8.24 --execution-timeout 1200 contracts/BingoGame.sol

# Or skip Mythril, rely on Slither + manual review
```

### Load test fails locally

**Issue:** Artillery can't handle 100 concurrent users on local machine

**Fix:**
- Deploy to staging environment
- Run load test from separate machine
- Use k6 cloud (https://k6.io/cloud)

---

## 📁 DELIVERABLES

```
gold/
├── contracts/
│   ├── scripts/
│   │   └── security-audit.sh             ✅ Smart contract audit
│   └── audit-reports/
│       ├── slither_BingoGame_*.txt
│       ├── mythril_BingoGame_*.txt
│       └── smart-contracts-audit.md      ⏳ Final report
│
├── backend/
│   ├── scripts/
│   │   └── security-check.js             ✅ Backend security scan
│   └── audit-reports/
│       └── backend-security-audit.md     ⏳ Final report
│
├── test/
│   ├── integration/
│   │   └── bingo-e2e.test.js             ⏳ E2E tests
│   └── reports/
│       ├── integration-tests.html
│       └── load-test.html
│
└── docs/
    ├── PHASE_2_SECURITY_AUDIT.md         ✅ This document
    └── game-logic-validation.md          ⏳ Math proofs
```

---

**Document Version:** 1.0
**Last Updated:** 2026-02-19
**Author:** Claude Code (Autonomous)
