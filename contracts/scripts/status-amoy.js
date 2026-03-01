/**
 * status-amoy.js
 *
 * Read-only status snapshot of all three Bolcoin contracts on Polygon Amoy.
 * Covers: KenoGame, BingoGame, LaBolitaGame.
 *
 * Usage:
 *   npx hardhat run scripts/status-amoy.js --network amoy
 *
 * No wallet required for read-only calls (provider is used directly).
 * If DEPLOYER_KEY is set in contracts/.env, the signer's POL balance is also shown.
 *
 * Output sections:
 *   [NET]   Network info
 *   [VRF]   VRF subscription status (balance, consumers for all three contracts)
 *   [KENO]  KenoGame state
 *   [BINGO] BingoGame state
 *   [BOLI]  LaBolitaGame state
 */

const { ethers } = require("hardhat");

// ─── Deployed addresses (Polygon Amoy) ───────────────────────────────────────
const ADDRESSES = {
  keno:    "0xAa1d6945e691807CBCC239F6C89C6469E0eD4998",
  bingo:   "0x4B1f1e94a9651E84D8584760980f74C56Ee61652",
  bolita:  "0x1F4c288f6e5dE5731783bBaF83555CC926dDB383", // v2 (double-pay fix)
};

const VRF_COORDINATOR = process.env.VRF_COORDINATOR_ADDRESS || "0x343300b5d84D444B2ADc9116FEF1bED02BE49Cf2";
const USDT_ADDRESS    = "0x78B85ACB36263D7A77671941E2B20940afAef359";
const SUB_ID          = process.env.VRF_SUBSCRIPTION_ID || "";

// ─── ABIs (minimal, view-only) ────────────────────────────────────────────────

