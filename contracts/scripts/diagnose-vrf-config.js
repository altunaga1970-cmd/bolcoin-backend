const { ethers } = require("hardhat");

/**
 * VRF CONFIGURATION DIAGNOSTIC SCRIPT
 *
 * Purpose: Diagnose why closeAndRequestVRF() fails (C-02)
 *
 * What this checks:
 * 1. BingoGame contract configuration (VRF params)
 * 2. VRF Coordinator address validity
 * 3. Subscription ID and funding status
 * 4. Whether BingoGame is registered as a consumer
 * 5. Test VRF request (if possible)
 *
 * Required env vars:
 *   BINGO_CONTRACT_ADDRESS
 *   Operator wallet (OPERATOR_PRIVATE_KEY or DEPLOYER_KEY)
 *
 * Usage:
 *   npx hardhat run scripts/diagnose-vrf-config.js --network amoy
 *   npx hardhat run scripts/diagnose-vrf-config.js --network polygon
 */

async function main() {
  console.log("=== 🔍 VRF CONFIGURATION DIAGNOSTIC ===\n");

  const [signer] = await ethers.getSigners();
  console.log("Wallet:", signer.address);

  const balance = await ethers.provider.getBalance(signer.address);
  console.log("Balance:", ethers.formatEther(balance), "MATIC\n");

  // Get BingoGame contract
  const bingoAddress = process.env.BINGO_CONTRACT_ADDRESS;
  if (!bingoAddress) {
    throw new Error("❌ BINGO_CONTRACT_ADDRESS not set");
  }

  console.log("BingoGame:", bingoAddress);

  const BingoGame = await ethers.getContractFactory("BingoGame");
  const bingo = BingoGame.attach(bingoAddress);

  console.log("\n=== 1️⃣ Contract Configuration ===\n");

  // Get VRF config from contract
  const vrfSubscriptionId = await bingo.vrfSubscriptionId();
  const vrfKeyHash = await bingo.vrfKeyHash();
  const vrfCallbackGasLimit = await bingo.vrfCallbackGasLimit();
  const vrfRequestConfirmations = await bingo.vrfRequestConfirmations();
  const vrfTimeoutSeconds = await bingo.vrfTimeoutSeconds();

  console.log("VRF Subscription ID:", vrfSubscriptionId.toString());
  console.log("VRF Key Hash:      ", vrfKeyHash);
  console.log("Callback Gas Limit:", vrfCallbackGasLimit.toString());
  console.log("Confirmations:     ", vrfRequestConfirmations.toString());
  console.log("Timeout:           ", vrfTimeoutSeconds.toString(), "seconds");

  // Get VRF Coordinator address
  // Note: s_vrfCoordinator is inherited from VRFConsumerBaseV2Plus
  // We need to read it from storage or check deployment args
  let vrfCoordinator;
  try {
    // Try to get coordinator address (may not be exposed as public)
    // We'll have to infer it from the network
    const network = await ethers.provider.getNetwork();
    const networkName = network.name;
    const chainId = Number(network.chainId);

    console.log("\nNetwork:", networkName);
    console.log("Chain ID:", chainId);

    // Known VRF Coordinator addresses
    const KNOWN_COORDINATORS = {
      // Polygon Mainnet
      137: "0xec0Ed46f36576541C75739E915ADbCb3DE24bD77",
      // Polygon Amoy Testnet
      80002: "0x343300b5d84D444B2ADc9116FEF1bED02BE49Cf2",
      // Polygon Mumbai (deprecated)
      80001: "0x7a1BaC17Ccc5b313516C5E16fb24f7659aA5ebed"
    };

    vrfCoordinator = KNOWN_COORDINATORS[chainId];

    if (vrfCoordinator) {
      console.log("VRF Coordinator:   ", vrfCoordinator);
      console.log("  (inferred from chain ID)");
    } else {
      console.warn("⚠️  Unknown chain - cannot verify coordinator");
      vrfCoordinator = "0x0000000000000000000000000000000000000000";
    }
  } catch (err) {
    console.error("Error detecting network:", err.message);
    vrfCoordinator = "0x0000000000000000000000000000000000000000";
  }

  console.log("\n=== 2️⃣ VRF Coordinator Check ===\n");

  if (vrfCoordinator && vrfCoordinator !== "0x0000000000000000000000000000000000000000") {
    // Check if coordinator address has code
    const coordinatorCode = await ethers.provider.getCode(vrfCoordinator);
    if (coordinatorCode === "0x") {
      console.error("❌ VRF Coordinator has no code - invalid address!");
    } else {
      console.log("✅ VRF Coordinator has code (valid contract)");
      console.log(`   Code size: ${coordinatorCode.length / 2 - 1} bytes`);
    }

    // Try to connect to VRF Coordinator
    try {
      // Minimal VRF Coordinator ABI for subscription checking
      const VRF_COORDINATOR_ABI = [
        "function getSubscription(uint256 subId) view returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address owner, address[] memory consumers)",
        "function requestRandomWords(tuple(bytes32 keyHash, uint256 subId, uint16 requestConfirmations, uint32 callbackGasLimit, uint32 numWords, bytes extraArgs) req) external returns (uint256 requestId)"
      ];

      const coordinator = new ethers.Contract(
        vrfCoordinator,
        VRF_COORDINATOR_ABI,
        ethers.provider
      );

      console.log("\n=== 3️⃣ Subscription Status ===\n");

      try {
        const subscription = await coordinator.getSubscription(vrfSubscriptionId);

        console.log("Balance (LINK):   ", ethers.formatEther(subscription.balance), "LINK");
        console.log("Balance (Native): ", ethers.formatEther(subscription.nativeBalance), "MATIC");
        console.log("Request Count:    ", subscription.reqCount.toString());
        console.log("Owner:            ", subscription.owner);
        console.log("Consumers:        ", subscription.consumers.length);

        // Check if BingoGame is a consumer
        const isConsumer = subscription.consumers.some(
          addr => addr.toLowerCase() === bingoAddress.toLowerCase()
        );

        console.log("\n🔍 BingoGame registered as consumer?", isConsumer ? "✅ YES" : "❌ NO");

        if (!isConsumer) {
          console.error("\n❌ CRITICAL: BingoGame is NOT registered as a VRF consumer!");
          console.log("\n🔧 Fix:");
          console.log("1. Go to https://vrf.chain.link");
          console.log("2. Connect with subscription owner wallet:", subscription.owner);
          console.log("3. Find subscription ID:", vrfSubscriptionId.toString());
          console.log("4. Click 'Add Consumer'");
          console.log("5. Add address:", bingoAddress);
        }

        // Check if subscription has enough funds
        const totalBalance = subscription.balance + subscription.nativeBalance;
        if (totalBalance === 0n) {
          console.error("\n❌ CRITICAL: Subscription has ZERO balance!");
          console.log("\n🔧 Fix:");
          console.log("1. Go to https://vrf.chain.link");
          console.log("2. Find subscription ID:", vrfSubscriptionId.toString());
          console.log("3. Fund with LINK or MATIC");
          console.log("   Recommended: 5+ LINK or 50+ MATIC");
        } else if (totalBalance < ethers.parseEther("1")) {
          console.warn("\n⚠️  WARNING: Subscription balance is low");
          console.log("   Current:", ethers.formatEther(totalBalance));
          console.log("   Recommended: 5+ LINK or 50+ MATIC");
        } else {
          console.log("\n✅ Subscription has sufficient balance");
        }

        // List all consumers
        if (subscription.consumers.length > 0) {
          console.log("\nRegistered consumers:");
          subscription.consumers.forEach((addr, i) => {
            const isBingo = addr.toLowerCase() === bingoAddress.toLowerCase();
            console.log(`  ${i + 1}. ${addr}${isBingo ? " ← BingoGame" : ""}`);
          });
        }

      } catch (subErr) {
        console.error("❌ Error reading subscription:", subErr.message);
        console.log("\nPossible causes:");
        console.log("  - Subscription ID is incorrect");
        console.log("  - Subscription doesn't exist on this network");
        console.log("  - VRF Coordinator address is wrong");
      }

    } catch (coordErr) {
      console.error("Error connecting to VRF Coordinator:", coordErr.message);
    }
  }

  console.log("\n=== 4️⃣ Test VRF Request (Dry Run) ===\n");

  // Check if we can estimate gas for closeAndRequestVRF
  const roundCounter = await bingo.roundCounter();
  console.log("Latest round ID:", roundCounter.toString());

  if (roundCounter > 0n) {
    // Try the latest round
    const latestRound = await bingo.rounds(roundCounter);
    console.log("Latest round status:", latestRound.status);

    // Status: 1 = OPEN
    if (latestRound.status === 1n) {
      console.log("\nTrying to estimate gas for closeAndRequestVRF...");

      try {
        const operator = await bingo.operator();
        const signerIsOperator = signer.address.toLowerCase() === operator.toLowerCase();

        if (!signerIsOperator) {
          console.warn("⚠️  Skipping test: Connected wallet is not operator");
          console.log("   Operator:", operator);
          console.log("   Wallet:  ", signer.address);
        } else {
          const gasEstimate = await bingo.closeAndRequestVRF.estimateGas(roundCounter);
          console.log("✅ Gas estimate succeeded:", gasEstimate.toString());
          console.log("   VRF request would likely succeed!");
        }
      } catch (gasErr) {
        console.error("❌ Gas estimation failed:", gasErr.message);

        // Parse error code
        if (gasErr.data) {
          console.log("\nError data:", gasErr.data);

          // Check for known error signatures
          const errorSignatures = {
            "0x25470bc4": "MaxOpenRoundsReached()",
            "0x88d5f7e2": "NotOperator()",
            "0xbf1d8e73": "RoundNotOpen()"
          };

          const errorSig = gasErr.data.slice(0, 10);
          const knownError = errorSignatures[errorSig];

          if (knownError) {
            console.log("Known error:", knownError);

            if (errorSig === "0x25470bc4") {
              console.log("\n🔧 This confirms C-01: Too many open rounds");
              console.log("   Run: npx hardhat run scripts/emergency-cancel-rounds.js --network <network>");
            }
          }
        }

        console.log("\nPossible causes:");
        console.log("  - Subscription not funded (check step 3)");
        console.log("  - BingoGame not registered as consumer (check step 3)");
        console.log("  - Too many open rounds (run emergency-cancel-rounds.js)");
        console.log("  - VRF Coordinator address mismatch");
      }
    } else {
      console.log("Latest round is not OPEN - cannot test closeAndRequestVRF");
    }
  }

  console.log("\n=== Summary ===\n");
  console.log("Next steps:");
  console.log("1. Ensure subscription has funds (5+ LINK or 50+ MATIC)");
  console.log("2. Add BingoGame as consumer if not registered");
  console.log("3. Clear orphan rounds with emergency-cancel-rounds.js");
  console.log("4. Test VRF request with a real round");
  console.log("\nVRF Dashboard:");
  console.log("  https://vrf.chain.link");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ Error:", err.message);
    console.error(err);
    process.exit(1);
  });
