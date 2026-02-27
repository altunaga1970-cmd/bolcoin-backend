/**
 * Recovery script — Keno Payout Table (Amoy)
 *
 * Diagnoses the current payout table state and fixes it if needed.
 *
 * Possible outcomes:
 *   A) payoutTableVersion >= 1 → Table already committed. Keno is ready. Nothing to do.
 *   B) payoutTableVersion == 0 → Table not committed. Writes ALL 10 spots + commits.
 *
 * Usage:
 *   npx hardhat run scripts/recover-keno-payout-amoy.js --network amoy
 */
const { ethers } = require("hardhat");
const { PAYOUT_TABLE } = require("./setup-payout-table");

const KENO_ADDRESS = "0xAa1d6945e691807CBCC239F6C89C6469E0eD4998";

async function main() {
  const [signer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(signer.address);
  console.log("=== Keno Payout Table Recovery ===");
  console.log("Signer :", signer.address);
  console.log("Balance:", ethers.formatEther(balance), "POL");
  console.log("Keno   :", KENO_ADDRESS);

  const keno = await ethers.getContractAt("KenoGame", KENO_ADDRESS);

  // ── 1. Read current state ────────────────────────────────────────────────
  const currentVersion = await keno.payoutTableVersion();
  const pendingBets    = await keno.pendingBetCount();
  const lastUpdate     = await keno.lastPayoutUpdateTimestamp();

  console.log("\n── Contract State ──────────────────────────────────────");
  console.log("payoutTableVersion       :", currentVersion.toString());
  console.log("pendingBetCount          :", pendingBets.toString());
  console.log("lastPayoutUpdateTimestamp:", lastUpdate.toString());

  // ── 2. Show active payout table (if any) ────────────────────────────────
  if (currentVersion > 0n) {
    console.log("\n── Active Payout Table (version", currentVersion.toString(), ") ──");
    for (let spots = 1; spots <= 10; spots++) {
      const row = [];
      for (let hits = 0; hits <= spots; hits++) {
        const m = await keno.getPayoutMultiplier(spots, hits);
        row.push(m.toString());
      }
      console.log(`  Spots ${spots.toString().padStart(2)}: [${row.join(", ")}]`);
    }

    console.log("\n✅ SCENARIO A — Payout table is already committed at version", currentVersion.toString());
    console.log("   Keno is READY. No fix needed.");
    console.log("\n   The 'execution reverted' from finish-keno-payout-amoy.js happened because");
    console.log("   that script wrote spots 9-10 to version", (currentVersion + 1n).toString());
    console.log("   without spots 1-8, so commitPayoutUpdate() reverted with NotAllSpotsPopulated.");
    console.log("   The active table (version", currentVersion.toString(), ") is intact and correct.");
    return;
  }

  // ── 3. Version == 0 — write all 10 spots + commit ───────────────────────
  console.log("\n⚠️  SCENARIO B — payoutTableVersion is 0. Writing full payout table...");

  for (let spots = 1; spots <= 10; spots++) {
    const mults = PAYOUT_TABLE[spots];
    console.log(`  Writing spots ${spots} (${mults.length} entries)...`);
    const tx = await keno.updatePayoutRow(spots, mults);
    await tx.wait();
    console.log(`    done`);
  }

  console.log("\nCommitting payout table...");
  const commitTx = await keno.commitPayoutUpdate();
  await commitTx.wait();

  const newVersion = await keno.payoutTableVersion();
  console.log(`\n✅ Payout table committed — version ${newVersion}`);
  console.log("Keno is READY on Amoy testnet.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
