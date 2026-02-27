/**
 * add-keno-consumer-amoy.js
 *
 * Registers the deployed KenoGame contract as a consumer on the
 * Chainlink VRF V2.5 subscription in Polygon Amoy.
 *
 * IMPORTANT: Only the OWNER of the subscription can call addConsumer().
 * The deployer wallet (DEPLOYER_KEY in contracts/.env) must be the sub owner.
 *
 * Prerequisites:
 *   - contracts/.env must have DEPLOYER_KEY set to the subscription owner's private key
 *   - The VRF subscription must already exist and be funded with LINK
 *   - Get testnet LINK at: https://faucets.chain.link (select Polygon Amoy)
 *   - Get Amoy POL at: https://faucet.polygon.technology
 *
 * Usage:
 *   npx hardhat run scripts/add-keno-consumer-amoy.js --network amoy
 *
 * What this does:
 *   1. Connects to the VRF Coordinator on Amoy
 *   2. Reads the current subscription state (balance, consumers)
 *   3. Checks if KenoGame is already registered
 *   4. Calls coordinator.addConsumer(subId, kenoAddress) if not yet registered
 *   5. Optionally syncs the subId stored inside KenoGame (setVrfConfig) if mismatched
 */

const { ethers } = require("hardhat");

// ─── Amoy constants (do NOT change) ──────────────────────────────────────────
const VRF_COORDINATOR = "0x343300b5d84D444B2ADc9116FEF1bED02BE49Cf2";
const KENO_ADDRESS    = "0xAa1d6945e691807CBCC239F6C89C6469E0eD4998";
const SUB_ID          = "7970515401521569318593654502782683303673295181035791822529802935575344475841";

// Minimal ABI — only what we need
const COORDINATOR_ABI = [
  // Read subscription info (owner, balance, consumers list)
  "function getSubscription(uint256 subId) view returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address subOwner, address[] consumers)",
  // Register a consumer contract (subId owner only)
  "function addConsumer(uint256 subId, address consumer) external",
  // Coordinator version string
  "function typeAndVersion() view returns (string)",
];

