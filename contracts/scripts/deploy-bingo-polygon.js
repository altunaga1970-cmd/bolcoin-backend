/**
 * Deploy BingoGame to Polygon Mainnet
 *
 * Usage:
 *   npx hardhat run scripts/deploy-bingo-polygon.js --network polygon
 *
 * Required env vars in contracts/.env:
 *   POLYGON_RPC_URL     — Alchemy/Infura Polygon Mainnet RPC
 *   DEPLOYER_KEY        — Private key of owner wallet (Personal wallet)
 *   VRF_SUBSCRIPTION_ID — Chainlink VRF subscription ID (from vrf.chain.link/polygon)
 *   OPERATOR_ADDRESS    — Admin wallet address (NOT private key)
 */

const hre = require("hardhat");

// ─── POLYGON MAINNET — OFFICIAL CHAINLINK ADDRESSES ──────────────────────────
const USDT_POLYGON    = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
const VRF_COORDINATOR = "0xAE975071Be8F8eE67addBC1A82488F1C24858067"; // VRF V2.5
const KEY_HASH_500    = "0xcc294a196eeeb44da2888d17c0625cc88d70d9760a69d58d853ba6581a9ab0cd"; // 500 gwei lane
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const subscriptionId = process.env.VRF_SUBSCRIPTION_ID;
  const operatorAddress = process.env.OPERATOR_ADDRESS;

  if (!subscriptionId) throw new Error("VRF_SUBSCRIPTION_ID no está en .env");
  if (!operatorAddress) throw new Error("OPERATOR_ADDRESS no está en .env");

  const [deployer] = await hre.ethers.getSigners();

  console.log("═══════════════════════════════════════════════");
  console.log("  BingoGame — Polygon Mainnet Deploy");
  console.log("═══════════════════════════════════════════════");
  console.log("  Deployer (owner):", deployer.address);
  console.log("  Operator (admin):", operatorAddress);
  console.log("  USDT:            ", USDT_POLYGON);
  console.log("  VRF Coordinator: ", VRF_COORDINATOR);
  console.log("  Subscription ID: ", subscriptionId);
  console.log("  Key Hash (500gwei):", KEY_HASH_500);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("  Deployer POL balance:", hre.ethers.formatEther(balance), "POL");
  console.log("───────────────────────────────────────────────\n");

  if (balance < hre.ethers.parseEther("1")) {
    throw new Error("Balance insuficiente. Necesitas al menos 1 POL para el gas.");
  }

  console.log("Deploying BingoGame...");
  const BingoGame = await hre.ethers.getContractFactory("BingoGame");

  const bingo = await BingoGame.deploy(
    USDT_POLYGON,
    VRF_COORDINATOR,
    BigInt(subscriptionId),
    KEY_HASH_500,
    operatorAddress
  );

  console.log("Waiting for deployment confirmation...");
  await bingo.waitForDeployment();

  const address = await bingo.getAddress();
  const txHash = bingo.deploymentTransaction().hash;

  console.log("\n✅ BingoGame deployed successfully!");
  console.log("═══════════════════════════════════════════════");
  console.log("  Contract address:", address);
  console.log("  Transaction:     ", txHash);
  console.log("  PolygonScan:      https://polygonscan.com/address/" + address);
  console.log("═══════════════════════════════════════════════");

  console.log("\n📋 PASOS SIGUIENTES:");
  console.log("  1. Añadir como consumer en: https://vrf.chain.link/polygon");
  console.log("     Subscription ID:", subscriptionId);
  console.log("     Consumer address:", address);
  console.log("\n  2. Actualizar Railway con:");
  console.log("     BINGO_CONTRACT_ADDRESS=" + address);
  console.log("\n  3. Actualizar Cloudflare Pages con:");
  console.log("     VITE_BINGO_CONTRACT_ADDRESS=" + address);
  console.log("\n  4. Verificar en PolygonScan:");
  console.log("     npx hardhat verify --network polygon \\");
  console.log("       " + address + " \\");
  console.log('       "' + USDT_POLYGON + '" \\');
  console.log('       "' + VRF_COORDINATOR + '" \\');
  console.log('       "' + subscriptionId + '" \\');
  console.log('       "' + KEY_HASH_500 + '" \\');
  console.log('       "' + operatorAddress + '"');
  console.log("\n  5. Fondear el pool:");
  console.log("     - Ir a: https://polygonscan.com/address/" + address);
  console.log("     - Write Contract → fundPool (primero approve USDT)");
  console.log("     - Mínimo recomendado: 200 USDT");
}

main().catch((err) => {
  console.error("\n❌ Deploy failed:", err);
  process.exit(1);
});
