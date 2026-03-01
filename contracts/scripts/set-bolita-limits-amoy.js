/**
 * set-bolita-limits-amoy.js
 *
 * Actualiza los límites de apuesta en LaBolitaGame (Polygon Amoy)
 * usando una fórmula de Bankroll Management (BRM) basada en el pool real del contrato.
 *
 * Fórmula BRM:
 *   maxExposurePerNumber = pool * RISK_PCT / MAX_MULTIPLIER
 *   donde:
 *     RISK_PCT      = 30% (riesgo máximo aceptable por sorteo)
 *     MAX_MULTIPLIER = 1000 (Parle — el multiplicador más alto)
 *
 * Ejemplo con pool = 1000 USDT:
 *   maxExposurePerNumber = 1000 * 0.30 / 1000 = 0.30 USDT por número por sorteo
 *
 * Garantía: aunque TODOS los jugadores acumulen la exposición máxima en un
 * número ganador de Parle, el pool solo pierde como máximo el 30%.
 *
 * Override opcional vía env (útil para tests con pool pequeño):
 *   MIN_BET=0.10 MAX_BET=0.30 MAX_EXPOSURE=0.30 npx hardhat run ...
 *
 * Usage:
 *   npx hardhat run scripts/set-bolita-limits-amoy.js --network amoy
 */

const { ethers } = require("hardhat");

const BOLITA_ADDRESS = "0x6B07df51947f3e476B7574C14fF3293a8a4c846A";
const TOKEN_DECIMALS = 6;

// BRM constants
const PARLE_MULTIPLIER = 1000n;  // highest multiplier (Parle)
const RISK_PCT_NUM     = 30n;    // 30% risk cap per draw
const RISK_PCT_DEN     = 100n;

// Fixed minimum — env override allowed
const MIN_BET = ethers.parseUnits(process.env.MIN_BET || "0.10", TOKEN_DECIMALS);

