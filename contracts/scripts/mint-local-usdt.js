/**
 * Mint test USDT to wallets on local Hardhat node
 * Usage: npx hardhat run scripts/mint-local-usdt.js --network localhost
 */
const { ethers } = require("hardhat");

const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS || "0x5FbDB2315678afecb367f032d93F642f64180aa3";

async function main() {
  const signers = await ethers.getSigners();
  const deployer = signers[0];

  console.log("=== MINT LOCAL USDT ===");
  console.log("Token address:", TOKEN_ADDRESS);
  console.log("Deployer:", deployer.address);

  const token = await ethers.getContractAt("MockERC20", TOKEN_ADDRESS);

  // Check token info
  const symbol = await token.symbol();
  const decimals = await token.decimals();
  console.log(`Token: ${symbol}, Decimals: ${decimals}`);

  // Mint 10,000 USDT to first 3 accounts
  const mintAmount = ethers.parseUnits("10000", decimals);

  for (let i = 0; i < Math.min(3, signers.length); i++) {
    const addr = signers[i].address;
    const balBefore = await token.balanceOf(addr);

    if (balBefore > 0n) {
      console.log(`Account #${i} (${addr}): already has ${ethers.formatUnits(balBefore, decimals)} ${symbol}`);
    } else {
      await token.mint(addr, mintAmount);
      const balAfter = await token.balanceOf(addr);
      console.log(`Account #${i} (${addr}): minted ${ethers.formatUnits(balAfter, decimals)} ${symbol}`);
    }
  }

  console.log("\nDone! Refresh your browser to see the updated balance.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
