const { ethers } = require("hardhat");
const { setupPayoutTable } = require("./setup-payout-table");

async function main() {
  const [owner, player, operator] = await ethers.getSigners();

  console.log("=== DEPLOY LOCAL ===");
  console.log("Owner:", owner.address);
  console.log("Player:", player.address);
  console.log("Operator:", operator.address);

  // 1. Deploy MockERC20 (USDT)
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdt = await MockERC20.deploy("Mock USDT", "USDT", 6);
  await usdt.waitForDeployment();
  console.log("\nUSDT deployed:", await usdt.getAddress());

  // 2. Deploy MockVRFCoordinator
  const MockVRF = await ethers.getContractFactory("MockVRFCoordinator");
  const vrf = await MockVRF.deploy();
  await vrf.waitForDeployment();
  console.log("VRF Coordinator deployed:", await vrf.getAddress());

  // 3. Deploy KenoGame
  const KenoGame = await ethers.getContractFactory("KenoGame");
  const keno = await KenoGame.deploy(
    await usdt.getAddress(),
    await vrf.getAddress(),
    1, // vrfSubId
    ethers.keccak256(ethers.toUtf8Bytes("local-key-hash")),
    operator.address
  );
  await keno.waitForDeployment();
  console.log("KenoGame deployed:", await keno.getAddress());

  // 4. Setup payout table
  await setupPayoutTable(keno);

  // 5. Fund pool (owner mints 10,000 USDT and deposits)
  const poolAmount = ethers.parseUnits("10000", 6);
  await usdt.mint(owner.address, poolAmount);
  await usdt.approve(await keno.getAddress(), poolAmount);
  await keno.fundPool(poolAmount);
  console.log("\nPool funded:", ethers.formatUnits(await keno.availablePool(), 6), "USDT");

  // 6. Give player 100 USDT
  const playerAmount = ethers.parseUnits("100", 6);
  await usdt.mint(player.address, playerAmount);
  await usdt.connect(player).approve(await keno.getAddress(), ethers.MaxUint256);
  console.log("Player balance:", ethers.formatUnits(await usdt.balanceOf(player.address), 6), "USDT");

  // 7. Play a round!
  console.log("\n=== PLAYING KENO ===");
  const selectedNumbers = [7, 14, 21, 35, 42];
  console.log("Player picks:", selectedNumbers);

  const placeTx = await keno.connect(player).placeBet(selectedNumbers);
  const placeReceipt = await placeTx.wait();

  // Extract BetPlaced event
  let betId, vrfRequestId;
  for (const log of placeReceipt.logs) {
    try {
      const parsed = keno.interface.parseLog({ topics: log.topics, data: log.data });
      if (parsed && parsed.name === "BetPlaced") {
        betId = parsed.args.betId;
        vrfRequestId = parsed.args.vrfRequestId;
      }
    } catch (_) {}
  }
  console.log("Bet placed! betId:", betId.toString(), "vrfRequestId:", vrfRequestId.toString());
  console.log("Player balance after bet:", ethers.formatUnits(await usdt.balanceOf(player.address), 6), "USDT");

  // 8. Simulate VRF fulfillment (mock coordinator)
  const randomWord = ethers.toBigInt(ethers.randomBytes(32));
  console.log("\nFulfilling VRF with random word...");
  const fulfillTx = await vrf.fulfillRandomWords(vrfRequestId, [randomWord]);
  const fulfillReceipt = await fulfillTx.wait();

  // Extract BetResolved event
  for (const log of fulfillReceipt.logs) {
    try {
      const parsed = keno.interface.parseLog({ topics: log.topics, data: log.data });
      if (parsed && parsed.name === "BetResolved") {
        const hits = parsed.args.hits;
        const payout = parsed.args.payout;
        const paid = parsed.args.paid;
        console.log(`Result: ${hits} hits, payout: ${ethers.formatUnits(payout, 6)} USDT, paid: ${paid}`);
      }
      if (parsed && parsed.name === "BetUnpaid") {
        console.log("BetUnpaid! payoutNeeded:", ethers.formatUnits(parsed.args.payoutNeeded, 6));
      }
      if (parsed && parsed.name === "FeesAccrued") {
        console.log("Fee accrued:", ethers.formatUnits(parsed.args.feeAmount, 6), "USDT");
      }
    } catch (_) {}
  }

  // Final state
  const bet = await keno.bets(betId);
  const statusNames = ["PENDING", "PAID", "UNPAID"];
  console.log("\n=== FINAL STATE ===");
  console.log("Bet status:", statusNames[Number(bet.status)]);
  console.log("Bet payout:", ethers.formatUnits(bet.payout, 6), "USDT");
  console.log("Player balance:", ethers.formatUnits(await usdt.balanceOf(player.address), 6), "USDT");
  console.log("Pool available:", ethers.formatUnits(await keno.availablePool(), 6), "USDT");
  console.log("Accrued fees:", ethers.formatUnits(await keno.accruedFees(), 6), "USDT");

  // Print addresses for manual interaction
  console.log("\n=== ADDRESSES (for hardhat console) ===");
  console.log(`const USDT = "${await usdt.getAddress()}";`);
  console.log(`const VRF = "${await vrf.getAddress()}";`);
  console.log(`const KENO = "${await keno.getAddress()}";`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
