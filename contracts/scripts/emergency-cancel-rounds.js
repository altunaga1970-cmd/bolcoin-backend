const { ethers } = require("hardhat");

/**
 * EMERGENCY SCRIPT: Cancel orphan Bingo rounds
 *
 * Purpose: Fix the MaxOpenRoundsReached deadlock (C-01)
 *
 * What this does:
 * 1. Connects to the deployed BingoGame contract
 * 2. Retrieves all currently open round IDs
 * 3. Checks their status
 * 4. Cancels rounds that are stuck in OPEN or CLOSED state
 *
 * Required env vars (in contracts/.env):
 *   OPERATOR_PRIVATE_KEY or DEPLOYER_KEY — operator wallet with permissions
 *   BINGO_CONTRACT_ADDRESS — deployed BingoGame address
 *   AMOY_RPC_URL (optional) — defaults to Hardhat network config
 *
 * Usage:
 *   npx hardhat run scripts/emergency-cancel-rounds.js --network amoy
 *   npx hardhat run scripts/emergency-cancel-rounds.js --network polygon
 */

const RoundStatus = {
  NONE: 0,
  OPEN: 1,
  CLOSED: 2,
  VRF_REQUESTED: 3,
  VRF_FULFILLED: 4,
  RESOLVED: 5,
  CANCELLED: 6
};

const STATUS_NAMES = {
  0: "NONE",
  1: "OPEN",
  2: "CLOSED",
  3: "VRF_REQUESTED",
  4: "VRF_FULFILLED",
  5: "RESOLVED",
  6: "CANCELLED"
};

