const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying LaBolitaGame to Amoy with account:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  // Configuration
  const paymentToken = process.env.PAYMENT_TOKEN_ADDRESS;
  const vrfCoordinator = process.env.VRF_COORDINATOR_ADDRESS || "0x343300b5d84999f5708C2095FF3e63E51b2cAdED"; // Amoy VRF V2.5
  const vrfSubId = process.env.VRF_SUBSCRIPTION_ID;
  const vrfKeyHash = process.env.VRF_KEY_HASH || "0x816bedba8a50b294e5cbd47842baf240c2385f2eaf719edbd4f250a137a8c899"; // Amoy 500 gwei

  if (!paymentToken) throw new Error("PAYMENT_TOKEN_ADDRESS required");
  if (!vrfSubId) throw new Error("VRF_SUBSCRIPTION_ID required");

  console.log("\nConfig:");
  console.log("  Payment Token:", paymentToken);
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
  console.log("  Max exposure per number:", ethers.formatUnits(await bolita.maxExposurePerNumber(), 6), "USDT");
  console.log("  Available pool:", ethers.formatUnits(await bolita.availablePool(), 6), "USDT");

  console.log("\n--- NEXT STEPS ---");
  console.log("1. Add LaBolitaGame as VRF consumer on vrf.chain.link");
  console.log("2. Fund VRF subscription with LINK");
  console.log("3. Fund pool: bolita.fundPool(amount)");
  console.log("4. Create first draw: bolita.createDraw('DRAW-001', scheduledTime)");
  console.log("5. Verify on Polygonscan:");
  console.log(`   npx hardhat verify --network amoy ${address} ${paymentToken} ${vrfCoordinator} ${vrfSubId} ${vrfKeyHash}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
