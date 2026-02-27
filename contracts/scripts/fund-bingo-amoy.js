/**
 * fund-bingo-amoy.js
 *
 * Funds the BingoGame USDT pool on Polygon Amoy.
 *
 * Steps:
 *   1. Check deployer's tUSDT balance — mint more if below threshold (mock token)
 *   2. Approve tUSDT to BingoGame contract
 *   3. Call bingo.fundPool(amount)
 *   4. Confirm availablePool() updated
 *
 * Usage:
 *   npx hardhat run scripts/fund-bingo-amoy.js --network amoy
 *
 * Optional env override:
 *   FUND_AMOUNT=200 npx hardhat run scripts/fund-bingo-amoy.js --network amoy
 */

const { ethers } = require("hardhat");

const BINGO_ADDRESS = "0x4B1f1e94a9651E84D8584760980f74C56Ee61652";
const USDT_ADDRESS  = "0x78B85ACB36263D7A77671941E2B20940afAef359";
const FUND_AMOUNT   = ethers.parseUnits(process.env.FUND_AMOUNT || "500", 6); // 500 tUSDT default

const BINGO_ABI = [
  "function fundPool(uint256 amount) external",
  "function availablePool() view returns (uint256)",
  "function owner() view returns (address)",
];

const TOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function mint(address to, uint256 amount) external",   // MockERC20 only
  "function decimals() view returns (uint8)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const polBalance = await ethers.provider.getBalance(signer.address);

  console.log("=== Fund BingoGame Pool — Polygon Amoy ===");
  console.log("Signer      :", signer.address);
  console.log("POL balance :", ethers.formatEther(polBalance), "POL");
  console.log("Bingo       :", BINGO_ADDRESS);
  console.log("USDT        :", USDT_ADDRESS);
  console.log("Fund amount :", ethers.formatUnits(FUND_AMOUNT, 6), "tUSDT");

  const bingo = new ethers.Contract(BINGO_ADDRESS, BINGO_ABI, signer);
  const token = new ethers.Contract(USDT_ADDRESS, TOKEN_ABI, signer);

  // ── 1. Verify signer is Bingo owner ─────────────────────────────────────────
  const owner = await bingo.owner();
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    console.error("\nFAIL: signer is not the BingoGame owner.");
    console.error("  Owner :", owner);
    console.error("  Signer:", signer.address);
    console.error("  Set DEPLOYER_KEY in contracts/.env to the owner's private key.");
    process.exit(1);
  }
  console.log("\n[1/4] Signer is BingoGame owner: OK");

  // ── 2. Check tUSDT balance — mint if needed ──────────────────────────────────
  let balance = await token.balanceOf(signer.address);
  console.log(`\n[2/4] Deployer tUSDT balance: ${ethers.formatUnits(balance, 6)}`);

  if (balance < FUND_AMOUNT) {
    const mintAmount = ethers.parseUnits("10000", 6); // mint 10,000 tUSDT
    console.log(`      Balance too low — minting 10,000 tUSDT from mock contract...`);
    try {
      const mintTx = await token.mint(signer.address, mintAmount);
      console.log("      mint tx:", mintTx.hash);
      await mintTx.wait();
      balance = await token.balanceOf(signer.address);
      console.log(`      New balance: ${ethers.formatUnits(balance, 6)} tUSDT`);
    } catch (mintErr) {
      console.error("      FAIL: mint() reverted. Signer may not own the mock token.");
      console.error("     ", mintErr.message);
      process.exit(1);
    }
  } else {
    console.log("      Balance sufficient.");
  }

  // ── 3. Approve tUSDT to Bingo ────────────────────────────────────────────────
  console.log(`\n[3/4] Approving ${ethers.formatUnits(FUND_AMOUNT, 6)} tUSDT to BingoGame...`);
  const allowance = await token.allowance(signer.address, BINGO_ADDRESS);
  if (allowance >= FUND_AMOUNT) {
    console.log("      Allowance already sufficient, skipping approve.");
  } else {
    const approveTx = await token.approve(BINGO_ADDRESS, FUND_AMOUNT);
    console.log("      approve tx:", approveTx.hash);
    await approveTx.wait();
    console.log("      Approved.");
  }

  // ── 4. Call fundPool ──────────────────────────────────────────────────────────
  console.log(`\n[4/4] Calling bingo.fundPool(${ethers.formatUnits(FUND_AMOUNT, 6)})...`);
  const poolBefore = await bingo.availablePool();
  console.log("      Pool before:", ethers.formatUnits(poolBefore, 6), "tUSDT");

  const fundTx = await bingo.fundPool(FUND_AMOUNT);
  console.log("      fundPool tx:", fundTx.hash);
  await fundTx.wait();

  const poolAfter = await bingo.availablePool();
  console.log("      Pool after :", ethers.formatUnits(poolAfter, 6), "tUSDT");

  if (poolAfter <= poolBefore) {
    console.error("FAIL: pool did not increase after fundPool().");
    process.exit(1);
  }

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log("\n=== RESULT ===");
  console.log("BingoGame pool funded:", ethers.formatUnits(poolAfter, 6), "tUSDT");
  console.log("\nNext step: fund the operator wallet with POL so the scheduler can sign txs.");
  console.log("  Operator:", "0x1DB00BB0Ab602fD42b89e16CDaD89619a6Df1E0D");
  console.log("  Run: OPERATOR=0x1DB00BB0Ab602fD42b89e16CDaD89619a6Df1E0D npx hardhat run scripts/fund-operator-amoy.js --network amoy");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nFatal error:", err.message);
    if (err.data) console.error("Revert data:", err.data);
    process.exit(1);
  });
