const { ethers } = require("hardhat");

/**
 * Deploy BingoGame to Polygon Amoy testnet.
 *
 * Required env vars (in contracts/.env):
 *   DEPLOYER_KEY           — private key of the deployer wallet
 *   PAYMENT_TOKEN_ADDRESS  — testnet USDT address (deploy-mock-token-amoy.js first)
 *   VRF_SUBSCRIPTION_ID    — Chainlink VRF subscription ID
 *   OPERATOR_ADDRESS       — address of the backend operator wallet
 *
 * Optional (defaults to Amoy values):
 *   AMOY_RPC_URL
 *   VRF_COORDINATOR_ADDRESS
 *   VRF_KEY_HASH
 *   CARD_PRICE_USDT        — price per card in USDT (default: 1.00)
 */
async function main() {
  const [deployer] = await ethers.getSigners();

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("=== DEPLOY BingoGame — Polygon Amoy ===");
  console.log("Deployer:", deployer.address);
  console.log("Balance: ", ethers.formatEther(balance), "MATIC");

  if (balance < ethers.parseEther("0.1")) {
    throw new Error("Deployer balance too low — get MATIC from faucet.polygon.technology");
  }

  // ── Config ───────────────────────────────────────────────────────────────
  const paymentToken   = process.env.PAYMENT_TOKEN_ADDRESS;
  // Chainlink VRF V2 Coordinator on Polygon Amoy (verified address)
  const vrfCoordinator = process.env.VRF_COORDINATOR_ADDRESS
    || "0x343300b5d84D444B2ADc9116FEF1bED02BE49Cf2"; // Chainlink VRF V2 — Amoy
  const vrfSubId       = process.env.VRF_SUBSCRIPTION_ID || "58032062494901163687852959523457794649881373296701930891445142826548498716201";
  const vrfKeyHash     = process.env.VRF_KEY_HASH
    || "0x816bedba8a50b294e5cbd47842baf240c2385f2eaf719edbd4f250a137a8c899"; // 500 gwei — Amoy
  const operatorAddress = process.env.OPERATOR_ADDRESS || deployer.address;
  const cardPriceUsdt  = process.env.CARD_PRICE_USDT || "1.00";

  if (!paymentToken)    throw new Error("PAYMENT_TOKEN_ADDRESS required in contracts/.env");
  if (!vrfSubId)        throw new Error("VRF_SUBSCRIPTION_ID required in contracts/.env");
  if (!operatorAddress) throw new Error("OPERATOR_ADDRESS required in contracts/.env");

  console.log("\nConfig:");
  console.log("  Payment Token:  ", paymentToken);
  console.log("  VRF Coordinator:", vrfCoordinator);
  console.log("  VRF Sub ID:     ", vrfSubId);
  console.log("  VRF Key Hash:   ", vrfKeyHash);
  console.log("  Operator:       ", operatorAddress);
  console.log("  Card Price:     ", cardPriceUsdt, "USDT");

  // ── Deploy ───────────────────────────────────────────────────────────────
  const BingoGame = await ethers.getContractFactory("BingoGame");
  console.log("\nDeploying BingoGame...");

  const bingo = await BingoGame.deploy(
    paymentToken,
    vrfCoordinator,
    vrfSubId,
    vrfKeyHash,
    operatorAddress
  );
  await bingo.waitForDeployment();

  const bingoAddress = await bingo.getAddress();
  console.log("BingoGame deployed to:", bingoAddress);

  // ── Set card price (optional override) ──────────────────────────────────
  if (cardPriceUsdt !== "1.00") {
    const priceTx = await bingo.setCardPrice(ethers.parseUnits(cardPriceUsdt, 6));
    await priceTx.wait();
    console.log("Card price set to:", cardPriceUsdt, "USDT");
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("\n=== DEPLOYED ===");
  console.log("BingoGame:", bingoAddress);
  console.log("Card price:", ethers.formatUnits(await bingo.cardPrice(), 6), "USDT");
  console.log("Operator:  ", await bingo.operator());

  console.log("\n=== NEXT STEPS ===");
  console.log("1. Add BingoGame as VRF consumer at:");
  console.log("   https://vrf.chain.link → Amoy → your subscription → Add Consumer");
  console.log("   Consumer address:", bingoAddress);
  console.log("");
  console.log("2. Fund the prize pool (from deployer wallet):");
  console.log(`   npx hardhat run scripts/fund-bingo-amoy.js --network amoy`);
  console.log("");
  console.log("3. Add these to Railway environment variables:");
  console.log(`   BINGO_CONTRACT_ADDRESS=${bingoAddress}`);
  console.log(`   VITE_BINGO_CONTRACT_ADDRESS=${bingoAddress}`);
  console.log(`   VITE_TOKEN_ADDRESS=${paymentToken}`);
  console.log("");
  console.log("4. Verify contract on Polygonscan (optional):");
  console.log(`   npx hardhat verify --network amoy ${bingoAddress} ${paymentToken} ${vrfCoordinator} ${vrfSubId} ${vrfKeyHash} ${operatorAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
