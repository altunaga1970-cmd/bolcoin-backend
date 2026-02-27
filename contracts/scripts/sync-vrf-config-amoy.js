/**
 * sync-vrf-config-amoy.js
 *
 * Syncs the VRF subscription ID stored inside BingoGame and LaBolitaGame
 * to match the active VRF subscription (VRF_SUBSCRIPTION_ID in contracts/.env).
 *
 * Background:
 *   Bingo and Bolita were deployed with a different sub ID than the current
 *   active subscription. This script calls setVrfConfig() on each contract
 *   to update the stored sub ID while keeping all other VRF params intact.
 *
 * Usage:
 *   npx hardhat run scripts/sync-vrf-config-amoy.js --network amoy
 *
 * Requirements:
 *   - VRF_SUBSCRIPTION_ID set in contracts/.env
 *   - DEPLOYER_KEY must be the owner of both contracts
 */

const { ethers } = require("hardhat");

const NEW_SUB_ID = process.env.VRF_SUBSCRIPTION_ID;

if (!NEW_SUB_ID) {
  console.error("ERROR: VRF_SUBSCRIPTION_ID not set in contracts/.env");
  process.exit(1);
}

const CONTRACTS = [
  { name: "BingoGame",    address: "0x4B1f1e94a9651E84D8584760980f74C56Ee61652" },
  { name: "LaBolitaGame", address: "0x6B07df51947f3e476B7574C14fF3293a8a4c846A" },
];

const GAME_ABI = [
  "function owner() view returns (address)",
  "function vrfSubscriptionId() view returns (uint256)",
  "function vrfKeyHash() view returns (bytes32)",
  "function vrfCallbackGasLimit() view returns (uint32)",
  "function vrfRequestConfirmations() view returns (uint16)",
  "function setVrfConfig(uint256 subId, bytes32 keyHash, uint32 gasLimit, uint16 confirmations) external",
];

async function syncContract(signer, name, address) {
  console.log(`\n--- ${name} (${address}) ---`);

  const contract = new ethers.Contract(address, GAME_ABI, signer);

  // Verify ownership
  const owner = await contract.owner();
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    console.error(`  FAIL: signer is not ${name} owner.`);
    console.error(`  Owner : ${owner}`);
    console.error(`  Signer: ${signer.address}`);
    return false;
  }

  const currentSubId = await contract.vrfSubscriptionId();
  console.log("  Current sub ID :", currentSubId.toString());
  console.log("  Target sub ID  :", BigInt(NEW_SUB_ID).toString());

  if (currentSubId.toString() === BigInt(NEW_SUB_ID).toString()) {
    console.log("  Already up to date — no action needed.");
    return true;
  }

  // Read existing config to preserve other params
  const keyHash       = await contract.vrfKeyHash();
  const gasLimit      = await contract.vrfCallbackGasLimit();
  const confirmations = await contract.vrfRequestConfirmations();

  console.log("  Calling setVrfConfig()...");
  const tx = await contract.setVrfConfig(
    BigInt(NEW_SUB_ID),
    keyHash,
    gasLimit,
    confirmations
  );
  console.log("  tx:", tx.hash);
  await tx.wait();

  // Verify
  const updated = await contract.vrfSubscriptionId();
  if (updated.toString() !== BigInt(NEW_SUB_ID).toString()) {
    console.error(`  FAIL: sub ID after update is ${updated} — expected ${NEW_SUB_ID}`);
    return false;
  }

  console.log("  Updated sub ID :", updated.toString(), "(CONFIRMED)");
  return true;
}

async function main() {
  const [signer] = await ethers.getSigners();
  const polBalance = await ethers.provider.getBalance(signer.address);

  console.log("=== Sync VRF Config — Bingo + LaBolita — Polygon Amoy ===");
  console.log("Signer      :", signer.address);
  console.log("POL balance :", ethers.formatEther(polBalance), "POL");
  console.log("New sub ID  :", NEW_SUB_ID);

  const results = [];
  for (const c of CONTRACTS) {
    const ok = await syncContract(signer, c.name, c.address);
    results.push({ name: c.name, ok });
  }

  console.log("\n=== RESULT ===");
  for (const r of results) {
    console.log(`  ${r.name.padEnd(14)}: ${r.ok ? "OK" : "FAILED"}`);
  }

  const allOk = results.every(r => r.ok);
  if (!allOk) {
    console.error("\nOne or more contracts failed to sync. Check errors above.");
    process.exit(1);
  }

  console.log("\nAll contracts synced to sub ID:", NEW_SUB_ID);
  console.log("Bingo and LaBolita VRF callbacks will now use the correct subscription.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nFatal error:", err.message);
    if (err.data) console.error("Revert data:", err.data);
    process.exit(1);
  });