const COORDINATOR_ABI = [
  "function getSubscription(uint256 subId) view returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address subOwner, address[] consumers)",
  "function typeAndVersion() view returns (string)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

const KENO_ABI = [
  "function owner() view returns (address)",
  "function operator() view returns (address)",
  "function paused() view returns (bool)",
  "function settlementEnabled() view returns (bool)",
  "function betAmount() view returns (uint256)",
  "function betCounter() view returns (uint256)",
  "function pendingBetCount() view returns (uint256)",
  "function availablePool() view returns (uint256)",
  "function accruedFees() view returns (uint256)",
  "function feeBps() view returns (uint16)",
  "function payoutTableVersion() view returns (uint256)",
  "function payoutEffectiveFromBetId() view returns (uint256)",
  "function lastPayoutUpdateTimestamp() view returns (uint256)",
  "function vrfSubscriptionId() view returns (uint256)",
  "function vrfKeyHash() view returns (bytes32)",
  "function vrfCallbackGasLimit() view returns (uint32)",
  "function vrfRequestConfirmations() view returns (uint16)",
  // Payout table read-out
  "function getPayoutMultiplier(uint8 spots, uint8 hits) view returns (uint32)",
];

const BINGO_ABI = [
  "function owner() view returns (address)",
  "function operator() view returns (address)",
  "function paused() view returns (bool)",
  "function cardPrice() view returns (uint256)",
  "function cardCounter() view returns (uint256)",
  "function roundCounter() view returns (uint256)",
  "function availablePool() view returns (uint256)",
  "function accruedFees() view returns (uint256)",
  "function jackpotBalance() view returns (uint256)",
  "function feeBps() view returns (uint16)",
  "function reserveBps() view returns (uint16)",
  "function linePrizeBps() view returns (uint16)",
  "function bingoPrizeBps() view returns (uint16)",
  "function vrfSubscriptionId() view returns (uint256)",
  "function vrfKeyHash() view returns (bytes32)",
  "function vrfCallbackGasLimit() view returns (uint32)",
  "function vrfRequestConfirmations() view returns (uint16)",
  "function vrfTimeoutSeconds() view returns (uint256)",
  "function jackpotBallThreshold() view returns (uint8)",
  // Latest round data
  "function rounds(uint256 roundId) view returns (uint256 id, uint8 status, uint256 scheduledClose, uint256 totalCards, uint256 totalRevenue, uint256 vrfRequestId, uint256 vrfRequestedAt, uint256 vrfRandomWord, uint256 cardPriceAtCreation, uint16 feeBpsAtCreation, uint16 reserveBpsAtCreation, uint16 linePrizeBpsAtCreation, uint16 bingoPrizeBpsAtCreation, address[] lineWinners, uint8 lineWinnerBall, address[] bingoWinners, uint8 bingoWinnerBall, bool jackpotWon, uint256 jackpotPaid, uint256 feeAmount, uint256 reserveAmount, uint256 linePrize, uint256 bingoPrize)",
];

const BOLITA_ABI = [
  "function owner() view returns (address)",
  "function paused() view returns (bool)",
  "function drawCounter() view returns (uint256)",
  "function betCounter() view returns (uint256)",
  "function availablePool() view returns (uint256)",
  "function accruedFees() view returns (uint256)",
  "function feeBps() view returns (uint16)",
  "function minBetAmount() view returns (uint256)",
  "function maxBetAmount() view returns (uint256)",
  "function maxExposurePerNumber() view returns (uint256)",
  "function fijoMultiplier() view returns (uint32)",
  "function centenaMultiplier() view returns (uint32)",
  "function parleMultiplier() view returns (uint32)",
  "function vrfSubscriptionId() view returns (uint256)",
  "function vrfKeyHash() view returns (bytes32)",
  "function vrfCallbackGasLimit() view returns (uint32)",
  "function vrfRequestConfirmations() view returns (uint16)",
  // Latest draw data
  "function draws(uint256 drawId) view returns (uint256 id, string drawNumber, uint256 scheduledTime, uint8 status, uint16 winningNumber, uint256 totalBets, uint256 totalAmount, uint256 totalPaidOut, uint256 vrfRequestId, uint256 vrfRequestedAt, uint256 betsResolved)",
];

// ─── Helper: status label strings ────────────────────────────────────────────

const BINGO_STATUS = ["NONE", "OPEN", "CLOSED", "VRF_REQUESTED", "VRF_FULFILLED", "RESOLVED", "CANCELLED"];
const BOLITA_STATUS = ["SCHEDULED", "OPEN", "CLOSED", "VRF_PENDING", "VRF_FULFILLED", "COMPLETED", "CANCELLED"];

function fmtUsdt(bn) {
  return ethers.formatUnits(bn, 6) + " USDT";
}

function fmtBool(b) {
  return b ? "YES" : "NO";
}

function fmtTimestamp(ts) {
  if (ts === 0n) return "N/A";
  return new Date(Number(ts) * 1000).toISOString();
}

function sep(label) {
  const line = "─".repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${label}`);
  console.log(line);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const provider = ethers.provider;

  // ── Network info ────────────────────────────────────────────────────────────
  sep("[NET] Network");
  const network = await provider.getNetwork();
  const block   = await provider.getBlock("latest");
  console.log("Chain ID   :", network.chainId.toString());
  console.log("Block      :", block.number);
  console.log("Timestamp  :", fmtTimestamp(BigInt(block.timestamp)));

  // Optional: show signer balance if key is configured
  try {
    const [signer] = await ethers.getSigners();
    const polBal = await provider.getBalance(signer.address);
    console.log("Signer     :", signer.address);
    console.log("POL balance:", ethers.formatEther(polBal), "POL");
  } catch {
    console.log("Signer     : (no DEPLOYER_KEY configured — read-only mode)");
  }

  // ── USDT token ──────────────────────────────────────────────────────────────
  const usdt = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, provider);
  let usdtSymbol = "USDT";
  try {
    usdtSymbol = await usdt.symbol();
  } catch { /* ignore */ }
  console.log("USDT token :", USDT_ADDRESS, `(${usdtSymbol})`);

  // ── VRF subscription ────────────────────────────────────────────────────────
  sep("[VRF] Chainlink VRF Subscription");
  console.log("Coordinator:", VRF_COORDINATOR);
  console.log("Sub ID     :", SUB_ID);

  const coordCode = await provider.getCode(VRF_COORDINATOR);
  if (coordCode === "0x") {
    console.log("ERROR: VRF Coordinator has no code — wrong network?");
  } else {
    const coordinator = new ethers.Contract(VRF_COORDINATOR, COORDINATOR_ABI, provider);
    try {
      const ver = await coordinator.typeAndVersion();
      console.log("Version    :", ver);
    } catch { /* ignore */ }

    try {
      const sub = await coordinator.getSubscription(BigInt(SUB_ID));
      console.log("LINK balance  :", ethers.formatEther(sub.balance), "LINK");
      console.log("Native balance:", ethers.formatEther(sub.nativeBalance), "POL");
      console.log("Request count :", sub.reqCount.toString());
      console.log("Sub owner     :", sub.subOwner);

      // Check each contract
      const contractList = [
        { name: "KenoGame",      addr: ADDRESSES.keno   },
        { name: "BingoGame",     addr: ADDRESSES.bingo  },
        { name: "LaBolitaGame",  addr: ADDRESSES.bolita },
      ];
      console.log("\nConsumer registration:");
      for (const c of contractList) {
        const isConsumer = sub.consumers
          .map(a => a.toLowerCase())
          .includes(c.addr.toLowerCase());
        console.log(`  ${c.name.padEnd(14)}: ${c.addr}  ${isConsumer ? "REGISTERED" : "NOT REGISTERED"}`);
      }

      if (sub.balance < ethers.parseEther("1") && sub.nativeBalance < ethers.parseEther("5")) {
        console.log("\n  WARNING: Subscription balance is low. Fund at https://vrf.chain.link");
      }
    } catch (err) {
      console.log("ERROR reading subscription:", err.message);
    }
  }

  // ════════════════════════════════════════
  //  KENO GAME
  // ════════════════════════════════════════
  sep("[KENO] KenoGame — " + ADDRESSES.keno);

  const kenoCode = await provider.getCode(ADDRESSES.keno);
  if (kenoCode === "0x") {
    console.log("ERROR: No code at this address.");
  } else {
    const keno = new ethers.Contract(ADDRESSES.keno, KENO_ABI, provider);

    try {
      const [
        owner, operator, paused, settlementEnabled,
        betAmount, betCounter, pendingBetCount,
        pool, accruedFees, feeBps,
        payoutVersion, payoutEffFrom, lastPayoutTs,
        vrfSubId, vrfKeyHash, vrfGasLimit, vrfConfirms,
        tokenBal,
      ] = await Promise.all([
        keno.owner(),
        keno.operator(),
        keno.paused(),
        keno.settlementEnabled(),
        keno.betAmount(),
        keno.betCounter(),
        keno.pendingBetCount(),
        keno.availablePool(),
        keno.accruedFees(),
        keno.feeBps(),
        keno.payoutTableVersion(),
        keno.payoutEffectiveFromBetId(),
        keno.lastPayoutUpdateTimestamp(),
        keno.vrfSubscriptionId(),
        keno.vrfKeyHash(),
        keno.vrfCallbackGasLimit(),
        keno.vrfRequestConfirmations(),
        usdt.balanceOf(ADDRESSES.keno),
      ]);

      console.log("Owner              :", owner);
      console.log("Operator           :", operator);
      console.log("Paused             :", fmtBool(paused));
      console.log("Settlement enabled :", fmtBool(settlementEnabled));
      console.log("Bet amount         :", fmtUsdt(betAmount));
      console.log("Total bets placed  :", betCounter.toString());
      console.log("Pending bets       :", pendingBetCount.toString());
      console.log("Token balance      :", fmtUsdt(tokenBal));
      console.log("Available pool     :", fmtUsdt(pool));
      console.log("Accrued fees       :", fmtUsdt(accruedFees));
      console.log("Fee BPS            :", feeBps.toString(), `(${Number(feeBps) / 100}%)`);
      console.log("Payout table ver.  :", payoutVersion.toString(), payoutVersion === 0n ? "(NOT SET)" : "");
      console.log("Payout eff. from   :", payoutEffFrom.toString());
      console.log("Last payout update :", fmtTimestamp(lastPayoutTs));
      console.log("VRF sub ID         :", vrfSubId.toString());
      console.log("VRF key hash       :", vrfKeyHash);
      console.log("VRF gas limit      :", vrfGasLimit.toString());
      console.log("VRF confirmations  :", vrfConfirms.toString());

      // Show a sample of the payout table (spots 1, 5, 10) if version > 0
      if (payoutVersion > 0n) {
        console.log("\nPayout table sample (current version):");
        for (const spots of [1, 5, 10]) {
          const row = [];
          for (let h = 0; h <= spots; h++) {
            const m = await keno.getPayoutMultiplier(spots, h);
            row.push((Number(m) / 100).toFixed(2) + "x");
          }
          console.log(`  Spots ${String(spots).padStart(2)}: [${row.join(", ")}]`);
        }
      }

      // Readiness checklist
      console.log("\nReadiness checklist:");
      console.log("  Payout table set    :", fmtBool(payoutVersion > 0n));
      console.log("  Pool funded (>0)    :", fmtBool(pool > 0n));
      console.log("  Not paused          :", fmtBool(!paused));
      console.log("  VRF sub configured  :", fmtBool(vrfSubId > 0n));

    } catch (err) {
      console.log("ERROR reading KenoGame:", err.message);
    }
  }

  // ════════════════════════════════════════
  //  BINGO GAME
  // ════════════════════════════════════════
  sep("[BINGO] BingoGame — " + ADDRESSES.bingo);

  const bingoCode = await provider.getCode(ADDRESSES.bingo);
  if (bingoCode === "0x") {
    console.log("ERROR: No code at this address.");
  } else {
    const bingo = new ethers.Contract(ADDRESSES.bingo, BINGO_ABI, provider);

    try {
      const [
        owner, operator, paused,
        cardPrice, cardCounter, roundCounter,
        pool, accruedFees, jackpot,
        feeBps, reserveBps, linePrizeBps, bingoPrizeBps,
        vrfSubId, vrfKeyHash, vrfGasLimit, vrfConfirms, vrfTimeout,
        jackpotThreshold, tokenBal,
      ] = await Promise.all([
        bingo.owner(),
        bingo.operator(),
        bingo.paused(),
        bingo.cardPrice(),
        bingo.cardCounter(),
        bingo.roundCounter(),
        bingo.availablePool(),
        bingo.accruedFees(),
        bingo.jackpotBalance(),
        bingo.feeBps(),
        bingo.reserveBps(),
        bingo.linePrizeBps(),
        bingo.bingoPrizeBps(),
        bingo.vrfSubscriptionId(),
        bingo.vrfKeyHash(),
        bingo.vrfCallbackGasLimit(),
        bingo.vrfRequestConfirmations(),
        bingo.vrfTimeoutSeconds(),
        bingo.jackpotBallThreshold(),
        usdt.balanceOf(ADDRESSES.bingo),
      ]);

      console.log("Owner              :", owner);
      console.log("Operator           :", operator);
      console.log("Paused             :", fmtBool(paused));
      console.log("Card price         :", fmtUsdt(cardPrice));
      console.log("Total cards issued :", cardCounter.toString());
      console.log("Total rounds       :", roundCounter.toString());
      console.log("Token balance      :", fmtUsdt(tokenBal));
      console.log("Available pool     :", fmtUsdt(pool));
      console.log("Accrued fees       :", fmtUsdt(accruedFees));
      console.log("Jackpot balance    :", fmtUsdt(jackpot));
      console.log("Fee BPS            :", feeBps.toString(), `(${Number(feeBps) / 100}%)`);
      console.log("Reserve BPS        :", reserveBps.toString(), `(${Number(reserveBps) / 100}%)`);
      console.log("Line prize BPS     :", linePrizeBps.toString(), `(${Number(linePrizeBps) / 100}%)`);
      console.log("Bingo prize BPS    :", bingoPrizeBps.toString(), `(${Number(bingoPrizeBps) / 100}%)`);
      console.log("Jackpot ball thrs. :", jackpotThreshold.toString(), "balls");
      console.log("VRF sub ID         :", vrfSubId.toString());
      console.log("VRF key hash       :", vrfKeyHash);
      console.log("VRF gas limit      :", vrfGasLimit.toString());
      console.log("VRF confirmations  :", vrfConfirms.toString());
      console.log("VRF timeout        :", vrfTimeout.toString(), "sec", `(${Number(vrfTimeout) / 3600}h)`);

      // Read last 3 rounds
      const totalRounds = Number(roundCounter);
      if (totalRounds > 0) {
        const start = Math.max(1, totalRounds - 2);
        console.log(`\nLast ${totalRounds - start + 1} round(s):`);
        for (let i = start; i <= totalRounds; i++) {
          try {
            const r = await bingo.rounds(i);
            const statusLabel = BINGO_STATUS[Number(r.status)] || "UNKNOWN";
            console.log(`  Round ${i}: status=${statusLabel}, cards=${r.totalCards}, revenue=${fmtUsdt(r.totalRevenue)}, close=${fmtTimestamp(r.scheduledClose)}`);
          } catch (e) {
            console.log(`  Round ${i}: ERROR reading (${e.message})`);
          }
        }
      }

      // Readiness checklist
      console.log("\nReadiness checklist:");
      console.log("  Pool funded (>0)   :", fmtBool(pool > 0n));
      console.log("  Not paused         :", fmtBool(!paused));
      console.log("  VRF sub configured :", fmtBool(vrfSubId > 0n));

    } catch (err) {
      console.log("ERROR reading BingoGame:", err.message);
    }
  }

  // ════════════════════════════════════════
  //  LA BOLITA GAME
  // ════════════════════════════════════════
  sep("[BOLI] LaBolitaGame — " + ADDRESSES.bolita);

  const bolitaCode = await provider.getCode(ADDRESSES.bolita);
  if (bolitaCode === "0x") {
    console.log("ERROR: No code at this address.");
  } else {
    const bolita = new ethers.Contract(ADDRESSES.bolita, BOLITA_ABI, provider);

    try {
      const [
        owner, paused,
        drawCounter, betCounter,
        pool, accruedFees, feeBps,
        minBet, maxBet, maxExposure,
        fijoMult, centenaMult, parleMult,
        vrfSubId, vrfKeyHash, vrfGasLimit, vrfConfirms,
        tokenBal,
      ] = await Promise.all([
        bolita.owner(),
        bolita.paused(),
        bolita.drawCounter(),
        bolita.betCounter(),
        bolita.availablePool(),
        bolita.accruedFees(),
        bolita.feeBps(),
        bolita.minBetAmount(),
        bolita.maxBetAmount(),
        bolita.maxExposurePerNumber(),
        bolita.fijoMultiplier(),
        bolita.centenaMultiplier(),
        bolita.parleMultiplier(),
        bolita.vrfSubscriptionId(),
        bolita.vrfKeyHash(),
        bolita.vrfCallbackGasLimit(),
        bolita.vrfRequestConfirmations(),
        usdt.balanceOf(ADDRESSES.bolita),
      ]);

      console.log("Owner              :", owner);
      console.log("Paused             :", fmtBool(paused));
      console.log("Total draws        :", drawCounter.toString());
      console.log("Total bets placed  :", betCounter.toString());
      console.log("Token balance      :", fmtUsdt(tokenBal));
      console.log("Available pool     :", fmtUsdt(pool));
      console.log("Accrued fees       :", fmtUsdt(accruedFees));
      console.log("Fee BPS            :", feeBps.toString(), `(${Number(feeBps) / 100}%)`);
      console.log("Min bet amount     :", fmtUsdt(minBet));
      console.log("Max bet amount     :", fmtUsdt(maxBet));
      console.log("Max exposure/num.  :", fmtUsdt(maxExposure));
      console.log("Fijo multiplier    :", (Number(fijoMult) / 100).toFixed(2) + "x");
      console.log("Centena multiplier :", (Number(centenaMult) / 100).toFixed(2) + "x");
      console.log("Parle multiplier   :", (Number(parleMult) / 100).toFixed(2) + "x");
      console.log("VRF sub ID         :", vrfSubId.toString());
      console.log("VRF key hash       :", vrfKeyHash);
      console.log("VRF gas limit      :", vrfGasLimit.toString());
      console.log("VRF confirmations  :", vrfConfirms.toString());

      // Read last 3 draws
      const totalDraws = Number(drawCounter);
      if (totalDraws > 0) {
        const start = Math.max(1, totalDraws - 2);
        console.log(`\nLast ${totalDraws - start + 1} draw(s):`);
        for (let i = start; i <= totalDraws; i++) {
          try {
            const d = await bolita.draws(i);
            const statusLabel = BOLITA_STATUS[Number(d.status)] || "UNKNOWN";
            const scheduledStr = fmtTimestamp(d.scheduledTime);
            console.log(`  Draw ${i} "${d.drawNumber}": status=${statusLabel}, bets=${d.totalBets}, amount=${fmtUsdt(d.totalAmount)}, scheduled=${scheduledStr}`);
            if (Number(d.status) >= 4) { // VRF_FULFILLED or later
              console.log(`         winningNumber=${d.winningNumber}, paidOut=${fmtUsdt(d.totalPaidOut)}, resolved=${d.betsResolved}/${d.totalBets}`);
            }
          } catch (e) {
            console.log(`  Draw ${i}: ERROR reading (${e.message})`);
          }
        }
      }

      // Readiness checklist
      console.log("\nReadiness checklist:");
      console.log("  Pool funded (>0)   :", fmtBool(pool > 0n));
      console.log("  Not paused         :", fmtBool(!paused));
      console.log("  VRF sub configured :", fmtBool(vrfSubId > 0n));

    } catch (err) {
      console.log("ERROR reading LaBolitaGame:", err.message);
    }
  }

  // ─── Final summary ──────────────────────────────────────────────────────────
  sep("SUMMARY");
  console.log("Keno   :", ADDRESSES.keno);
  console.log("Bingo  :", ADDRESSES.bingo);
  console.log("Bolita :", ADDRESSES.bolita);
  console.log("\nPolygonscan (Amoy):");
  for (const [name, addr] of Object.entries(ADDRESSES)) {
    console.log(`  ${name.padEnd(7)}: https://amoy.polygonscan.com/address/${addr}`);
  }
  console.log("\nVRF dashboard : https://vrf.chain.link");
  console.log("Amoy faucet   : https://faucet.polygon.technology");
  console.log("LINK faucet   : https://faucets.chain.link");
  console.log("─".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nFatal error:", err.message);
    process.exit(1);
  });
