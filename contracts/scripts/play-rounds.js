const { ethers } = require("hardhat");
const { setupPayoutTable } = require("./setup-payout-table");

// Play N rounds of Keno and show stats
async function main() {
  const ROUNDS = 20;
  const [owner, player, operator] = await ethers.getSigners();

  // Deploy everything
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdt = await MockERC20.deploy("Mock USDT", "USDT", 6);

  const MockVRF = await ethers.getContractFactory("MockVRFCoordinator");
  const vrf = await MockVRF.deploy();

  const KenoGame = await ethers.getContractFactory("KenoGame");
  const keno = await KenoGame.deploy(
    await usdt.getAddress(),
    await vrf.getAddress(),
    1,
    ethers.keccak256(ethers.toUtf8Bytes("local")),
    operator.address
  );

  await setupPayoutTable(keno);

  // Fund pool and player
  const poolAmount = ethers.parseUnits("10000", 6);
  await usdt.mint(owner.address, poolAmount);
  await usdt.approve(await keno.getAddress(), poolAmount);
  await keno.fundPool(poolAmount);

  await usdt.mint(player.address, ethers.parseUnits("1000", 6));
  await usdt.connect(player).approve(await keno.getAddress(), ethers.MaxUint256);

  console.log("=== KENO SIMULATION: " + ROUNDS + " rounds ===\n");
  console.log("Pick | Numbers              | Hits | Multiplier | Payout  | Status");
  console.log("-----|----------------------|------|------------|---------|-------");

  let totalBet = 0n;
  let totalPayout = 0n;
  let wins = 0;

  for (let i = 0; i < ROUNDS; i++) {
    // Random pick count 1-5
    const spots = Math.floor(Math.random() * 5) + 1;
    const numbers = [];
    const used = new Set();
    while (numbers.length < spots) {
      const n = Math.floor(Math.random() * 80) + 1;
      if (!used.has(n)) {
        used.add(n);
        numbers.push(n);
      }
    }
    numbers.sort((a, b) => a - b);

    // Place bet
    const tx = await keno.connect(player).placeBet(numbers);
    const receipt = await tx.wait();

    let vrfRequestId;
    for (const log of receipt.logs) {
      try {
        const parsed = keno.interface.parseLog({ topics: log.topics, data: log.data });
        if (parsed?.name === "BetPlaced") vrfRequestId = parsed.args.vrfRequestId;
      } catch (_) {}
    }

    // Fulfill VRF
    const word = ethers.toBigInt(ethers.randomBytes(32));
    await vrf.fulfillRandomWords(vrfRequestId, [word]);

    const bet = await keno.bets(i + 1);
    const payout = bet.payout;
    const statusNames = ["PENDING", "PAID", "UNPAID"];

    totalBet += bet.amount;
    totalPayout += payout;
    if (payout > 0n) wins++;

    // Get multiplier
    const mult = bet.amount > 0n ? Number(payout * 100n / bet.amount) / 100 : 0;

    const numsStr = numbers.join(",").padEnd(20);
    console.log(
      `  ${spots}  | ${numsStr} | ${String(bet.hits).padStart(4)} | ${String(mult + "x").padStart(10)} | ${ethers.formatUnits(payout, 6).padStart(7)} | ${statusNames[Number(bet.status)]}`
    );
  }

  console.log("\n=== STATS ===");
  console.log("Rounds:", ROUNDS);
  console.log("Wins:", wins, "/", ROUNDS, `(${((wins / ROUNDS) * 100).toFixed(1)}%)`);
  console.log("Total bet:", ethers.formatUnits(totalBet, 6), "USDT");
  console.log("Total payout:", ethers.formatUnits(totalPayout, 6), "USDT");
  console.log("Net result:", ethers.formatUnits(totalPayout - totalBet, 6), "USDT");
  console.log("House edge:", ((1 - Number(totalPayout) / Number(totalBet)) * 100).toFixed(2) + "%");
  console.log("Pool:", ethers.formatUnits(await keno.availablePool(), 6), "USDT");
  console.log("Fees accrued:", ethers.formatUnits(await keno.accruedFees(), 6), "USDT");
  console.log("Player balance:", ethers.formatUnits(await usdt.balanceOf(player.address), 6), "USDT");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
