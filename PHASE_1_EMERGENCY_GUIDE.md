# 🚨 PHASE 1: EMERGENCY RECOVERY GUIDE

**Status:** ✅ COMPLETED
**Date:** 2026-02-19
**Purpose:** Unblock Bingo system from MaxOpenRoundsReached deadlock

---

## 📋 OVERVIEW

Phase 1 addresses the 3 critical blockers (P0) preventing Bingo from functioning:

- **C-01:** Bingo scheduler blocked by MaxOpenRoundsReached (4+ orphan rounds)
- **C-02:** VRF configuration potentially misconfigured or unfunded
- **C-03:** RPC event listeners losing connection without recovery

## 🛠️ TOOLS CREATED

### 1. Emergency Cancel Rounds Script
**File:** `contracts/scripts/emergency-cancel-rounds.js`

**Purpose:** Cancel orphan rounds stuck in OPEN or CLOSED state

**Usage:**
```bash
# Dry run (preview what will be cancelled)
DRY_RUN=true npx hardhat run scripts/emergency-cancel-rounds.js --network amoy

# Actually cancel orphan rounds
npx hardhat run scripts/emergency-cancel-rounds.js --network amoy
```

**Required env vars** (in `contracts/.env`):
```
BINGO_CONTRACT_ADDRESS=0x...
OPERATOR_PRIVATE_KEY=0x...  # or DEPLOYER_KEY
```

**What it does:**
1. Scans all rounds created
2. Identifies rounds in OPEN or CLOSED status
3. Cancels them using `cancelRound()` function
4. Verifies `_openRoundIds.length == 0` after cleanup

**Exit criteria:**
- ✅ 0 rounds in OPEN/CLOSED state
- ✅ Scheduler can create new rounds without MaxOpenRoundsReached error

---

### 2. VRF Configuration Diagnostic Script
**File:** `contracts/scripts/diagnose-vrf-config.js`

**Purpose:** Diagnose why `closeAndRequestVRF()` fails in estimateGas

**Usage:**
```bash
npx hardhat run scripts/diagnose-vrf-config.js --network amoy
npx hardhat run scripts/diagnose-vrf-config.js --network polygon
```

**What it checks:**
1. ✅ BingoGame VRF configuration (subscription ID, key hash, gas limit)
2. ✅ VRF Coordinator address validity
3. ✅ Subscription funding status (LINK/MATIC balance)
4. ✅ BingoGame registered as consumer
5. ✅ Test VRF request (if possible)

**Common issues detected:**
- ❌ Subscription has zero balance → Fund with 5+ LINK or 50+ MATIC
- ❌ BingoGame not registered as consumer → Add at vrf.chain.link
- ❌ Wrong VRF Coordinator for network → Check deployment config
- ❌ Invalid subscription ID → Verify in .env

**How to fix:**
1. Go to https://vrf.chain.link
2. Connect with subscription owner wallet
3. Find your subscription ID
4. Fund subscription (5+ LINK recommended)
5. Add BingoGame address as consumer

---

### 3. Resilient Event Service
**File:** `backend/src/services/bingoEventService.js`

**Purpose:** Listen to Bingo contract events with auto-reconnection

**Features:**
- ✅ Auto-reconnection when RPC fails
- ✅ Health check every 60s
- ✅ Exponential backoff on reconnect
- ✅ RPC fallback rotation
- ✅ Graceful error handling

**Usage:**
```javascript
const BingoEventService = require('./services/bingoEventService');

const BINGO_ABI = require('./abi/BingoGame.json');

const eventService = new BingoEventService({
  contractAddress: process.env.BINGO_CONTRACT_ADDRESS,
  rpcUrl: process.env.RPC_URL,
  rpcFallbackUrls: [
    process.env.RPC_FALLBACK_1,
    process.env.RPC_FALLBACK_2
  ],
  contractAbi: BINGO_ABI.abi
});

// Listen to events
eventService.on('RoundCreated', (data) => {
  console.log('Round created:', data.roundId);
});

eventService.on('VrfFulfilled', (data) => {
  console.log('VRF fulfilled for round:', data.roundId);
});

eventService.on('error', (err) => {
  console.error('Event service error:', err);
});

eventService.on('reconnecting', (attempt) => {
  console.log(`Reconnecting (attempt ${attempt})...`);
});

// Start
await eventService.start();

// Stop gracefully
await eventService.stop();
```

