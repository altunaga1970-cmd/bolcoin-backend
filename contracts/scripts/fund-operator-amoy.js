/**
 * fund-operator-amoy.js
 *
 * Transfers POL from the deployer wallet to the operator wallet on Polygon Amoy.
 * The BingoOnChainScheduler needs POL in the operator wallet to sign transactions
 * (createRound, closeRound, etc).
 *
 * Usage:
 *   npx hardhat run scripts/fund-operator-amoy.js --network amoy
 *
 * Optional env override:
 *   OPERATOR=0xADDRESS AMOUNT=2 npx hardhat run scripts/fund-operator-amoy.js --network amoy
 */

const { ethers } = require("hardhat");

const OPERATOR_ADDRESS = process.env.OPERATOR || "0x1DB00BB0Ab602fD42b89e16CDaD89619a6Df1E0D";
const AMOUNT           = ethers.parseEther(process.env.AMOUNT || "2"); // 2 POL default

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerBalance = await ethers.provider.getBalance(deployer.address);

  console.log("=== Fund Operator Wallet — Polygon Amoy ===");
  console.log("From (deployer) :", deployer.address);
  console.log("To (operator)   :", OPERATOR_ADDRESS);
  console.log("Amount          :", ethers.formatEther(AMOUNT), "POL");
  console.log("Deployer balance:", ethers.formatEther(deployerBalance), "POL");

  if (deployerBalance < AMOUNT) {
    console.error("\nFAIL: deployer has insufficient POL.");
    console.error(`  Need: ${ethers.formatEther(AMOUNT)} POL`);
    console.error(`  Have: ${ethers.formatEther(deployerBalance)} POL`);
    process.exit(1);
  }

  const opBalanceBefore = await ethers.provider.getBalance(OPERATOR_ADDRESS);
  console.log("\nOperator balance before:", ethers.formatEther(opBalanceBefore), "POL");

  const tx = await deployer.sendTransaction({
    to: OPERATOR_ADDRESS,
    value: AMOUNT,
  });
  console.log("tx:", tx.hash);
  await tx.wait();

  const opBalanceAfter = await ethers.provider.getBalance(OPERATOR_ADDRESS);
  console.log("Operator balance after :", ethers.formatEther(opBalanceAfter), "POL");

  console.log("\n✓ Done. The BingoOnChainScheduler should now be able to sign transactions.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nFatal error:", err.message);
    process.exit(1);
  });
