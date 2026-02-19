const { ethers } = require("hardhat");
const { setupPayoutTable } = require("./setup-payout-table");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying KenoGame to Polygon MAINNET with account:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  // Configuration — Polygon Mainnet
  const paymentToken = process.env.PAYMENT_TOKEN_ADDRESS || "0xc2132D05D31c914a87C6611C10748AEb04B58e8F"; // USDT on Polygon
  const vrfCoordinator = process.env.VRF_COORDINATOR_ADDRESS || "0xec0Ed46f36576541C75739E915ADbCb3DE24bD77"; // Polygon VRF V2.5
  const vrfSubId = process.env.VRF_SUBSCRIPTION_ID;
  const vrfKeyHash = process.env.VRF_KEY_HASH || "0x719ed7d7664abc3001c18aac8130a2265e1e70b7e036ae20f3ca8b92b3154d86"; // Polygon 200 gwei
  const operatorAddress = process.env.OPERATOR_ADDRESS;

  if (!vrfSubId) throw new Error("VRF_SUBSCRIPTION_ID required");
  if (!operatorAddress) throw new Error("OPERATOR_ADDRESS required for mainnet");

  console.log("\n=== MAINNET DEPLOYMENT ===");
  console.log("  Payment Token (USDT):", paymentToken);
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

  // Final state
  console.log("\n=== DEPLOYMENT COMPLETE ===");
  console.log("Settlement enabled:", await keno.settlementEnabled(), "(Phase 2 disabled)");
  console.log("Payout table version:", await keno.payoutTableVersion());
  console.log("Fee BPS:", await keno.feeBps(), "(12%)");
  console.log("Bet amount:", ethers.formatUnits(await keno.betAmount(), 6), "USDT");

  console.log("\n--- REQUIRED NEXT STEPS ---");
  console.log("1. Add as VRF consumer: vrfCoordinator.addConsumer(subId, kenoAddress)");
  console.log("2. Fund pool: approve USDT, then keno.fundPool(amount)");
  console.log("3. Verify on Polygonscan:");
  console.log(`   npx hardhat verify --network polygon ${address} ${paymentToken} ${vrfCoordinator} ${vrfSubId} ${vrfKeyHash} ${operatorAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
