/**
 * Retire old KenoGame from Polygon Mainnet.
 *
 * What this does:
 *   1. Pauses the contract (no new bets possible)
 *   2. Withdraws all accrued fees to deployer wallet
 *   3. Reports pool balance (pool USDT is locked by design — no withdrawPool())
 *
 * IMPORTANT: Pool USDT cannot be withdrawn by the owner (by design, to protect users).
 * If there are no active/pending users, funds are effectively abandoned.
 *
 * Usage:
 *   OLD_KENO_ADDRESS=0xYOUR_OLD_KENO_ADDRESS \
 *   npx hardhat run scripts/retire-keno-polygon.js --network polygon
 */
const { ethers } = require("hardhat");

async function main() {
  const kenoAddress = process.env.OLD_KENO_ADDRESS
    || "0xAa1d6945e691807CBCC239F6C89C6469E0eD4998";

  const [signer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(signer.address);

  console.log("=== Retire KenoGame — Polygon Mainnet ===");
  console.log("Signer  :", signer.address);
  console.log("Balance :", ethers.formatEther(balance), "MATIC");
  console.log("Keno    :", kenoAddress);

  const keno = await ethers.getContractAt("KenoGame", kenoAddress);

  // ── 1. Check current state ─────────────────────────────────────────────
  const isPaused      = await keno.paused();
  const accruedFees   = await keno.accruedFees();
  const pendingBets   = await keno.pendingBetCount();
  const poolBalance   = await keno.availablePool();
  const payToken      = await keno.paymentToken();

  console.log("\n── Contract State ──────────────────────────────────────");
  console.log("Paused         :", isPaused);
  console.log("Pending bets   :", pendingBets.toString());
  console.log("Accrued fees   :", ethers.formatUnits(accruedFees, 6), "USDT");
  console.log("Available pool :", ethers.formatUnits(poolBalance, 6), "USDT");
  console.log("Payment token  :", payToken);

  if (pendingBets > 0n) {
    console.log("\n⚠️  WARNING: There are", pendingBets.toString(), "pending bets.");
    console.log("   These bets are waiting for VRF fulfillment.");
    console.log("   Wait for them to resolve OR let users call cancelStaleBet() after 1h timeout.");
    console.log("   Pausing now will prevent NEW bets but won't affect pending ones.");
  }

  // ── 2. Pause the contract ──────────────────────────────────────────────
  if (!isPaused) {
    console.log("\nPausing contract...");
    const tx = await keno.pause();
    await tx.wait();
    console.log("✅ Contract PAUSED — no new bets possible");
  } else {
    console.log("\n✅ Contract already paused");
  }

  // ── 3. Withdraw accrued fees ───────────────────────────────────────────
  if (accruedFees > 0n) {
    console.log("\nWithdrawing", ethers.formatUnits(accruedFees, 6), "USDT in fees...");
    const tx = await keno.withdrawFees(accruedFees, signer.address);
    await tx.wait();
    console.log("✅ Fees withdrawn to:", signer.address);
  } else {
    console.log("\nNo accrued fees to withdraw");
  }

  // ── 4. Report pool status ──────────────────────────────────────────────
  const poolFinal = await keno.availablePool();
  console.log("\n── Final Pool Status ───────────────────────────────────");
  console.log("Pool balance:", ethers.formatUnits(poolFinal, 6), "USDT");

  if (poolFinal > 0n) {
    console.log("\n⚠️  POOL FUNDS LOCKED — This is by design.");
    console.log("   KenoGame has no withdrawPool() function to protect users.");
    console.log("   The", ethers.formatUnits(poolFinal, 6), "USDT will remain in the contract.");
    console.log("   Options:");
    console.log("   A) Leave them (contract is paused, funds are safe on-chain)");
    console.log("   B) Let any remaining UNPAID bets be retried by users (reduces pool naturally)");
  }

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("✅ Old Keno on Polygon Mainnet is RETIRED");
  console.log("   Next: Remove KENO_CONTRACT_ADDRESS from Railway (or update to Amoy)");
  console.log("═══════════════════════════════════════════════════════");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
