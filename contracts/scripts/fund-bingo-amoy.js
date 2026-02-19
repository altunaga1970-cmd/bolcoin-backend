const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();

  const BINGO_ADDRESS = "0x4Aa6f249020e90c09B5A115b6a65FE84F01f014D";
  const TOKEN_ADDRESS = "0xdD66517400C95F0580b6F16579AEF42D8851FEfd";

  console.log("Funding BingoGame pool from:", deployer.address);

  const token = await ethers.getContractAt("MockERC20", TOKEN_ADDRESS);
  const bingo = await ethers.getContractAt("BingoGame", BINGO_ADDRESS);

  const balance = await token.balanceOf(deployer.address);
  console.log("Deployer tUSDT balance:", ethers.formatUnits(balance, 6));

  // Fund with 50,000 tUSDT
  const amount = ethers.parseUnits("50000", 6);

  console.log("\nApproving...");
  const approveTx = await token.approve(BINGO_ADDRESS, amount);
  await approveTx.wait();

  console.log("Funding pool with 50,000 tUSDT...");
  const fundTx = await bingo.fundPool(amount);
  await fundTx.wait();

  const poolBalance = await bingo.availablePool();
  console.log("✓ Pool funded!");
  console.log("Available pool:", ethers.formatUnits(poolBalance, 6), "tUSDT");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
