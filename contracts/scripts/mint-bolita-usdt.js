/**
 * Mint test USDT for LaBolitaGame on local Hardhat node
 * Also approves the bolita contract for spending.
 *
 * Usage:
 *   npx hardhat run scripts/mint-bolita-usdt.js --network localhost
 *   MINT_TO=0xYourAddress npx hardhat run scripts/mint-bolita-usdt.js --network localhost
 */
const { ethers } = require("hardhat");

const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS || "0xD84379CEae14AA33C123Af12424A37803F885889";
const BOLITA_ADDRESS = process.env.BOLITA_ADDRESS || "0xfbC22278A96299D91d41C453234d97b4F5Eb9B2d";

async function main() {
  const signers = await ethers.getSigners();
  const deployer = signers[0];

  console.log("=== MINT USDT FOR LA BOLITA ===");
  console.log("Token:", TOKEN_ADDRESS);
  console.log("Bolita:", BOLITA_ADDRESS);

  const token = await ethers.getContractAt("MockERC20", TOKEN_ADDRESS);
  const decimals = await token.decimals();
  const mintAmount = ethers.parseUnits("10000", decimals);

  // Mint to a specific address if provided
  const mintTo = process.env.MINT_TO;
  if (mintTo) {
    console.log(`\nMinting 10,000 USDT to ${mintTo}...`);
    await token.mint(mintTo, mintAmount);
    const bal = await token.balanceOf(mintTo);
    console.log(`Balance: ${ethers.formatUnits(bal, decimals)} USDT`);
    console.log("\nNote: User must approve the Bolita contract from MetaMask.");
    console.log("The hook handles this automatically on first bet.");
    return;
  }

  // Default: mint to first 3 Hardhat accounts and approve bolita
  for (let i = 0; i < Math.min(3, signers.length); i++) {
    const signer = signers[i];
    const addr = signer.address;

    await token.mint(addr, mintAmount);
    await token.connect(signer).approve(BOLITA_ADDRESS, ethers.MaxUint256);

    const bal = await token.balanceOf(addr);
    console.log(`Account #${i} (${addr}): ${ethers.formatUnits(bal, decimals)} USDT, approved`);
  }

  console.log("\nDone!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