const BOLITA_ABI = [
  "function setBetLimits(uint256 _minBet, uint256 _maxBet, uint256 _maxExposure) external",
  "function minBetAmount()         view returns (uint256)",
  "function maxBetAmount()         view returns (uint256)",
  "function maxExposurePerNumber() view returns (uint256)",
  "function availablePool()        view returns (uint256)",
  "function owner()                view returns (address)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const polBalance = await ethers.provider.getBalance(signer.address);

  console.log("=== LaBolitaGame — Set Bet Limits (BRM) — Polygon Amoy ===");
  console.log("Signer        :", signer.address);
  console.log("POL balance   :", ethers.formatEther(polBalance), "POL");
  console.log("Contract      :", BOLITA_ADDRESS);

  const bolita = new ethers.Contract(BOLITA_ADDRESS, BOLITA_ABI, signer);

  // ── 1. Verificar que el signer sea el owner ───────────────────────────────
  const owner = await bolita.owner();
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    console.error("\nFAIL: el signer no es el owner de LaBolitaGame.");
    console.error("  Owner  :", owner);
    console.error("  Signer :", signer.address);
    console.error("  Configura DEPLOYER_KEY en contracts/.env con la clave del owner.");
    process.exit(1);
  }
  console.log("\n[1/4] Signer es el owner: OK");

  // ── 2. Leer estado actual del contrato ────────────────────────────────────
  const [curMin, curMax, curExp, curPool] = await Promise.all([
    bolita.minBetAmount(),
    bolita.maxBetAmount(),
    bolita.maxExposurePerNumber(),
    bolita.availablePool(),
  ]);

  console.log("\n[2/4] Estado actual del contrato:");
  console.log("  minBetAmount         :", ethers.formatUnits(curMin,  TOKEN_DECIMALS), "USDT");
  console.log("  maxBetAmount         :", ethers.formatUnits(curMax,  TOKEN_DECIMALS), "USDT");
  console.log("  maxExposurePerNumber :", ethers.formatUnits(curExp,  TOKEN_DECIMALS), "USDT");
  console.log("  availablePool        :", ethers.formatUnits(curPool, TOKEN_DECIMALS), "USDT");

  // ── 3. Calcular límites BRM ───────────────────────────────────────────────
  //   maxExposurePerNumber = pool * 30% / 1000
  //   Si el pool es 0 (no financiado), usar fallback de 0.30 USDT
  let brmExposure;
  if (curPool === 0n) {
    console.warn("\n  WARN: pool = 0. Usando fallback BRM de 0.30 USDT.");
    brmExposure = ethers.parseUnits("0.30", TOKEN_DECIMALS);
  } else {
    brmExposure = (curPool * RISK_PCT_NUM) / (RISK_PCT_DEN * PARLE_MULTIPLIER);
    if (brmExposure === 0n) {
      // Pool too small for integer division — use 1 μUSDT minimum
      brmExposure = 1n;
    }
  }

  // Allow env override
  const MAX_EXPOSURE = process.env.MAX_EXPOSURE
    ? ethers.parseUnits(process.env.MAX_EXPOSURE, TOKEN_DECIMALS)
    : brmExposure;

  // maxBetAmount = maxExposurePerNumber (a single bet can't exceed the exposure cap)
  const MAX_BET = process.env.MAX_BET
    ? ethers.parseUnits(process.env.MAX_BET, TOKEN_DECIMALS)
    : MAX_EXPOSURE;

  const poolUsdt = Number(ethers.formatUnits(curPool, TOKEN_DECIMALS));
  const expUsdt  = Number(ethers.formatUnits(MAX_EXPOSURE, TOKEN_DECIMALS));

  console.log("\n[3/4] Análisis BRM:");
  console.log(`  Pool disponible      : ${poolUsdt.toFixed(6)} USDT`);
  console.log(`  Riesgo máximo (30%)  : ${(poolUsdt * 0.30).toFixed(6)} USDT por sorteo`);
  console.log(`  Multiplicador Parle  : 1000x`);
  console.log(`  maxExposurePerNumber : ${expUsdt.toFixed(6)} USDT (= pool*30%/1000)`);
  console.log(`    → Peor caso Parle  : ${(expUsdt * 1000).toFixed(6)} USDT payout (${((expUsdt * 1000 / poolUsdt) * 100).toFixed(1)}% del pool)`);
  console.log(`    → Peor caso Centena: ${(expUsdt * 300).toFixed(6)} USDT payout (${((expUsdt * 300 / poolUsdt) * 100).toFixed(1)}% del pool)`);
  console.log(`    → Peor caso Fijo   : ${(expUsdt * 65).toFixed(6)} USDT payout (${((expUsdt * 65 / poolUsdt) * 100).toFixed(1)}% del pool)`);
  console.log(`  minBetAmount         : ${ethers.formatUnits(MIN_BET, TOKEN_DECIMALS)} USDT`);
  console.log(`  maxBetAmount         : ${ethers.formatUnits(MAX_BET, TOKEN_DECIMALS)} USDT`);

  // ── 4. Llamar setBetLimits ───────────────────────────────────────────────
  console.log("\n[4/4] Llamando setBetLimits...");
  const tx = await bolita.setBetLimits(MIN_BET, MAX_BET, MAX_EXPOSURE);
  console.log("  tx hash:", tx.hash);
  const receipt = await tx.wait();
  console.log("  confirmado en bloque:", receipt.blockNumber);

  // Verificar resultado
  const [newMin, newMax, newExp] = await Promise.all([
    bolita.minBetAmount(),
    bolita.maxBetAmount(),
    bolita.maxExposurePerNumber(),
  ]);

  console.log("\n=== RESULTADO ===");
  console.log("  minBetAmount         :", ethers.formatUnits(newMin, TOKEN_DECIMALS), "USDT");
  console.log("  maxBetAmount         :", ethers.formatUnits(newMax, TOKEN_DECIMALS), "USDT");
  console.log("  maxExposurePerNumber :", ethers.formatUnits(newExp, TOKEN_DECIMALS), "USDT");

  const ok =
    newMin.toString() === MIN_BET.toString() &&
    newMax.toString() === MAX_BET.toString() &&
    newExp.toString() === MAX_EXPOSURE.toString();

  if (!ok) {
    console.error("\nWARN: los valores leídos no coinciden con los enviados. Verificar manualmente.");
    process.exit(1);
  }

  console.log("\n✓ Límites actualizados correctamente.");
  console.log(`  El frontend leerá maxExposurePerNumber() y mostrará ${expUsdt.toFixed(6)} USDT como límite por número.`);
  console.log(`  El contrato rechazará (ExposureLimitExceeded) apuestas acumuladas > ${expUsdt.toFixed(6)} USDT por número por sorteo.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nFatal error:", err.message);
    if (err.data) console.error("Revert data:", err.data);
    process.exit(1);
  });