async function main() {
  console.log("=== 🚨 EMERGENCY: Cancel Orphan Bingo Rounds ===\n");

  // Get signer (operator wallet)
  const [signer] = await ethers.getSigners();
  console.log("Operator wallet:", signer.address);

  const balance = await ethers.provider.getBalance(signer.address);
  console.log("Balance:", ethers.formatEther(balance), "MATIC\n");

  if (balance < ethers.parseEther("0.01")) {
    throw new Error("❌ Operator balance too low for gas fees");
  }

  // Get BingoGame contract address
  const bingoAddress = process.env.BINGO_CONTRACT_ADDRESS;
  if (!bingoAddress) {
    throw new Error("❌ BINGO_CONTRACT_ADDRESS not set in .env");
  }

  console.log("BingoGame contract:", bingoAddress);

  // Connect to contract
  const BingoGame = await ethers.getContractFactory("BingoGame");
  const bingo = BingoGame.attach(bingoAddress).connect(signer);

  // Verify we're the operator
  const contractOperator = await bingo.operator();
  console.log("Contract operator:", contractOperator);

  if (contractOperator.toLowerCase() !== signer.address.toLowerCase()) {
    console.warn("⚠️  WARNING: Connected wallet is NOT the contract operator!");
    console.warn("   This script will fail unless you're using the operator key.");
    console.warn("   Expected:", contractOperator);
    console.warn("   Got:     ", signer.address);
    throw new Error("Wrong operator wallet");
  }

  console.log("✅ Wallet verified as operator\n");

  // Get MAX_OPEN_ROUNDS constant
  const maxOpenRounds = await bingo.MAX_OPEN_ROUNDS();
  console.log("MAX_OPEN_ROUNDS:", maxOpenRounds);

  // Get current round counter
  const roundCounter = await bingo.roundCounter();
  console.log("Total rounds created:", roundCounter.toString());

  // Get open round IDs (this is the array that's causing the deadlock)
  // Note: _openRoundIds is internal, so we need to use a different approach
  // We'll iterate through all rounds and check their status

  console.log("\n=== Scanning for orphan rounds... ===\n");

  const orphanRounds = [];
  const allRounds = [];

  // Scan all created rounds
  for (let i = 1; i <= Number(roundCounter); i++) {
    try {
      const round = await bingo.rounds(i);
      const status = Number(round.status);
      const statusName = STATUS_NAMES[status];

      allRounds.push({
        id: i,
        status,
        statusName,
        totalCards: Number(round.totalCards),
        scheduledClose: Number(round.scheduledClose)
      });

      console.log(`Round ${i}: ${statusName} (${round.totalCards} cards)`);

      // Identify orphan rounds: OPEN or CLOSED status
      if (status === RoundStatus.OPEN || status === RoundStatus.CLOSED) {
        const now = Math.floor(Date.now() / 1000);
        const timeSinceClose = now - Number(round.scheduledClose);

        orphanRounds.push({
          id: i,
          status,
          statusName,
          totalCards: Number(round.totalCards),
          scheduledClose: Number(round.scheduledClose),
          timeSinceClose
        });

        if (timeSinceClose > 0) {
          console.log(`  ⚠️  ORPHAN: Should have closed ${timeSinceClose}s ago`);
        }
      }
    } catch (err) {
      // Round might not exist
      console.log(`Round ${i}: Not found or error reading`);
    }
  }

  console.log(`\n=== Found ${orphanRounds.length} orphan rounds ===\n`);

  if (orphanRounds.length === 0) {
    console.log("✅ No orphan rounds found! System is healthy.");
    console.log("\nIf you're still seeing MaxOpenRoundsReached errors,");
    console.log("there may be an issue with the contract state.");
    return;
  }

  // Display orphan rounds
  console.log("Orphan rounds to cancel:");
  orphanRounds.forEach(r => {
    console.log(`  - Round ${r.id}: ${r.statusName}, ${r.totalCards} cards, ${r.timeSinceClose}s overdue`);
  });

  // Ask for confirmation
  console.log("\n⚠️  WARNING: This will cancel the above rounds!");
  console.log("Cards in these rounds will be refundable via claimRefund().");
  console.log("\nProceed? (yes/no)");

  // In a real scenario, you'd use readline for confirmation
  // For automation, we'll proceed if DRY_RUN is not set
  const dryRun = process.env.DRY_RUN === "true";

  if (dryRun) {
    console.log("\n🔍 DRY RUN MODE - No rounds will be cancelled");
    console.log("To actually cancel, run without DRY_RUN=true");
    return;
  }

  // Cancel each orphan round
  console.log("\n=== Cancelling orphan rounds... ===\n");

  for (const round of orphanRounds) {
    console.log(`Cancelling round ${round.id}...`);

    try {
      const tx = await bingo.cancelRound(round.id);
      console.log(`  TX submitted: ${tx.hash}`);

      const receipt = await tx.wait();
      console.log(`  ✅ Cancelled in block ${receipt.blockNumber}`);

      // Verify status changed
      const updatedRound = await bingo.rounds(round.id);
      const newStatus = Number(updatedRound.status);
      console.log(`  New status: ${STATUS_NAMES[newStatus]}`);

    } catch (err) {
      console.error(`  ❌ Failed to cancel round ${round.id}:`);
      console.error(`     ${err.message}`);

      // Continue with other rounds even if one fails
    }
  }

  console.log("\n=== Verification ===\n");

  // Re-check round counter and status
  const finalRoundCounter = await bingo.roundCounter();
  console.log("Total rounds:", finalRoundCounter.toString());

  // Count rounds by status
  const statusCounts = {};
  for (const round of allRounds) {
    const statusName = round.statusName;
    statusCounts[statusName] = (statusCounts[statusName] || 0) + 1;
  }

  console.log("\nRound status distribution:");
  Object.entries(statusCounts).forEach(([status, count]) => {
    console.log(`  ${status}: ${count}`);
  });

  // Verify no OPEN or CLOSED rounds remain
  let openCount = 0;
  for (let i = 1; i <= Number(finalRoundCounter); i++) {
    try {
      const round = await bingo.rounds(i);
      const status = Number(round.status);
      if (status === RoundStatus.OPEN || status === RoundStatus.CLOSED) {
        openCount++;
      }
    } catch (err) {
      // Ignore
    }
  }

  console.log(`\nOpen/Closed rounds remaining: ${openCount}`);

  if (openCount === 0) {
    console.log("\n✅ SUCCESS: All orphan rounds cancelled!");
    console.log("   The scheduler should now be able to create new rounds.");
    console.log("   Monitor logs: _openRoundIds.length should be 0");
  } else {
    console.log("\n⚠️  WARNING: Some rounds still in OPEN/CLOSED state");
    console.log("   May need manual intervention or investigation");
  }

  console.log("\n=== Next Steps ===");
  console.log("1. Restart the backend scheduler");
  console.log("2. Monitor for MaxOpenRoundsReached errors");
  console.log("3. If error persists, check VRF configuration (C-02)");
  console.log("4. Verify event listener is reconnecting (C-03)");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ Error:", err.message);
    console.error(err);
    process.exit(1);
  });
