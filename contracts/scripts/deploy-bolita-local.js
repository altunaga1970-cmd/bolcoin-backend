const { ethers } = require("hardhat");

async function main() {
  const [owner, player] = await ethers.getSigners();

  console.log("=== DEPLOY LaBolitaGame LOCAL ===");
  console.log("Owner:", owner.address);
  console.log("Player:", player.address);

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

  // 3. Deploy LaBolitaGame
  const LaBolitaGame = await ethers.getContractFactory("LaBolitaGame");
  const bolita = await LaBolitaGame.deploy(
    await usdt.getAddress(),
    await vrf.getAddress(),
    1, // vrfSubId
    ethers.keccak256(ethers.toUtf8Bytes("local-key-hash"))
  );
  await bolita.waitForDeployment();
  console.log("LaBolitaGame deployed:", await bolita.getAddress());

  // 4. Fund pool: owner mints 50,000 USDT and deposits
  const poolAmount = ethers.parseUnits("50000", 6);
  await usdt.mint(owner.address, poolAmount);
  await usdt.approve(await bolita.getAddress(), poolAmount);
  await bolita.fundPool(poolAmount);
  console.log("\nPool funded:", ethers.formatUnits(await bolita.availablePool(), 6), "USDT");

  // 5. Give player 10,000 USDT and approve
  const playerAmount = ethers.parseUnits("10000", 6);
  await usdt.mint(player.address, playerAmount);
  await usdt.connect(player).approve(await bolita.getAddress(), ethers.MaxUint256);
  console.log("Player balance:", ethers.formatUnits(await usdt.balanceOf(player.address), 6), "USDT");

  // 6. Progressive limits are built-in. Just log the dynamic limit.
  const dynLimit = await bolita.currentLimitPerNumber();
  const [minB, maxB, maxPN, pool] = await bolita.getLimits();
  console.log(`Progressive limit per number: ${ethers.formatUnits(dynLimit, 6)} USDT (pool=${ethers.formatUnits(pool, 6)})`);
  console.log(`Bet limits: ${ethers.formatUnits(minB, 6)} - ${ethers.formatUnits(maxB, 6)} USDT`);

  // 7. Create and open a test draw
  const scheduledTime = Math.floor(Date.now() / 1000) + 7200; // 2 hours from now
  const createTx = await bolita.createDraw("BOLITA-001", scheduledTime);
  const createReceipt = await createTx.wait();

  let drawId;
  for (const log of createReceipt.logs) {
    try {
      const parsed = bolita.interface.parseLog({ topics: log.topics, data: log.data });
      if (parsed && parsed.name === "DrawCreated") {
        drawId = parsed.args.drawId;
        break;
      }
    } catch (_) {}
  }
  await bolita.openDraw(drawId);
  console.log("\nDraw created and opened! drawId:", drawId.toString());

  // 8. Demo: place a bet
  console.log("\n=== DEMO BET ===");
  const betAmount = ethers.parseUnits("1", 6);
  const betTx = await bolita.connect(player).placeBet(drawId, 0, 42, betAmount); // FIJO 42
  const betReceipt = await betTx.wait();

  let betIndex;
  for (const log of betReceipt.logs) {
    try {
      const parsed = bolita.interface.parseLog({ topics: log.topics, data: log.data });
      if (parsed && parsed.name === "BetPlaced") {
        betIndex = parsed.args.betIndex;
      }
    } catch (_) {}
  }
  console.log("Bet placed! Fijo 42, 1 USDT, betIndex:", betIndex.toString());
  console.log("Player balance after bet:", ethers.formatUnits(await usdt.balanceOf(player.address), 6), "USDT");

  // 9. Close draw, request VRF, fulfill, resolve
  await bolita.closeDraw(drawId);
  await bolita.requestDrawResult(drawId);

  // Fulfill VRF with number that makes fijo=42 (e.g. 1342 % 100 = 42)
  const fulfillTx = await vrf.fulfillRandomWords(1, [BigInt(1342)]);
  await fulfillTx.wait();

  const infoAfterVrf = await bolita.getDrawInfo(drawId);
  console.log("\nWinning number:", Number(infoAfterVrf.winningNumber), "(fijo:", Number(infoAfterVrf.winningNumber) % 100, ")");

  // Resolve
  const resolveTx = await bolita.resolveDrawBatch(drawId, 100);
  await resolveTx.wait();

  const bet = await bolita.getDrawBet(drawId, 0);
  const statusNames = ["PENDING", "PAID", "UNPAID", "REFUNDED"];
  console.log("Bet status:", statusNames[Number(bet.status)]);
  console.log("Bet payout:", ethers.formatUnits(bet.payout, 6), "USDT");
  console.log("Player balance after resolve:", ethers.formatUnits(await usdt.balanceOf(player.address), 6), "USDT");
  console.log("Pool available:", ethers.formatUnits(await bolita.availablePool(), 6), "USDT");

  // 10. Create a NEW open draw for the frontend to use
  const scheduledTime2 = Math.floor(Date.now() / 1000) + 14400; // 4 hours from now
  const createTx2 = await bolita.createDraw("BOLITA-002", scheduledTime2);
  const createReceipt2 = await createTx2.wait();

  let drawId2;
  for (const log of createReceipt2.logs) {
    try {
      const parsed = bolita.interface.parseLog({ topics: log.topics, data: log.data });
      if (parsed && parsed.name === "DrawCreated") {
        drawId2 = parsed.args.drawId;
        break;
      }
    } catch (_) {}
  }
  await bolita.openDraw(drawId2);
  console.log("\nNew draw created for frontend! drawId:", drawId2.toString(), "- BOLITA-002");

  // Print addresses for .env configuration
  console.log("\n=== ADDRESSES ===");
  console.log(`USDT:          ${await usdt.getAddress()}`);
  console.log(`VRF:           ${await vrf.getAddress()}`);
  console.log(`LaBolitaGame:  ${await bolita.getAddress()}`);
  console.log("\n=== ADD TO .env ===");
  console.log(`VITE_BOLITA_CONTRACT_ADDRESS=${await bolita.getAddress()}`);
  console.log(`VITE_BOLITA_MODE=onchain`);
  console.log(`VITE_TOKEN_ADDRESS=${await usdt.getAddress()}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
