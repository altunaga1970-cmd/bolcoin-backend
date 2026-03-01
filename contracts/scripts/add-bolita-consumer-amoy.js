/**
 * add-bolita-consumer-amoy.js
 *
 * Registers LaBolitaGame v2 as a consumer on the Chainlink VRF V2.5
 * subscription in Polygon Amoy. Also syncs the sub ID stored inside the
 * contract if it does not match the one in contracts/.env.
 *
 * IMPORTANT: Only the OWNER of the subscription can call addConsumer().
 * The deployer wallet (DEPLOYER_KEY in contracts/.env) must be the sub owner.
 *
 * Prerequisites:
 *   - contracts/.env must have DEPLOYER_KEY set to the subscription owner's private key
 *   - VRF_SUBSCRIPTION_ID set in contracts/.env
 *   - The VRF subscription must already be funded with LINK
 *
 * Usage:
 *   npx hardhat run scripts/add-bolita-consumer-amoy.js --network amoy
 */

const { ethers } = require("hardhat");

const VRF_COORDINATOR = process.env.VRF_COORDINATOR_ADDRESS || "0x343300b5d84D444B2ADc9116FEF1bED02BE49Cf2";
const BOLITA_ADDRESS  = "0x1F4c288f6e5dE5731783bBaF83555CC926dDB383"; // v2 (double-pay fix)
const SUB_ID          = process.env.VRF_SUBSCRIPTION_ID;

if (!SUB_ID) {
  console.error("ERROR: VRF_SUBSCRIPTION_ID is not set in contracts/.env");
  console.error("  Set VRF_SUBSCRIPTION_ID=<your-sub-id> in contracts/.env");
  process.exit(1);
}

const COORDINATOR_ABI = [
  "function getSubscription(uint256 subId) view returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address subOwner, address[] consumers)",
  "function addConsumer(uint256 subId, address consumer) external",
  "function typeAndVersion() view returns (string)",
];

