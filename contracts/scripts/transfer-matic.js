const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const operatorAddress = "0x5fa4fF772dA22293dd9fa4CEA13caB6b9d3360ff";
  const amountToSend = ethers.parseEther("0.1"); // 0.1 MATIC

  console.log("=== Transfer MATIC to Operator ===\n");
  console.log("From:", deployer.address);
  console.log("To:  ", operatorAddress);
  console.log("Amount: 0.1 MATIC\n");

  // Check deployer balance
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance:", ethers.formatEther(balance), "MATIC");

  if (balance < amountToSend) {
    console.log("✗ Insufficient balance");
    process.exit(1);
  }

  // Send transaction
  console.log("\nSending...");
  const tx = await deployer.sendTransaction({
    to: operatorAddress,
    value: amountToSend
  });

  console.log("TX hash:", tx.hash);
  console.log("Waiting for confirmation...");

  await tx.wait();

  // Check new balances
  const newDeployerBalance = await ethers.provider.getBalance(deployer.address);
  const newOperatorBalance = await ethers.provider.getBalance(operatorAddress);

  console.log("\n✓ Transfer complete!\n");
  console.log("New balances:");
  console.log("  Deployer:", ethers.formatEther(newDeployerBalance), "MATIC");
  console.log("  Operator:", ethers.formatEther(newOperatorBalance), "MATIC");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
