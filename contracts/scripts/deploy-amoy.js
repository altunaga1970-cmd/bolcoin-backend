const { ethers } = require("hardhat");
const { setupPayoutTable } = require("./setup-payout-table");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying KenoGame to Amoy with account:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  // Configuration
  const paymentToken = process.env.PAYMENT_TOKEN_ADDRESS;
  const vrfCoordinator = process.env.VRF_COORDINATOR_ADDRESS || "0x343300b5d84999f5708C2095FF3e63E51b2cAdED"; // Amoy VRF V2.5
  const vrfSubId = process.env.VRF_SUBSCRIPTION_ID;
  const vrfKeyHash = process.env.VRF_KEY_HASH || "0x816bedba8a50b294e5cbd47842baf240c2385f2eaf719edbd4f250a137a8c899"; // Amoy 500 gwei
  const operatorAddress = process.env.OPERATOR_ADDRESS || deployer.address;

  if (!paymentToken) throw new Error("PAYMENT_TOKEN_ADDRESS required");
  if (!vrfSubId) throw new Error("VRF_SUBSCRIPTION_ID required");

  console.log("\nConfig:");
  console.log("  Payment Token:", paymentToken);
  console.log("  VRF Coordinator:", vrfCoordinator);
  console.log("  VRF Sub ID:", vrfSubId);
  console.log("  VRF Key Hash:", vrfKeyHash);
  console.log("  Operator:", operatorAddress);

  // Deploy KenoGame (settlementEnabled = false by default)
  const KenoGame = await ethers.getContractFactory("KenoGame");
  const keno = await KenoGame.deploy(
    paymentToken,
    vrfCoordinator,
    vrfSubId,
    vrfKeyHash,
    operatorAddress
  );
  await keno.waitForDeployment();

  const address = await keno.getAddress();
  console.log("\nKenoGame deployed to:", address);

  // Setup payout table
  await setupPayoutTable(keno);

  // Verify settlement is disabled
  console.log("\nSettlement enabled:", await keno.settlementEnabled());
  console.log("Payout table version:", await keno.payoutTableVersion());
  console.log("Available pool:", ethers.formatUnits(await keno.availablePool(), 6), "USDT");

  console.log("\n--- NEXT STEPS ---");
  console.log("1. Add KenoGame as VRF consumer: vrfCoordinator.addConsumer(subId, kenoAddress)");
  console.log("2. Fund pool: keno.fundPool(amount)");
  console.log("3. Verify on Polygonscan:");
  console.log(`   npx hardhat verify --network amoy ${address} ${paymentToken} ${vrfCoordinator} ${vrfSubId} ${vrfKeyHash} ${operatorAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