const BOLITA_ABI = [
  "function owner() view returns (address)",
  "function vrfSubscriptionId() view returns (uint256)",
  "function vrfKeyHash() view returns (bytes32)",
  "function vrfCallbackGasLimit() view returns (uint32)",
  "function vrfRequestConfirmations() view returns (uint16)",
  "function setVrfConfig(uint256 subId, bytes32 keyHash, uint32 gasLimit, uint16 confirmations) external",
  "function availablePool() view returns (uint256)",
  "function paused() view returns (bool)",
  "function drawCounter() view returns (uint256)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const polBalance = await ethers.provider.getBalance(signer.address);

  console.log("=== Add LaBolitaGame v2 as VRF Consumer — Polygon Amoy ===");
  console.log("Signer        :", signer.address);
  console.log("POL balance   :", ethers.formatEther(polBalance), "POL");
  console.log("Bolita v2     :", BOLITA_ADDRESS);
  console.log("VRF Sub ID    :", SUB_ID);
  console.log("Coordinator   :", VRF_COORDINATOR);

  // ── 1. Verificar que el coordinator tiene código ───────────────────────────
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
    console.log("     Coordinator:", version);
  } catch {
    console.log("     (typeAndVersion() not available)");
  }

  // ── 2. Verificar que LaBolita v2 tiene código ─────────────────────────────
  console.log("\n[2/5] Checking LaBolitaGame v2 contract...");
  const bolitaCode = await ethers.provider.getCode(BOLITA_ADDRESS);
  if (bolitaCode === "0x") {
    console.error("FAIL: LaBolitaGame v2 has NO code at", BOLITA_ADDRESS);
    console.error("      El contrato no está deployado en esta dirección.");
    console.error("      Corre primero: npx hardhat run scripts/deploy-bolita-amoy.js --network amoy");
    process.exit(1);
  }
  console.log("     Contract found at", BOLITA_ADDRESS);

  // ── 3. Leer la suscripción VRF ────────────────────────────────────────────
  console.log("\n[3/5] Reading VRF subscription...");
  let sub;
  try {
    sub = await coordinator.getSubscription(BigInt(SUB_ID));
  } catch (err) {
    console.error("FAIL: coordinator.getSubscription() reverted:", err.message);
    console.error("      La suscripción puede no existir en este coordinator.");
    console.error("      Verifica en https://vrf.chain.link el sub ID correcto.");
    process.exit(1);
  }

  console.log("     LINK balance  :", ethers.formatEther(sub.balance), "LINK");
  console.log("     Native balance:", ethers.formatEther(sub.nativeBalance), "POL");
  console.log("     Request count :", sub.reqCount.toString());
  console.log("     Sub owner     :", sub.subOwner);
  console.log("     Consumers     :", sub.consumers.length > 0 ? sub.consumers : "(none)");

  if (sub.balance < ethers.parseEther("1") && sub.nativeBalance < ethers.parseEther("5")) {
    console.warn("\n  WARNING: Subscription balance may be too low for VRF requests.");
    console.warn("  Recommend at least 2 LINK or 10 POL native.");
    console.warn("  Fund at: https://vrf.chain.link");
  }

  if (sub.subOwner.toLowerCase() !== signer.address.toLowerCase()) {
    console.error("\nFAIL: The connected wallet is NOT the subscription owner.");
    console.error("  Sub owner :", sub.subOwner);
    console.error("  Signer    :", signer.address);
    console.error("  Only the subscription owner can call addConsumer().");
    console.error("  Set DEPLOYER_KEY in contracts/.env to the sub owner's private key.");
    process.exit(1);
  }
  console.log("     Signer is subscription owner: OK");

  // ── 4. Registrar LaBolitaGame v2 como consumer ───────────────────────────
  console.log("\n[4/5] Registering LaBolitaGame v2 as VRF consumer...");
  const already = sub.consumers
    .map(a => a.toLowerCase())
    .includes(BOLITA_ADDRESS.toLowerCase());

  if (already) {
    console.log("     LaBolitaGame v2 already registered as consumer. Nothing to do.");
  } else {
    console.log("     Calling coordinator.addConsumer(subId, bolitaV2)...");
    const tx = await coordinator.addConsumer(BigInt(SUB_ID), BOLITA_ADDRESS);
    console.log("     tx:", tx.hash);
    await tx.wait();

    const subAfter = await coordinator.getSubscription(BigInt(SUB_ID));
    const confirmed = subAfter.consumers
      .map(a => a.toLowerCase())
      .includes(BOLITA_ADDRESS.toLowerCase());
    if (!confirmed) {
      console.error("FAIL: Consumer registration could not be confirmed on-chain.");
      process.exit(1);
    }
    console.log("     LaBolitaGame v2 registered as consumer: CONFIRMED");
    console.log("     All consumers:", subAfter.consumers);
  }

  // ── 5. Verificar / sincronizar VRF config dentro del contrato ────────────
  console.log("\n[5/5] Verifying VRF config stored in LaBolitaGame v2...");
  const bolita = new ethers.Contract(BOLITA_ADDRESS, BOLITA_ABI, signer);

  const contractSubId  = await bolita.vrfSubscriptionId();
  const keyHash        = await bolita.vrfKeyHash();
  const gasLimit       = await bolita.vrfCallbackGasLimit();
  const confirmations  = await bolita.vrfRequestConfirmations();
  const pool           = await bolita.availablePool();
  const isPaused       = await bolita.paused();
  const drawCount      = await bolita.drawCounter();

  console.log("     vrfSubscriptionId :", contractSubId.toString());
  console.log("     vrfKeyHash        :", keyHash);
  console.log("     callbackGasLimit  :", gasLimit.toString());
  console.log("     confirmations     :", confirmations.toString());
  console.log("     availablePool     :", ethers.formatUnits(pool, 6), "USDT");
  console.log("     paused            :", isPaused);
  console.log("     drawCounter       :", drawCount.toString());

  if (contractSubId.toString() !== BigInt(SUB_ID).toString()) {
    console.log("\n  Sub ID mismatch — syncing via setVrfConfig()...");
    const bolitaOwner = await bolita.owner();
    if (bolitaOwner.toLowerCase() !== signer.address.toLowerCase()) {
      console.error("  FAIL: Signer is not LaBolitaGame owner. Cannot sync sub ID.");
      console.error("  LaBolitaGame owner:", bolitaOwner);
      process.exit(1);
    }
    const syncTx = await bolita.setVrfConfig(
      BigInt(SUB_ID),
      keyHash,
      gasLimit,
      confirmations
    );
    console.log("  sync tx:", syncTx.hash);
    await syncTx.wait();
    const newSubId = await bolita.vrfSubscriptionId();
    console.log("  Contract sub ID updated to:", newSubId.toString());
  } else {
    console.log("     Sub ID in contract matches. No update needed.");
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("\n=== RESULT ===");
  console.log("LaBolitaGame v2  :", BOLITA_ADDRESS);
  console.log("VRF Sub ID       :", SUB_ID);
  console.log("Consumer status  : REGISTERED");
  console.log("Pool available   :", ethers.formatUnits(pool, 6), "USDT");
  console.log("Contract paused  :", isPaused);

  if (pool === 0n) {
    console.log("\nNEXT: Pool is empty. Fund it:");
    console.log("  npx hardhat run scripts/fund-bolita-amoy.js --network amoy");
  } else {
    console.log("\nNEXT: Set BRM limits:");
    console.log("  npx hardhat run scripts/set-bolita-limits-amoy.js --network amoy");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nFatal error:", err.message);
    if (err.data) console.error("Revert data:", err.data);
    process.exit(1);
  });
