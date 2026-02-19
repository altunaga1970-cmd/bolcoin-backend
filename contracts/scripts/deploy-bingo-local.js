const { ethers } = require("hardhat");

async function main() {
  const [owner, player] = await ethers.getSigners();

  console.log("=== DEPLOY BingoGame LOCAL ===");
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

  // 3. Deploy BingoGame
  const BingoGame = await ethers.getContractFactory("BingoGame");
  const bingo = await BingoGame.deploy(
    await usdt.getAddress(),
    await vrf.getAddress(),
    1, // vrfSubId
    ethers.keccak256(ethers.toUtf8Bytes("local-key-hash")),
    owner.address // operator
  );
  await bingo.waitForDeployment();
  console.log("BingoGame deployed:", await bingo.getAddress());

  // 4. Fund pool: owner mints 50,000 USDT and deposits
  const poolAmount = ethers.parseUnits("50000", 6);
  await usdt.mint(owner.address, poolAmount);
  await usdt.approve(await bingo.getAddress(), poolAmount);
  await bingo.fundPool(poolAmount);
  console.log("\nPool funded:", ethers.formatUnits(await bingo.availablePool(), 6), "USDT");

  // 5. Give player 1,000 USDT and approve
  const playerAmount = ethers.parseUnits("1000", 6);
  await usdt.mint(player.address, playerAmount);
  await usdt.connect(player).approve(await bingo.getAddress(), ethers.MaxUint256);
  console.log("Player balance:", ethers.formatUnits(await usdt.balanceOf(player.address), 6), "USDT");

  // 6. Create a test round (closes in 2 hours)
  const scheduledClose = Math.floor(Date.now() / 1000) + 7200;
  const createTx = await bingo.createRound(scheduledClose);
  const createReceipt = await createTx.wait();

  let roundId;
  for (const log of createReceipt.logs) {
    try {
      const parsed = bingo.interface.parseLog({ topics: log.topics, data: log.data });
      if (parsed && parsed.name === "RoundCreated") {
        roundId = parsed.args.roundId;
        break;
      }
    } catch (_) {}
  }
  console.log("\nRound created! roundId:", roundId.toString());

  // 7. Player buys 2 cards
  const buyTx = await bingo.connect(player).buyCards(roundId, 2);
  const buyReceipt = await buyTx.wait();

  let cardIds = [];
  for (const log of buyReceipt.logs) {
    try {
      const parsed = bingo.interface.parseLog({ topics: log.topics, data: log.data });
      if (parsed && parsed.name === "CardsPurchased") {
        cardIds = parsed.args.cardIds.map(id => id.toString());
        break;
      }
    } catch (_) {}
  }
  console.log("Player bought 2 cards:", cardIds.join(", "));

  // Show card numbers
  for (const cid of cardIds) {
    const nums = await bingo.getCardNumbers(cid);
    console.log(`  Card ${cid}: [${Array.from(nums).join(", ")}]`);
  }

  console.log("\nPlayer balance after purchase:", ethers.formatUnits(await usdt.balanceOf(player.address), 6), "USDT");
  console.log("Jackpot balance:", ethers.formatUnits(await bingo.jackpotBalance(), 6), "USDT");

  // Print env vars
  console.log("\n=== ADDRESSES ===");
  console.log(`USDT:       ${await usdt.getAddress()}`);
  console.log(`VRF:        ${await vrf.getAddress()}`);
  console.log(`BingoGame:  ${await bingo.getAddress()}`);
  console.log("\n=== ADD TO .env ===");
  console.log(`BINGO_CONTRACT_ADDRESS=${await bingo.getAddress()}`);
  console.log(`VITE_TOKEN_ADDRESS=${await usdt.getAddress()}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
