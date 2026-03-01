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
  //   Si el pool es 0 (no financiado), usar fallback de MIN_BET
  let brmExposure;
  if (curPool === 0n) {
    console.warn("\n  WARN: pool = 0. Usando MIN_BET como fallback de exposición.");
    brmExposure = MIN_BET;
  } else {
    brmExposure = (curPool * RISK_PCT_NUM) / (RISK_PCT_DEN * PARLE_MULTIPLIER);
    if (brmExposure === 0n) brmExposure = 1n;
  }

  // Allow env override
  let MAX_EXPOSURE = process.env.MAX_EXPOSURE
    ? ethers.parseUnits(process.env.MAX_EXPOSURE, TOKEN_DECIMALS)
    : brmExposure;

  // Contract requires: minBet <= maxBet AND minBet <= maxExposure.
  // If the BRM-computed limit is below minBet, clamp it up and warn.
  // This happens when the pool is too small relative to the min bet size.
  if (MAX_EXPOSURE < MIN_BET) {
    const requiredPool = (MIN_BET * PARLE_MULTIPLIER * RISK_PCT_DEN) / RISK_PCT_NUM;
    console.warn(`\n  ⚠️  ADVERTENCIA BRM: pool insuficiente para los límites actuales.`);
    console.warn(`     BRM calcula exposure = ${ethers.formatUnits(MAX_EXPOSURE, TOKEN_DECIMALS)} USDT < minBet = ${ethers.formatUnits(MIN_BET, TOKEN_DECIMALS)} USDT.`);
    console.warn(`     Para BRM estricto con minBet=${ethers.formatUnits(MIN_BET, TOKEN_DECIMALS)} necesitas pool ≥ ${ethers.formatUnits(requiredPool, TOKEN_DECIMALS)} USDT.`);
    console.warn(`     Usando minBet (${ethers.formatUnits(MIN_BET, TOKEN_DECIMALS)} USDT) como exposure mínima aceptable.`);
    console.warn(`     → Recomienda: fondeá el pool (fund-bolita-amoy.js) antes de abrir a producción.`);
    MAX_EXPOSURE = MIN_BET;
  }

  // maxBetAmount must be strictly > minBetAmount (contract invariant).
  // Set it to max(MAX_EXPOSURE, MIN_BET) + 1 μUSDT so the single-bet ceiling
  // is just above the minimum while the exposure limit enforces the real cap.
  let MAX_BET;
  if (process.env.MAX_BET) {
    MAX_BET = ethers.parseUnits(process.env.MAX_BET, TOKEN_DECIMALS);
  } else {
    // maxBet = exposure limit, but must be > minBet
    MAX_BET = MAX_EXPOSURE <= MIN_BET ? MIN_BET + 1n : MAX_EXPOSURE;
  }

  const poolUsdt = Number(ethers.formatUnits(curPool, TOKEN_DECIMALS));
  const expUsdt  = Number(ethers.formatUnits(MAX_EXPOSURE, TOKEN_DECIMALS));
  const brmPct   = poolUsdt > 0 ? ((expUsdt * 1000 / poolUsdt) * 100) : Infinity;

  console.log("\n[3/4] Análisis BRM:");
  console.log(`  Pool disponible      : ${poolUsdt.toFixed(6)} USDT`);
  console.log(`  Riesgo máximo (30%)  : ${(poolUsdt * 0.30).toFixed(6)} USDT por sorteo`);
  console.log(`  Multiplicador Parle  : 1000x`);
  console.log(`  maxExposurePerNumber : ${expUsdt.toFixed(6)} USDT`);
  console.log(`    → Peor caso Parle  : ${(expUsdt * 1000).toFixed(6)} USDT payout (${brmPct.toFixed(1)}% del pool)`);
  console.log(`    → Peor caso Centena: ${(expUsdt * 300).toFixed(6)} USDT payout (${(expUsdt * 300 / poolUsdt * 100).toFixed(1)}% del pool)`);
  console.log(`    → Peor caso Fijo   : ${(expUsdt * 65).toFixed(6)} USDT payout (${(expUsdt * 65 / poolUsdt * 100).toFixed(1)}% del pool)`);
  if (brmPct > 30) {
    console.warn(`  ⚠️  RIESGO REAL Parle: ${brmPct.toFixed(1)}% del pool (objetivo BRM: 30%). Fondear más para reducirlo.`);
  }
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
