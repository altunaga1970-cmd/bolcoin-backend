/**
 * Diagnostic: read VRF config stored inside the deployed KenoGame contract
 * and verify it against the coordinator.
 *
 * Usage:
 *   npx hardhat run scripts/check-keno-vrf.js --network amoy
 */
const { ethers } = require("hardhat");

const KENO_ADDRESS   = "0xAa1d6945e691807CBCC239F6C89C6469E0eD4998";
const VRF_COORDINATOR = "0x343300b5d84D444B2ADc9116FEF1bED02BE49Cf2";

const KENO_ABI = [
  "function vrfSubscriptionId() view returns (uint256)",
  "function vrfKeyHash() view returns (bytes32)",
  "function vrfCallbackGasLimit() view returns (uint32)",
  "function vrfRequestConfirmations() view returns (uint16)",
];

const COORDINATOR_ABI = [
  "function getSubscription(uint256 subId) view returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address subOwner, address[] consumers)",
  "function typeAndVersion() view returns (string)",
];

async function main() {
  const provider = ethers.provider;

  console.log("=== Keno VRF Diagnostic ===\n");

  // ── 1. Verify coordinator has code ───────────────────────────────────────
  const coordCode = await provider.getCode(VRF_COORDINATOR);
  if (coordCode === "0x") {
    console.error("❌ VRF Coordinator has NO code at", VRF_COORDINATOR);
    console.error("   Wrong address or wrong network.");
    process.exit(1);
  }
  console.log("✅ VRF Coordinator has code");

  // ── 2. Print coordinator version ─────────────────────────────────────────
  try {
    const coord = new ethers.Contract(VRF_COORDINATOR, COORDINATOR_ABI, provider);
    const version = await coord.typeAndVersion();
    console.log("   Version:", version);
  } catch {
    console.log("   (typeAndVersion not available)");
  }

  // ── 3. Read config from Keno contract ────────────────────────────────────
  const kenoCode = await provider.getCode(KENO_ADDRESS);
  if (kenoCode === "0x") {
    console.error("\n❌ KenoGame has NO code at", KENO_ADDRESS);
    process.exit(1);
  }

  const keno = new ethers.Contract(KENO_ADDRESS, KENO_ABI, provider);
  const subId       = await keno.vrfSubscriptionId();
  const keyHash     = await keno.vrfKeyHash();
  const gasLimit    = await keno.vrfCallbackGasLimit();
  const confirms    = await keno.vrfRequestConfirmations();

  console.log("\n--- KenoGame stored VRF config ---");
  console.log("Subscription ID    :", subId.toString());
  console.log("Key Hash           :", keyHash);
  console.log("Callback Gas Limit :", gasLimit.toString());
  console.log("Confirmations      :", confirms.toString());

  // ── 4. Try to read the subscription ──────────────────────────────────────
  console.log("\n--- Checking subscription at coordinator ---");
  const coord = new ethers.Contract(VRF_COORDINATOR, COORDINATOR_ABI, provider);
  try {
    const sub = await coord.getSubscription(subId);
    console.log("✅ Subscription exists!");
    console.log("   LINK balance   :", ethers.formatEther(sub.balance), "LINK");
    console.log("   Native balance :", ethers.formatEther(sub.nativeBalance), "POL");
    console.log("   Owner          :", sub.subOwner);
    console.log("   Consumers      :", sub.consumers);

    const isConsumer = sub.consumers
      .map(a => a.toLowerCase())
      .includes(KENO_ADDRESS.toLowerCase());
    console.log("   KenoGame is consumer?", isConsumer ? "✅ YES" : "❌ NO");
  } catch (e) {
    console.error("❌ getSubscription reverted:", e.message);
    console.log("\n   The subscription ID stored in the contract does NOT exist");
    console.log("   at this coordinator.");
    console.log("\n   Subscription ID in contract:", subId.toString());
    console.log("   You need to:");
    console.log("   1. Check vrf.chain.link for the EXACT subscription ID");
    console.log("   2. Run update-keno-sub.js with the correct ID");
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("Fatal:", err.message);
    process.exit(1);
  });
