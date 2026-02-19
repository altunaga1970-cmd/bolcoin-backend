const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying LaBolitaGame to Polygon MAINNET with account:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  // Configuration — Polygon Mainnet
  const paymentToken = process.env.PAYMENT_TOKEN_ADDRESS || "0xc2132D05D31c914a87C6611C10748AEb04B58e8F"; // USDT on Polygon
  const vrfCoordinator = process.env.VRF_COORDINATOR_ADDRESS || "0xAE975071Be8F8eE67addBC1A82488F1C24858067"; // Polygon VRF V2.5
  const vrfSubId = process.env.VRF_SUBSCRIPTION_ID;
  const vrfKeyHash = process.env.VRF_KEY_HASH || "0xcc294a196eeeb44da2888d17c0625cc88d70d9760a69d58d853ba6581a9ab0cd"; // Polygon 500 gwei

  if (!vrfSubId) throw new Error("VRF_SUBSCRIPTION_ID required for mainnet deploy");

  console.log("\nConfig:");
  console.log("  Payment Token (USDT):", paymentToken);
  console.log("  VRF Coordinator:", vrfCoordinator);
  console.log("  VRF Sub ID:", vrfSubId);
  console.log("  VRF Key Hash:", vrfKeyHash);

  // Deploy LaBolitaGame
  const LaBolitaGame = await ethers.getContractFactory("LaBolitaGame");
  const bolita = await LaBolitaGame.deploy(
    paymentToken,
    vrfCoordinator,
    vrfSubId,
    vrfKeyHash
  );
  await bolita.waitForDeployment();

  const address = await bolita.getAddress();
  console.log("\nLaBolitaGame deployed to:", address);

  // Log initial state
  console.log("\nInitial state:");
  console.log("  Fee BPS:", await bolita.feeBps());
  const [f, c, p] = await bolita.getMultipliers();
  console.log("  Multipliers: Fijo", Number(f)/100, "x, Centena", Number(c)/100, "x, Parle", Number(p)/100, "x");
  console.log("  Available pool:", ethers.formatUnits(await bolita.availablePool(), 6), "USDT");

  console.log("\n--- MAINNET CHECKLIST ---");
  console.log("1. Add LaBolitaGame as VRF consumer on vrf.chain.link");
  console.log("2. Fund VRF subscription with LINK (mainnet)");
  console.log("3. Fund pool with USDT: bolita.fundPool(amount)");
  console.log("4. Set max exposure if needed: bolita.setMaxExposure(amount)");
  console.log("5. Verify on Polygonscan:");
  console.log(`   npx hardhat verify --network polygon ${address} ${paymentToken} ${vrfCoordinator} ${vrfSubId} ${vrfKeyHash}`);
  console.log("\nIMPORTANT: Update .env with VITE_BOLITA_CONTRACT_ADDRESS=" + address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
