const { ethers } = require("hardhat");

// Standard Keno payout table (1e2 scaled: 300 = 3.00x)
const PAYOUT_TABLE = {
  1:  [0, 300],                                          // pick 1: 0 hits=0x, 1 hit=3x
  2:  [0, 100, 900],                                     // pick 2: 0=0, 1=1x, 2=9x
  3:  [0, 0, 200, 2700],                                 // pick 3
  4:  [0, 0, 100, 500, 7500],                             // pick 4
  5:  [0, 0, 0, 300, 1200, 30000],                        // pick 5
  6:  [0, 0, 0, 200, 500, 5000, 100000],                  // pick 6
  7:  [0, 0, 0, 100, 300, 2000, 10000, 200000],           // pick 7
  8:  [0, 0, 0, 0, 200, 1000, 5000, 50000, 500000],       // pick 8
  9:  [0, 0, 0, 0, 100, 500, 2500, 20000, 200000, 750000], // pick 9
  10: [0, 0, 0, 0, 0, 300, 1500, 10000, 100000, 500000, 1000000], // pick 10
};

async function setupPayoutTable(keno) {
  for (let spots = 1; spots <= 10; spots++) {
    const mults = PAYOUT_TABLE[spots].map(m => m);
    await keno.updatePayoutRow(spots, mults);
  }
  await keno.commitPayoutUpdate();
}

async function deployFixture() {
  const [owner, player, player2, operatorSigner] = await ethers.getSigners();

  // Deploy MockERC20 (USDT 6 decimals)
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdt = await MockERC20.deploy("Mock USDT", "USDT", 6);

  // Deploy MockVRFCoordinator
  const MockVRF = await ethers.getContractFactory("MockVRFCoordinator");
  const vrfCoordinator = await MockVRF.deploy();

  // Deploy KenoGame
  const vrfSubId = 1;
  const vrfKeyHash = ethers.keccak256(ethers.toUtf8Bytes("test-key-hash"));
  const KenoGame = await ethers.getContractFactory("KenoGame");
  const keno = await KenoGame.deploy(
    await usdt.getAddress(),
    await vrfCoordinator.getAddress(),
    vrfSubId,
    vrfKeyHash,
    operatorSigner.address
  );

  // Setup payout table
  await setupPayoutTable(keno);

  // Fund pool: owner mints and deposits 10,000 USDT
  const poolFund = ethers.parseUnits("10000", 6);
  await usdt.mint(owner.address, poolFund);
  await usdt.approve(await keno.getAddress(), poolFund);
  await keno.fundPool(poolFund);

  // Give player 100 USDT
  const playerFund = ethers.parseUnits("100", 6);
  await usdt.mint(player.address, playerFund);
  await usdt.connect(player).approve(await keno.getAddress(), playerFund);

  // Give player2 100 USDT
  await usdt.mint(player2.address, playerFund);
  await usdt.connect(player2).approve(await keno.getAddress(), playerFund);

  return { keno, usdt, vrfCoordinator, owner, player, player2, operatorSigner, vrfSubId, vrfKeyHash };
}

// Helper: place bet and get betId + vrfRequestId from event
async function placeBetAndGetIds(keno, player, selectedNumbers) {
  const tx = await keno.connect(player).placeBet(selectedNumbers);
  const receipt = await tx.wait();

  // Parse BetPlaced event
  const iface = keno.interface;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics, data: log.data });
      if (parsed && parsed.name === "BetPlaced") {
        return {
          betId: parsed.args.betId,
          vrfRequestId: parsed.args.vrfRequestId,
          tx,
          receipt,
        };
      }
    } catch (_) {}
  }
  throw new Error("BetPlaced event not found");
}

// Helper: generate a random word that produces specific drawn numbers
// This is non-trivial because the draw algorithm is deterministic from the word.
// For tests, we just use any random word and check the results.
function randomWord() {
  return ethers.toBigInt(ethers.randomBytes(32));
}

module.exports = {
  PAYOUT_TABLE,
  setupPayoutTable,
  deployFixture,
  placeBetAndGetIds,
  randomWord,
};
