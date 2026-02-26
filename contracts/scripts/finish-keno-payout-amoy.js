/**
 * Finish Keno payout table setup (spots 9, 10 + commit)
 *
 * Run this if deploy-amoy.js ran out of gas during payout table setup.
 * Spots 1-8 are already written. This script writes 9-10 and commits.
 *
 * Usage:
 *   KENO_ADDRESS=0xAa1d6945e691807CBCC239F6C89C6469E0eD4998 \
 *   npx hardhat run scripts/finish-keno-payout-amoy.js --network amoy
 */
const { ethers } = require("hardhat");
const { PAYOUT_TABLE } = require("./setup-payout-table");

async function main() {
  const kenoAddress = process.env.KENO_ADDRESS
    || "0xAa1d6945e691807CBCC239F6C89C6469E0eD4998"; // Amoy testnet

  if (!kenoAddress) throw new Error("KENO_ADDRESS required");

  const [signer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(signer.address);
  console.log("=== Finish Keno Payout Table — Amoy ===");
  console.log("Signer :", signer.address);
  console.log("Balance:", ethers.formatEther(balance), "POL");
  console.log("Keno   :", kenoAddress);

  const KenoGame = await ethers.getContractFactory("KenoGame");
  const keno = KenoGame.attach(kenoAddress);

  // Write spots 9 and 10 (1-8 already done)
  for (let spots = 9; spots <= 10; spots++) {
    const mults = PAYOUT_TABLE[spots];
    console.log(`Writing spots ${spots} (${mults.length} entries)...`);
    const tx = await keno.updatePayoutRow(spots, mults);
    await tx.wait();
    console.log(`  Spots ${spots}: done`);
  }

  // Commit the payout table
  console.log("Committing payout table...");
  const commitTx = await keno.commitPayoutUpdate();
  await commitTx.wait();

  const version = await keno.payoutTableVersion();
  console.log(`\n✅ Payout table committed (version ${version})`);
  console.log("Keno is ready on Amoy testnet.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
