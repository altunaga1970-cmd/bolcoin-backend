const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying MockERC20 (Test USDT) to Amoy with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "MATIC");

  // Deploy MockERC20 with 6 decimals (like real USDT)
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const token = await MockERC20.deploy("Test USDT", "tUSDT", 6);
  await token.waitForDeployment();

  const tokenAddress = await token.getAddress();
  console.log("\nMockERC20 (tUSDT) deployed to:", tokenAddress);

  // Mint 100,000 tUSDT to deployer
  const mintAmount = ethers.parseUnits("100000", 6);
  const mintTx = await token.mint(deployer.address, mintAmount);
  await mintTx.wait();
  console.log("Minted 100,000 tUSDT to", deployer.address);

  const balance = await token.balanceOf(deployer.address);
  console.log("Deployer tUSDT balance:", ethers.formatUnits(balance, 6));

  console.log("\n=== COPY THIS TO contracts/.env ===");
  console.log(`PAYMENT_TOKEN_ADDRESS=${tokenAddress}`);
  console.log("===================================");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