**Events emitted:**
- `RoundCreated`: (roundId, scheduledClose)
- `CardsPurchased`: (roundId, user, count, cardIds, totalCost)
- `RoundClosed`: (roundId)
- `VrfRequested`: (roundId, requestId)
- `VrfFulfilled`: (roundId, randomness)
- `RoundResolved`: (roundId, drawnBalls, winners)
- `RoundCancelled`: (roundId, totalRefund)
- `error`: (error)
- `reconnecting`: (attempt)
- `reconnected`: ()

---

### 4. Bingo Scheduler with Orphan Recovery
**File:** `backend/src/services/bingoSchedulerOnChain.js`

**Purpose:** Manage Bingo round lifecycle with automatic recovery

**Features:**
- ✅ Multi-room scheduling (default: 4 rooms)
- ✅ Orphan round recovery on startup
- ✅ Periodic orphan recovery (every 5 minutes)
- ✅ Circuit breaker for repeated failures
- ✅ Auto-resolve rounds when VRF fulfilled
- ✅ Graceful shutdown

**Usage:**
```javascript
const BingoOnChainScheduler = require('./services/bingoSchedulerOnChain');

const BINGO_ABI = require('./abi/BingoGame.json');

const scheduler = new BingoOnChainScheduler({
  contractAddress: process.env.BINGO_CONTRACT_ADDRESS,
  rpcUrl: process.env.RPC_URL,
  operatorPrivateKey: process.env.OPERATOR_PRIVATE_KEY,
  contractAbi: BINGO_ABI.abi,

  // Optional config
  numRooms: 4,
  buyWindowSeconds: 45,
  roundIntervalSeconds: 120,
  enableOrphanRecovery: true,
  orphanRecoveryInterval: 300000, // 5 minutes
  maxConsecutiveFailures: 5
});

// Start
await scheduler.start();

// Get status
const status = scheduler.getStatus();
console.log(status);
// {
//   isRunning: true,
//   isCircuitBreakerOpen: false,
//   consecutiveFailures: 0,
//   rooms: [...],
//   stats: {
//     roundsCreated: 10,
//     roundsClosed: 8,
//     roundsResolved: 7,
//     orphansRecovered: 2
//   }
// }

// Stop gracefully
await scheduler.stop();
```

**Round Lifecycle:**
1. **CREATE** → Round created in OPEN state
2. **WAIT** → Buy window (45s default)
3. **CLOSE** → Call `closeAndRequestVRF()` → CLOSED → VRF_REQUESTED
4. **VRF WAIT** → Chainlink fulfills VRF → VRF_FULFILLED
5. **RESOLVE** → Auto-resolve round → RESOLVED
6. **REPEAT**

**Orphan Recovery:**
- Runs on startup BEFORE main loop
- Scans all rounds for stuck states:
  - CLOSED → Re-request VRF
  - VRF_REQUESTED → Wait for VRF (or timeout)
  - VRF_FULFILLED → Auto-resolve
- Runs periodically (every 5 minutes)

**Circuit Breaker:**
- Opens after 5 consecutive failures
- Cools down for 1 minute
- Prevents cascading failures

---

## 🚀 QUICK START: UNBLOCK BINGO

### Step 1: Cancel Orphan Rounds

```bash
cd contracts

# Preview what will be cancelled
DRY_RUN=true npx hardhat run scripts/emergency-cancel-rounds.js --network amoy

# Actually cancel
npx hardhat run scripts/emergency-cancel-rounds.js --network amoy
```

