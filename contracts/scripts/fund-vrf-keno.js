/**
 * Fund VRF subscription + register KenoGame as consumer (Polygon Amoy)
 *
 * Prerequisites:
 *   1. Get testnet LINK from: https://faucets.chain.link  (select Polygon Amoy)
 *   2. Make sure contracts/.env has DEPLOYER_KEY set
 *
 * Usage:
 *   npx hardhat run scripts/fund-vrf-keno.js --network amoy
 */
const { ethers } = require("hardhat");

// Polygon Amoy constants
const VRF_COORDINATOR = "0x343300b5d84D444B2ADc9116FEF1bED02BE49Cf2";
const LINK_TOKEN      = "0x0Fd9e8d3aF1aaee056EB9e802c3A762a667b1904";
const KENO_ADDRESS    = "0xAa1d6945e691807CBCC239F6C89C6469E0eD4998";
const SUB_ID          = "731426371446960705615864914427308857163591349971614776238316917030437647673";
const LINK_AMOUNT     = ethers.parseEther("5"); // 5 LINK

const COORDINATOR_ABI = [
  "function getSubscription(uint256 subId) view returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address owner, address[] consumers)",
  "function addConsumer(uint256 subId, address consumer) external",
];

const LINK_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transferAndCall(address to, uint256 value, bytes calldata data) returns (bool)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const polBalance = await ethers.provider.getBalance(signer.address);

  console.log("=== Fund VRF Subscription — Amoy ===");
  console.log("Wallet     :", signer.address);
  console.log("POL balance:", ethers.formatEther(polBalance));

  const link = new ethers.Contract(LINK_TOKEN, LINK_ABI, signer);
  const coordinator = new ethers.Contract(VRF_COORDINATOR, COORDINATOR_ABI, signer);

  // ── Check LINK balance ────────────────────────────────────────────────────
  const linkBalance = await link.balanceOf(signer.address);
  console.log("LINK balance:", ethers.formatEther(linkBalance), "LINK");

  if (linkBalance < LINK_AMOUNT) {
    console.error(`\n❌ Not enough LINK. Have ${ethers.formatEther(linkBalance)}, need 5.`);
    console.error("   Get testnet LINK from: https://faucets.chain.link");
    process.exit(1);
  }

  // ── Check subscription status ─────────────────────────────────────────────
  console.log("\n--- Subscription status ---");
  const sub = await coordinator.getSubscription(SUB_ID);
  console.log("LINK balance in sub :", ethers.formatEther(sub.balance), "LINK");
  console.log("Native balance      :", ethers.formatEther(sub.nativeBalance), "POL");
  console.log("Owner               :", sub.owner);
  console.log("Consumers           :", sub.consumers);

  const isConsumer = sub.consumers
    .map(a => a.toLowerCase())
    .includes(KENO_ADDRESS.toLowerCase());

  // ── Fund subscription with LINK ───────────────────────────────────────────
  if (sub.balance >= ethers.parseEther("2")) {
    console.log("\n✅ Subscription already has enough LINK, skipping fund step.");
  } else {
    console.log(`\nFunding subscription with 5 LINK...`);
    const data = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [BigInt(SUB_ID)]);
    const tx = await link.transferAndCall(VRF_COORDINATOR, LINK_AMOUNT, data);
    console.log("  tx:", tx.hash);
    await tx.wait();
    console.log("  ✅ Funded!");
  }

  // ── Register KenoGame as consumer ─────────────────────────────────────────
  if (isConsumer) {
    console.log("\n✅ KenoGame already registered as consumer.");
  } else {
    console.log("\nRegistering KenoGame as consumer...");
    const tx = await coordinator.addConsumer(BigInt(SUB_ID), KENO_ADDRESS);
    console.log("  tx:", tx.hash);
    await tx.wait();
    console.log("  ✅ KenoGame registered!");
  }

  // ── Sync subscription ID inside the Keno contract ────────────────────────
  const KENO_ABI = [
    "function vrfSubscriptionId() view returns (uint256)",
    "function vrfKeyHash() view returns (bytes32)",
    "function vrfCallbackGasLimit() view returns (uint32)",
    "function vrfRequestConfirmations() view returns (uint16)",
    "function setVrfConfig(uint256,bytes32,uint32,uint16) external",
  ];
  const keno = new ethers.Contract(KENO_ADDRESS, KENO_ABI, signer);
  const contractSubId = await keno.vrfSubscriptionId();
  console.log("\n--- Keno contract VRF config ---");
  console.log("Subscription ID in contract:", contractSubId.toString());

  if (contractSubId.toString() !== BigInt(SUB_ID).toString()) {
    console.log("⚠️  Mismatch! Updating contract subscription ID...");
    const keyHash       = await keno.vrfKeyHash();
    const gasLimit      = await keno.vrfCallbackGasLimit();
    const confirmations = await keno.vrfRequestConfirmations();
    const tx = await keno.setVrfConfig(BigInt(SUB_ID), keyHash, gasLimit, confirmations);
    console.log("  tx:", tx.hash);
    await tx.wait();
    console.log("  ✅ Contract subscription ID updated!");
  } else {
    console.log("✅ Contract subscription ID is correct.");
  }

  // ── Final status ──────────────────────────────────────────────────────────
  const subFinal = await coordinator.getSubscription(SUB_ID);
  console.log("\n--- Final subscription status ---");
  console.log("LINK balance :", ethers.formatEther(subFinal.balance), "LINK");
  console.log("Consumers    :", subFinal.consumers);
  console.log("\n🚀 Keno VRF ready on Amoy!");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌", err.message);
    process.exit(1);
  });
