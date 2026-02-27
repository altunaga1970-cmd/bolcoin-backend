# AMOY_SETUP_STATUS — Bolcoin Smart Contracts on Polygon Amoy

**Document date:** 2026-02-27
**Network:** Polygon Amoy (testnet, chain ID 80002)
**Status:** Contracts deployed, VRF consumer registration pending

---

## 1. Deployed Contracts

| Contract       | Address                                      | Polygonscan |
|----------------|----------------------------------------------|-------------|
| KenoGame       | `0xAa1d6945e691807CBCC239F6C89C6469E0eD4998` | [View](https://amoy.polygonscan.com/address/0xAa1d6945e691807CBCC239F6C89C6469E0eD4998) |
| BingoGame      | `0x4B1f1e94a9651E84D8584760980f74C56Ee61652` | [View](https://amoy.polygonscan.com/address/0x4B1f1e94a9651E84D8584760980f74C56Ee61652) |
| LaBolitaGame   | `0x6B07df51947f3e476B7574C14fF3293a8a4c846A` | [View](https://amoy.polygonscan.com/address/0x6B07df51947f3e476B7574C14fF3293a8a4c846A) |

### Supporting addresses

| Role                    | Address |
|-------------------------|---------|
| Deployer / Owner        | `0x1DB00BB0Ab602fD42b89e16CDaD89619a6Df1E0D` |
| VRF Coordinator (Amoy)  | `0x343300b5d84D444B2ADc9116FEF1bED02BE49Cf2` |
| USDT token (Amoy mock)  | `0x78B85ACB36263D7A77671941E2B20940afAef359` |
| VRF Key Hash (500 gwei) | `0x816bedba8a50b294e5cbd47842baf240c2385f2eaf719edbd4f250a137a8c899` |

### VRF Subscription

| Parameter      | Value |
|----------------|-------|
| Sub ID         | `7970515401521569318593654502782683303673295181035791822529802935575344475841` |
| Dashboard      | https://vrf.chain.link |

---

## 2. Current State per Contract

### 2.1 KenoGame

**Architecture:** 1 bet = 1 VRF request. Trustless flow: `placeBet()` → Chainlink VRF → `fulfillRandomWords()` → direct ERC20 payout.

| Property | Expected / Known |
|----------|-----------------|
| Bet amount | 1 USDT (1e6) |
| Fee | 12% on losses (`feeBps = 1200`) |
| Payout table | Versioned, timelock after v1 |
| Settlement mode | MVP (VRF on-chain). Phase-2 off-chain settlement disabled by default |
| VRF callback gas | 300,000 |
| VRF confirmations | 3 blocks |
| Bet timeout | 1 hour (stale bets can be cancelled/refunded by anyone) |

**Known issues:**
- VRF consumer registration status unknown until `check-keno-vrf.js` / `status-amoy.js` is run against Amoy.
- Payout table v1 may or may not be committed depending on whether deploy gas was sufficient. Run `status-amoy.js` to confirm `payoutTableVersion > 0`.
- Pool likely unfunded (0 USDT). VRF will call back but payouts will be marked UNPAID if pool is empty.

---

### 2.2 BingoGame

**Architecture:** Multiplayer draw. Users call `buyCards()`. Operator calls `closeAndRequestVRF()`. VRF provides random seed. Operator resolves with EIP-712 signed result via `resolveRound()`.

| Property | Expected / Known |
|----------|-----------------|
| Card price | 1 USDT (1e6) |
| Fee | 10% (`feeBps = 1000`) |
| Reserve (jackpot) | 10% (`reserveBps = 1000`) |
| Line prize | 15% of winner pot |
| Bingo prize | 85% of winner pot |
| Jackpot ball threshold | 25 balls (bingo on/before ball 25 triggers jackpot) |
| Max cards per user | 4 |
| Max open rounds | 4 |
| VRF callback gas | 300,000 |
| VRF confirmations | 10 blocks |
| VRF timeout | 4 hours (emergency cancel after this) |

**Known issues:**
- VRF consumer registration status unknown until scripts are run.
- Prior Amoy Bingo history (orphan rounds, old addresses) does not affect the newly deployed `0x4B1f...` contract.
- Operator address must be set correctly for the backend scheduler to call `closeAndRequestVRF()` and `resolveRound()`.
- Pool needs funding (jackpot reserve + prize pool) before rounds can pay out.

---

### 2.3 LaBolitaGame

**Architecture:** Draw-based betting. Owner creates draws. Users place bets (`FIJO`/`CENTENA`/`PARLE`). Owner closes draw → VRF requested → 4-digit winning number generated → `fulfillRandomWords()` resolves all bets automatically.

| Property | Expected / Known |
|----------|-----------------|
| Bet types | Fijo (65x), Centena (300x), Parle (1000x) |
| Fee | 5% (`feeBps = 500`) |
| Min bet | 0.10 USDT |
| Max bet | 100 USDT |
| Max exposure per number | 500 USDT per draw |
| Max bets per draw | 500 |
| VRF callback gas | 200,000 |
| VRF confirmations | 3 blocks |
| VRF timeout | 2 hours |

**Known issues:**
- The `retryUnpaidBet` CEI fix has been applied in the source code (`b.payout = 0` before transfer). The currently deployed contract at `0x6B07...` on Amoy was deployed AFTER the fix was written, so this version should be safe. Verify the deployment transaction date on Polygonscan.
- VRF consumer registration status unknown until scripts are run.
- Pool needs funding before draws can pay winners.
- Frontend exists (`Web3BettingPage.jsx`) but requires correct Amoy addresses to be set in `VITE_BOLITA_CONTRACT_ADDRESS`.

---

## 3. Infrastructure

### Chainlink VRF (applies to all three contracts)

All three contracts inherit from `VRFConsumerBaseV2Plus` and use the same subscription. Each contract must be individually added as a consumer on the VRF dashboard or via `addConsumer()` on the coordinator.

**VRF flow:**
```
User action / Operator action
  → contract calls s_vrfCoordinator.requestRandomWords(...)
  → Chainlink oracle picks up request
  → Oracle calls contract.fulfillRandomWords(requestId, randomWords)
  → Contract resolves game logic and pays out
```

**Requirements for VRF to work:**
1. Contract registered as consumer on the subscription.
2. Subscription has sufficient LINK balance (recommended: >= 2 LINK per game active at once).
3. Subscription ID stored inside each contract matches the actual subscription ID.
4. Key hash stored inside contract matches the 500 gwei gas lane.

---

## 4. Scripts Available

All scripts are in `contracts/scripts/`. Run with:
```
npx hardhat run scripts/<name>.js --network amoy
```

| Script | Purpose |
|--------|---------|
| `status-amoy.js` | Read-only snapshot of all 3 contracts + VRF subscription |
| `add-keno-consumer-amoy.js` | Register KenoGame as VRF consumer (sub owner only) |
| `check-keno-vrf.js` | Diagnose VRF config stored in KenoGame |
| `fund-vrf-keno.js` | Fund VRF sub with LINK + register KenoGame as consumer (old sub ID) |
| `diagnose-vrf-config.js` | Full VRF diagnostic for BingoGame |
| `recover-keno-payout-amoy.js` | Write/commit payout table for Keno if not done |
| `finish-keno-payout-amoy.js` | Write spots 9-10 + commit payout table |
| `fund-bingo-amoy.js` | Fund BingoGame pool with USDT |
| `set-bingo-operator.js` | Set operator address on BingoGame |
| `emergency-cancel-rounds.js` | Cancel orphan OPEN rounds in BingoGame |
| `cancel-rounds-direct.js` | Cancel rounds by ID directly |
| `check-balances.js` | Check POL balances of deployer and operator wallets |
| `transfer-matic.js` | Transfer POL from deployer to operator |
| `pre-deployment-check.js` | Interactive pre-deploy checklist for Bingo |

---

## 5. Remaining Steps for Production Testing

Work through these steps in order. Run `status-amoy.js` after each group to confirm state.

### Step 1 — Verify VRF subscription balance

```bash
npx hardhat run scripts/status-amoy.js --network amoy
```

Check the `[VRF]` section output:
- `LINK balance` must be >= 2 LINK (get from https://faucets.chain.link selecting Polygon Amoy).
- All three contracts must show `REGISTERED` in the consumer table.

If LINK balance is low, fund at https://vrf.chain.link or via `transferAndCall` on the LINK ERC-677 token.

---

### Step 2 — Register all three contracts as VRF consumers

Only the subscription owner (`0x1DB00BB0Ab602fD42b89e16CDaD89619a6Df1E0D`) can do this.

**Option A — Via script (recommended for Keno):**
```bash
npx hardhat run scripts/add-keno-consumer-amoy.js --network amoy
```
This script:
- Verifies the signer is the sub owner.
- Calls `coordinator.addConsumer(subId, kenoAddress)` if not already registered.
- Optionally calls `keno.setVrfConfig()` if the sub ID inside the contract is wrong.

**Option B — Via Chainlink dashboard (for all three contracts):**
1. Go to https://vrf.chain.link
2. Select Polygon Amoy network.
3. Open subscription `7970515401521569318593654502782683303673295181035791822529802935575344475841`.
4. Click "Add consumer" for each:
   - KenoGame:     `0xAa1d6945e691807CBCC239F6C89C6469E0eD4998`
   - BingoGame:    `0x4B1f1e94a9651E84D8584760980f74C56Ee61652`
   - LaBolitaGame: `0x6B07df51947f3e476B7574C14fF3293a8a4c846A`

---

### Step 3 — Verify Keno payout table

```bash
npx hardhat run scripts/status-amoy.js --network amoy
```

Check `payoutTableVersion` in the `[KENO]` section. If it is `0` (not committed), run:

```bash
npx hardhat run scripts/recover-keno-payout-amoy.js --network amoy
```

This script detects the state and writes + commits the full 10-spot payout table in one go. Requires the deployer wallet (owner of KenoGame). Gas cost: ~10 transactions.

---

### Step 4 — Fund the prize pools

Each contract holds USDT directly. The `availablePool()` view returns the balance minus accrued fees (and jackpot for Bingo).

**Keno:**
Approve USDT to `0xAa1d6945...` then call `keno.fundPool(amount)` (owner only). Recommended: >= 100 USDT for testnet.

**Bingo:**
```bash
# Edit fund-bingo-amoy.js to point at 0x4B1f... and the Amoy USDT address,
# then run:
npx hardhat run scripts/fund-bingo-amoy.js --network amoy
```
Or call `bingo.fundPool(amount)` directly. Recommended: >= 500 USDT so jackpot builds up.

**LaBolita:**
Approve USDT then call `bolita.fundPool(amount)` (owner only). The pool must cover the maximum payout per draw (`maxExposurePerNumber × number_of_numbers × multiplier`). Recommended: >= 1000 USDT for a Parle-capable pool.

---

### Step 5 — Set Bingo operator

The BingoGame scheduler on the backend calls `closeAndRequestVRF()` and `resolveRound()`. The wallet used by the backend must match the `operator` address set in the contract.

```bash
# Verify current operator via status-amoy.js [BINGO] section
npx hardhat run scripts/set-bingo-operator.js --network amoy
```

The `operator` address should be the Railway backend wallet (`OPERATOR_ADDRESS` env var).

---

### Step 6 — Confirm VRF subscriptionId inside each contract

Run `status-amoy.js` and compare the `VRF sub ID` field of each contract against the canonical subscription ID:

```
7970515401521569318593654502782683303673295181035791822529802935575344475841
```

If mismatched:
- **Keno:** `add-keno-consumer-amoy.js` handles this automatically via `setVrfConfig()`.
- **Bingo / Bolita:** Call `setVrfConfig(subId, keyHash, gasLimit, confirmations)` as owner.

---

### Step 7 — End-to-end test

**Keno test flow:**
1. Approve 1 USDT to KenoGame from a test wallet.
2. Call `keno.placeBet([1,2,3,4,5])` (5-spot bet).
3. Wait for VRF callback (a few blocks, ~30-60 seconds on Amoy).
4. Check `keno.bets(betId)` — status should be `PAID` (1) or `UNPAID` (2).
5. If `UNPAID`, pool is empty — fund the pool and call `keno.retryUnpaidBet(betId)`.

**Bingo test flow:**
1. Operator creates a round via `bingo.createRound(scheduledClose)`.
2. Buy 1 card: approve 1 USDT, call `bingo.buyCards(roundId, 1)`.
3. Wait for `scheduledClose` to pass.
4. Operator calls `bingo.closeAndRequestVRF(roundId)`.
5. Wait for VRF fulfillment.
6. Operator calls `bingo.resolveRound(...)` with EIP-712 signed result.

**LaBolita test flow:**
1. Owner creates a draw: `bolita.createDraw("TEST-001", scheduledTime)`.
2. Open it: `bolita.openDraw(drawId)`.
3. Place a bet: approve USDT, call `bolita.placeBet(drawId, 0, 42, amount)` (FIJO on number 42).
4. Owner closes: `bolita.closeDraw(drawId)`.
5. Wait for VRF fulfillment and automatic resolution.

---

### Step 8 — Configure backend environment variables (Railway)

After verifying the contracts work on Amoy, set these Railway env vars so the backend and frontend use the correct Amoy addresses:

```
KENO_CONTRACT_ADDRESS=0xAa1d6945e691807CBCC239F6C89C6469E0eD4998
BINGO_CONTRACT_ADDRESS=0x4B1f1e94a9651E84D8584760980f74C56Ee61652
BOLITA_CONTRACT_ADDRESS=0x6B07df51947f3e476B7574C14fF3293a8a4c846A
PAYMENT_TOKEN_ADDRESS=0x78B85ACB36263D7A77671941E2B20940afAef359

VITE_KENO_CONTRACT_ADDRESS=0xAa1d6945e691807CBCC239F6C89C6469E0eD4998
VITE_BINGO_CONTRACT_ADDRESS=0x4B1f1e94a9651E84D8584760980f74C56Ee61652
VITE_BOLITA_CONTRACT_ADDRESS=0x6B07df51947f3e476B7574C14fF3293a8a4c846A
VITE_TOKEN_ADDRESS=0x78B85ACB36263D7A77671941E2B20940afAef359

POLYGON_CHAIN_ID=80002
RPC_URL=https://polygon-amoy.g.alchemy.com/v2/<YOUR_KEY>
```

---

## 6. Known Risks and Blockers

| Risk | Severity | Mitigation |
|------|----------|-----------|
| VRF consumers not registered | BLOCKER | Run `add-keno-consumer-amoy.js` + dashboard for all three |
| VRF subscription underfunded | BLOCKER | Fund at https://vrf.chain.link with testnet LINK |
| Prize pools empty | BLOCKER | Fund via `fundPool()` on each contract |
| Payout table not committed (Keno) | BLOCKER | Run `recover-keno-payout-amoy.js` |
| Bingo operator mismatch | BLOCKER | Match contract operator to backend wallet via `set-bingo-operator.js` |
| LaBolita `retryUnpaidBet` bug | FIXED | CEI fix applied before this Amoy deploy. Verify deploy timestamp > 2026-02-25 |
| Exposed credentials in git history | URGENT | Rotate `DEPLOYER_KEY`, `JWT_SECRET`, `DATABASE_URL` in Railway immediately |
| Sub ID mismatch inside contracts | MODERATE | `add-keno-consumer-amoy.js` detects and fixes for Keno; check others via `status-amoy.js` |

---

## 7. Quick Reference Commands

```bash
# Check complete state of all contracts
npx hardhat run scripts/status-amoy.js --network amoy

# Register KenoGame as VRF consumer
npx hardhat run scripts/add-keno-consumer-amoy.js --network amoy

# Recover Keno payout table if not committed
npx hardhat run scripts/recover-keno-payout-amoy.js --network amoy

# Diagnose VRF config for BingoGame
BINGO_CONTRACT_ADDRESS=0x4B1f1e94a9651E84D8584760980f74C56Ee61652 \
  npx hardhat run scripts/diagnose-vrf-config.js --network amoy

# Check wallet balances (POL)
npx hardhat run scripts/check-balances.js --network amoy

# Diagnose Keno VRF only
npx hardhat run scripts/check-keno-vrf.js --network amoy
```

---

## 8. Useful Links

| Resource | URL |
|----------|-----|
| Amoy Polygonscan | https://amoy.polygonscan.com |
| Chainlink VRF Dashboard | https://vrf.chain.link |
| Polygon Amoy Faucet (POL) | https://faucet.polygon.technology |
| Chainlink Faucet (LINK) | https://faucets.chain.link |
| Amoy RPC (Alchemy) | `https://polygon-amoy.g.alchemy.com/v2/<key>` |
| Amoy RPC (public) | `https://rpc-amoy.polygon.technology` |
