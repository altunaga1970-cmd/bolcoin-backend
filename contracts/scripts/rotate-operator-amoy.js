/**
 * rotate-operator-amoy.js
 *
 * Updates the operator address on KenoGame, BingoGame, and LaBolitaGame
 * on Polygon Amoy. Run this AFTER creating the new operator wallet and
 * BEFORE updating OPERATOR_PRIVATE_KEY in Railway.
 *
 * Usage:
 *   NEW_OPERATOR_ADDRESS=0xNEW_WALLET npx hardhat run scripts/rotate-operator-amoy.js --network amoy
 *
 * Requirements:
 *   - DEPLOYER_KEY must be the owner of all 3 contracts (set in contracts/.env)
 *   - NEW_OPERATOR_ADDRESS must be a funded wallet (needs POL for gas)
 */

const { ethers } = require("hardhat");

const NEW_OPERATOR = process.env.NEW_OPERATOR_ADDRESS;

if (!NEW_OPERATOR || !ethers.isAddress(NEW_OPERATOR)) {
  console.error("ERROR: NEW_OPERATOR_ADDRESS not set or invalid.");
  console.error("Usage: NEW_OPERATOR_ADDRESS=0x... npx hardhat run scripts/rotate-operator-amoy.js --network amoy");
  process.exit(1);
}

const CONTRACTS = [
  { name: "KenoGame",    address: "0xAa1d6945e691807CBCC239F6C89C6469E0eD4998" },
  { name: "BingoGame",   address: "0x4B1f1e94a9651E84D8584760980f74C56Ee61652" },
  { name: "LaBolitaGame",address: "0x1F4c288f6e5dE5731783bBaF83555CC926dDB383" }, // v2 (double-pay fix)
];

const OPERATOR_ABI = [
  "function owner() view returns (address)",
  "function operator() view returns (address)",
  "function setOperator(address _operator) external",
];

async function rotateOne(signer, name, address) {
  console.log(`\n--- ${name} (${address}) ---`);
  const contract = new ethers.Contract(address, OPERATOR_ABI, signer);

  const owner = await contract.owner();
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    console.error(`  FAIL: signer is not ${name} owner.`);
    console.error(`  Owner : ${owner}`);
    console.error(`  Signer: ${signer.address}`);
    return false;
  }

  const current = await contract.operator();
  console.log(`  Current operator: ${current}`);
  console.log(`  New operator    : ${NEW_OPERATOR}`);

  if (current.toLowerCase() === NEW_OPERATOR.toLowerCase()) {
    console.log("  Already set — no action needed.");
    return true;
  }

  const tx = await contract.setOperator(NEW_OPERATOR);
  console.log(`  tx: ${tx.hash}`);
  await tx.wait();

  const updated = await contract.operator();
  if (updated.toLowerCase() !== NEW_OPERATOR.toLowerCase()) {
    console.error(`  FAIL: operator after update is ${updated}`);
    return false;
  }

  console.log(`  Updated: ${updated}  ✓`);
  return true;
}

async function main() {
  const [signer] = await ethers.getSigners();
  const polBalance = await ethers.provider.getBalance(signer.address);

  console.log("=== Rotate Operator — Keno + Bingo + LaBolita — Polygon Amoy ===");
  console.log("Owner signer  :", signer.address);
  console.log("POL balance   :", ethers.formatEther(polBalance), "POL");
  console.log("New operator  :", NEW_OPERATOR);

  const results = [];
  for (const c of CONTRACTS) {
    const ok = await rotateOne(signer, c.name, c.address);
    results.push({ name: c.name, ok });
  }

  console.log("\n=== RESULT ===");
  for (const r of results) {
    console.log(`  ${r.name.padEnd(14)}: ${r.ok ? "OK" : "FAILED"}`);
  }

  const allOk = results.every(r => r.ok);
  if (!allOk) {
    console.error("\nOne or more contracts failed. Check errors above.");
    process.exit(1);
  }

  console.log(`\nAll contracts now point to operator: ${NEW_OPERATOR}`);
  console.log("\nNext step:");
  console.log("  Update OPERATOR_PRIVATE_KEY in Railway with the private key of", NEW_OPERATOR);
  console.log("  Then redeploy (Railway auto-restarts on env var change).");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nFatal error:", err.message);
    if (err.data) console.error("Revert data:", err.data);
    process.exit(1);
  });