**Expected output:**
```
=== Found 4 orphan rounds ===
Cancelling orphan rounds...
  ✅ Cancelled round 1
  ✅ Cancelled round 2
  ✅ Cancelled round 3
  ✅ Cancelled round 4

✅ SUCCESS: All orphan rounds cancelled!
```

---

### Step 2: Verify VRF Configuration

```bash
npx hardhat run scripts/diagnose-vrf-config.js --network amoy
```

**Expected output:**
```
✅ VRF Coordinator has code (valid contract)
✅ BingoGame registered as consumer? YES
✅ Subscription has sufficient balance
✅ Gas estimate succeeded
```

**If you see errors:**
- ❌ Not registered → Go to vrf.chain.link and add consumer
- ❌ Zero balance → Fund subscription with LINK/MATIC
- ❌ Gas estimate failed → Check error code

---

### Step 3: Deploy Scheduler

```javascript
// backend/src/index.js or separate scheduler service

const BingoOnChainScheduler = require('./services/bingoSchedulerOnChain');
const BINGO_ABI = require('./abi/BingoGame.json');

const scheduler = new BingoOnChainScheduler({
  contractAddress: process.env.BINGO_CONTRACT_ADDRESS,
  rpcUrl: process.env.RPC_URL,
  operatorPrivateKey: process.env.OPERATOR_PRIVATE_KEY,
  contractAbi: BINGO_ABI.abi
});

// Start scheduler
await scheduler.start();

// Graceful shutdown on SIGINT
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await scheduler.stop();
  process.exit(0);
});
```

**Run:**
```bash
cd backend
node src/index.js
```

**Expected logs:**
```
[BingoScheduler] Starting...
[BingoScheduler] Connected at block 12345678
[BingoScheduler] Operator verified ✓

[Recovery] Scanning for orphan rounds...
[Recovery] No orphan rounds found ✓

[BingoScheduler] Starting event service...
[BingoEventService] Connected at block 12345678
[BingoEventService] Event listeners set up

[BingoScheduler] Starting scheduling loop...
[BingoScheduler] Room 1: Creating round...
[BingoScheduler] Room 1: Round 5 created ✓
[BingoScheduler] Room 2: Creating round...
[BingoScheduler] Room 2: Round 6 created ✓
...
```

---

### Step 4: Monitor for 48 Hours

**Exit Criteria for Phase 1:**
- ✅ Scheduler runs 48h continuously without errors
- ✅ 0 orphan rounds after 3 simulated restarts
- ✅ Event listener reconnects automatically
- ✅ VRF fulfillment succeeds 100% of time (n=10 rounds)

**Monitoring:**
```bash
# Check scheduler status
curl http://localhost:5000/admin/bingo/status

# Check logs for errors
tail -f backend/logs/bingo-scheduler.log | grep ERROR

# Verify no orphan rounds
npx hardhat run scripts/emergency-cancel-rounds.js --network amoy
# Should see: "No orphan rounds found"
```

---

## 🧪 TESTING

### Test 1: Orphan Recovery

```bash
# 1. Start scheduler
node backend/src/index.js

# 2. Let it create a round and wait for buy window

# 3. Kill scheduler mid-drawing (CTRL+C)

# 4. Restart scheduler
node backend/src/index.js

# Expected:
# [Recovery] Found orphan round 7: VRF_REQUESTED
# [Recovery] Round 7 waiting for VRF...
```

### Test 2: RPC Failover

```bash
# 1. Configure fallback RPCs in .env
RPC_URL=https://polygon-amoy.g.alchemy.com/v2/YOUR_KEY
RPC_FALLBACK_1=https://polygon-amoy.infura.io/v3/YOUR_KEY
RPC_FALLBACK_2=https://rpc-amoy.polygon.technology

# 2. Start scheduler

# 3. Block primary RPC (firewall or disconnect)

# Expected:
# [BingoEventService] Health check failed: connection timeout
# [BingoEventService] Rotating to fallback RPC 2/3
# [BingoEventService] Connected at block 12345690
# [BingoEventService] Event listeners set up
```

