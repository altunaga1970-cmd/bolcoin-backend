const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const operatorAddress = "0x5fa4fF772dA22293dd9fa4CEA13caB6b9d3360ff";

  console.log("=== MATIC Balances on Amoy ===\n");

  // Check deployer balance
  const deployerBalance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer:", deployer.address);
  console.log("  MATIC:", ethers.formatEther(deployerBalance));

  // Check operator balance
  const operatorBalance = await ethers.provider.getBalance(operatorAddress);
  console.log("\nOperator:", operatorAddress);
  console.log("  MATIC:", ethers.formatEther(operatorBalance));

  // Check if deployer has enough to transfer
  if (deployerBalance > ethers.parseEther("0.15")) {
    console.log("\n✓ Deployer has enough MATIC to transfer 0.1 to operator");
    console.log("\nTo transfer, run:");
    console.log("  npx hardhat run scripts/transfer-matic.js --network amoy");
  } else if (deployerBalance > 0n) {
    console.log("\n⚠ Deployer has some MATIC but not enough for safe transfer");
  } else {
    console.log("\n✗ Deployer has no MATIC - need to use faucet");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