const KENO_ABI = [
  "function vrfSubscriptionId() view returns (uint256)",
  "function vrfKeyHash() view returns (bytes32)",
  "function vrfCallbackGasLimit() view returns (uint32)",
  "function vrfRequestConfirmations() view returns (uint16)",
  "function setVrfConfig(uint256 subId, bytes32 keyHash, uint32 gasLimit, uint16 confirmations) external",
  "function owner() view returns (address)",
  "function payoutTableVersion() view returns (uint256)",
  "function availablePool() view returns (uint256)",
  "function paused() view returns (bool)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const polBalance = await ethers.provider.getBalance(signer.address);

  console.log("=== Add KenoGame as VRF Consumer — Polygon Amoy ===");
  console.log("Signer      :", signer.address);
  console.log("POL balance :", ethers.formatEther(polBalance), "POL");
  console.log("Keno address:", KENO_ADDRESS);
  console.log("VRF Sub ID  :", SUB_ID);

  // ── 1. Verify coordinator has code ─────────────────────────────────────────
  console.log("\n[1/5] Checking VRF Coordinator...");
  const coordCode = await ethers.provider.getCode(VRF_COORDINATOR);
  if (coordCode === "0x") {
    console.error("FAIL: VRF Coordinator has no code at", VRF_COORDINATOR);
    console.error("      Wrong address or wrong network. Expected Polygon Amoy.");
    process.exit(1);
  }

  const coordinator = new ethers.Contract(VRF_COORDINATOR, COORDINATOR_ABI, signer);

  try {
    const version = await coordinator.typeAndVersion();
    console.log("     Coordinator version:", version);
  } catch {
    console.log("     (typeAndVersion() not available on this coordinator)");
  }

  // ── 2. Verify KenoGame has code ─────────────────────────────────────────────
  console.log("\n[2/5] Checking KenoGame contract...");
  const kenoCode = await ethers.provider.getCode(KENO_ADDRESS);
  if (kenoCode === "0x") {
    console.error("FAIL: KenoGame has no code at", KENO_ADDRESS);
    process.exit(1);
  }
  console.log("     KenoGame contract found at", KENO_ADDRESS);

  // ── 3. Read subscription from coordinator ───────────────────────────────────
  console.log("\n[3/5] Reading VRF subscription...");
  let sub;
  try {
    sub = await coordinator.getSubscription(BigInt(SUB_ID));
  } catch (err) {
    console.error("FAIL: coordinator.getSubscription() reverted:", err.message);
    console.error("      The subscription ID may not exist on this coordinator.");
    console.error("      Check https://vrf.chain.link for the correct subscription ID.");
    process.exit(1);
  }

  console.log("     LINK balance  :", ethers.formatEther(sub.balance), "LINK");
  console.log("     Native balance:", ethers.formatEther(sub.nativeBalance), "POL");
  console.log("     Request count :", sub.reqCount.toString());
  console.log("     Sub owner     :", sub.subOwner);
  console.log("     Consumers     :", sub.consumers.length > 0 ? sub.consumers : "(none)");

  // Warn if subscription balance is low
  if (sub.balance < ethers.parseEther("1") && sub.nativeBalance < ethers.parseEther("5")) {
    console.warn("\n  WARNING: Subscription balance may be too low.");
    console.warn("  Recommend at least 2 LINK or 10 POL native.");
    console.warn("  Fund at: https://vrf.chain.link");
  }

  // Verify the signer is the sub owner
  if (sub.subOwner.toLowerCase() !== signer.address.toLowerCase()) {
    console.error("\nFAIL: The connected wallet is NOT the subscription owner.");
    console.error("  Sub owner :", sub.subOwner);
    console.error("  Signer    :", signer.address);
    console.error("  Only the subscription owner can call addConsumer().");
    console.error("  Set DEPLOYER_KEY in contracts/.env to the sub owner's private key.");
    process.exit(1);
  }
  console.log("     Signer is subscription owner: OK");

  // ── 4. Register KenoGame as consumer (idempotent) ──────────────────────────
  console.log("\n[4/5] Registering KenoGame as consumer...");
  const already = sub.consumers
    .map(a => a.toLowerCase())
    .includes(KENO_ADDRESS.toLowerCase());

  if (already) {
    console.log("     KenoGame is already registered as a consumer. Nothing to do.");
  } else {
    console.log("     Calling coordinator.addConsumer(subId, kenoAddress)...");
    const tx = await coordinator.addConsumer(BigInt(SUB_ID), KENO_ADDRESS);
    console.log("     tx:", tx.hash);
    await tx.wait();
    console.log("     KenoGame registered as consumer.");

    // Confirm
    const subAfter = await coordinator.getSubscription(BigInt(SUB_ID));
    const confirmed = subAfter.consumers
      .map(a => a.toLowerCase())
      .includes(KENO_ADDRESS.toLowerCase());
    if (!confirmed) {
      console.error("FAIL: Consumer registration could not be confirmed on-chain.");
      process.exit(1);
    }
    console.log("     Confirmed: KenoGame is now in the consumers list.");
  }

  // ── 5. Verify / sync VRF config inside KenoGame ────────────────────────────
  console.log("\n[5/5] Verifying VRF config stored in KenoGame...");
  const keno = new ethers.Contract(KENO_ADDRESS, KENO_ABI, signer);

  const contractSubId  = await keno.vrfSubscriptionId();
  const keyHash        = await keno.vrfKeyHash();
  const gasLimit       = await keno.vrfCallbackGasLimit();
  const confirmations  = await keno.vrfRequestConfirmations();
  const payoutVersion  = await keno.payoutTableVersion();
  const pool           = await keno.availablePool();
  const isPaused       = await keno.paused();

  console.log("     vrfSubscriptionId :", contractSubId.toString());
  console.log("     vrfKeyHash        :", keyHash);
  console.log("     callbackGasLimit  :", gasLimit.toString());
  console.log("     confirmations     :", confirmations.toString());
  console.log("     payoutTableVersion:", payoutVersion.toString());
  console.log("     availablePool     :", ethers.formatUnits(pool, 6), "USDT");
  console.log("     paused            :", isPaused);

  // Sync sub ID inside contract if it does not match
  if (contractSubId.toString() !== BigInt(SUB_ID).toString()) {
    console.log("\n  Sub ID mismatch — updating contract via setVrfConfig()...");
    const kenoOwner = await keno.owner();
    if (kenoOwner.toLowerCase() !== signer.address.toLowerCase()) {
      console.error("  FAIL: Signer is not the KenoGame owner.");
      console.error("  KenoGame owner:", kenoOwner);
      console.error("  Cannot update VRF config. Fix manually or use the owner wallet.");
      process.exit(1);
    }
    const syncTx = await keno.setVrfConfig(
      BigInt(SUB_ID),
      keyHash,
      gasLimit,
      confirmations
    );
    console.log("  sync tx:", syncTx.hash);
    await syncTx.wait();
    const newSubId = await keno.vrfSubscriptionId();
    console.log("  Contract sub ID updated to:", newSubId.toString());
  } else {
    console.log("     Sub ID in contract matches. No update needed.");
  }

  // ── Final summary ───────────────────────────────────────────────────────────
  console.log("\n=== RESULT ===");
  console.log("KenoGame address :", KENO_ADDRESS);
  console.log("VRF Sub ID       :", SUB_ID);
  console.log("Consumer status  : REGISTERED");
  console.log("Payout table     :", payoutVersion > 0n ? `version ${payoutVersion}` : "NOT SET — run recover-keno-payout-amoy.js");
  console.log("Pool available   :", ethers.formatUnits(pool, 6), "USDT");
  console.log("Contract paused  :", isPaused);

  if (payoutVersion === 0n) {
    console.log("\nNEXT: Payout table not committed. Run:");
    console.log("  npx hardhat run scripts/recover-keno-payout-amoy.js --network amoy");
  }
  if (pool === 0n) {
    console.log("\nNEXT: Fund the pool so VRF payouts can be made:");
    console.log("  Approve USDT to", KENO_ADDRESS, "then call keno.fundPool(amount).");
  }

  console.log("\nKeno VRF consumer registration complete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nFatal error:", err.message);
    if (err.data) console.error("Revert data:", err.data);
    process.exit(1);
  });