### Test 3: Circuit Breaker

```bash
# 1. Misconfigure contract address (trigger failures)
BINGO_CONTRACT_ADDRESS=0x0000000000000000000000000000000000000000

# 2. Start scheduler

# Expected after 5 failures:
# [BingoScheduler] ⚠️  CIRCUIT BREAKER OPEN (5 consecutive failures)
# [BingoScheduler] Cooling down for 60000ms...
# (waits 1 minute)
# [BingoScheduler] Circuit breaker cooldown complete, resetting...
```

---

## 📊 SUCCESS METRICS

| Metric | Target | Measurement |
|--------|--------|-------------|
| Scheduler uptime | 48h continuous | Monitor logs |
| Orphan rounds | 0 after 3 restarts | Run emergency script |
| VRF success rate | 100% (n=10) | Check event logs |
| RPC reconnections | Auto-recover in <60s | Monitor health checks |
| Circuit breaker | Triggers on 5 failures | Inject errors |

---

## 🔧 TROUBLESHOOTING

### Issue: MaxOpenRoundsReached persists after cleanup

**Diagnosis:**
```bash
npx hardhat run scripts/emergency-cancel-rounds.js --network amoy
```

**Possible causes:**
1. Script didn't have operator permissions
2. Some rounds failed to cancel
3. New orphans created after cleanup

**Fix:**
1. Verify operator wallet in script
2. Check transaction receipts
3. Run cleanup again

---

### Issue: VRF never fulfills

**Diagnosis:**
```bash
npx hardhat run scripts/diagnose-vrf-config.js --network amoy
```

**Possible causes:**
1. Subscription not funded
2. BingoGame not registered as consumer
3. Wrong VRF Coordinator address
4. Network congestion (rare)

**Fix:**
1. Fund subscription at vrf.chain.link
2. Add consumer address
3. Verify deployment config
4. Wait 2-5 minutes (Chainlink VRF can be slow on testnet)

---

### Issue: Event listener keeps disconnecting

**Diagnosis:**
Check logs for "filter not found" or "connection timeout"

**Possible causes:**
1. RPC provider instability
2. Firewall/network issues
3. WebSocket not supported

**Fix:**
1. Add fallback RPC URLs
2. Use HTTP(S) instead of WSS
3. Increase health check interval

---

## 📁 FILES CREATED IN PHASE 1

```
gold/
├── contracts/
│   └── scripts/
│       ├── emergency-cancel-rounds.js     ✅ Emergency cleanup
│       └── diagnose-vrf-config.js         ✅ VRF diagnostics
│
└── backend/
    └── src/
        └── services/
            ├── bingoEventService.js       ✅ Resilient events
            └── bingoSchedulerOnChain.js   ✅ Scheduler + recovery
```

---

## ✅ PHASE 1 COMPLETION CHECKLIST

Before proceeding to Phase 2:

- [ ] Emergency script successfully cancelled all orphan rounds
- [ ] VRF diagnostic shows:
  - [ ] Subscription funded (≥5 LINK or ≥50 MATIC)
  - [ ] BingoGame registered as consumer
  - [ ] Gas estimation succeeds
- [ ] Scheduler runs 48h without MaxOpenRoundsReached
- [ ] Event service reconnects after RPC failure
- [ ] Orphan recovery tested (kill + restart = recovery)
- [ ] 10 successful VRF fulfillments

**Sign-off:** _________________
**Date:** _________________

---

## 🚦 NEXT STEPS → PHASE 2

Once Phase 1 is validated:

1. **Phase 2.1:** Security audit (Slither, Mythril, manual review)
2. **Phase 2.2:** Code review (game logic, math validation)
3. **Phase 2.3:** Integration testing (E2E VRF flow)
4. **Phase 2.4:** Performance testing (100 concurrent users)

**Decision Gate 1:** Proceed to Phase 2 if ALL Phase 1 criteria are met.

---

**Document Version:** 1.0
**Last Updated:** 2026-02-19
**Author:** Claude Code (Autonomous)
