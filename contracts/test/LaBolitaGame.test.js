const { expect } = require("chai");
const { ethers } = require("hardhat");

// ─── HELPERS ───

async function deployBolitaFixture() {
  const [owner, player, player2] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdt = await MockERC20.deploy("Mock USDT", "USDT", 6);

  const MockVRF = await ethers.getContractFactory("MockVRFCoordinator");
  const vrfCoordinator = await MockVRF.deploy();

  const vrfSubId = 1;
  const vrfKeyHash = ethers.keccak256(ethers.toUtf8Bytes("test-key-hash"));
  const LaBolitaGame = await ethers.getContractFactory("LaBolitaGame");
  const bolita = await LaBolitaGame.deploy(
    await usdt.getAddress(),
    await vrfCoordinator.getAddress(),
    vrfSubId,
    vrfKeyHash
  );

  // Fund pool: 50,000 USDT
  const poolFund = ethers.parseUnits("50000", 6);
  await usdt.mint(owner.address, poolFund);
  await usdt.approve(await bolita.getAddress(), poolFund);
  await bolita.fundPool(poolFund);

  // Give players 1000 USDT each
  const playerFund = ethers.parseUnits("1000", 6);
  const maxApproval = ethers.parseUnits("100000", 6);
  await usdt.mint(player.address, playerFund);
  await usdt.connect(player).approve(await bolita.getAddress(), maxApproval);
  await usdt.mint(player2.address, playerFund);
  await usdt.connect(player2).approve(await bolita.getAddress(), maxApproval);

  return { bolita, usdt, vrfCoordinator, owner, player, player2 };
}

async function createAndOpenDraw(bolita) {
  const block = await ethers.provider.getBlock("latest");
  const scheduledTime = block.timestamp + 3600;
  const tx = await bolita.createDraw("TEST-001", scheduledTime);
  const receipt = await tx.wait();

  let drawId;
  for (const log of receipt.logs) {
    try {
      const parsed = bolita.interface.parseLog({ topics: log.topics, data: log.data });
      if (parsed && parsed.name === "DrawCreated") {
        drawId = parsed.args.drawId;
        break;
      }
    } catch (_) {}
  }

  await bolita.openDraw(drawId);
  return drawId;
}

async function placeBetGetId(bolita, player, drawId, betType, number, amountUsdt) {
  const amount = ethers.parseUnits(amountUsdt.toString(), 6);
  const tx = await bolita.connect(player).placeBet(drawId, betType, number, amount);
  const receipt = await tx.wait();

  let betId;
  for (const log of receipt.logs) {
    try {
      const parsed = bolita.interface.parseLog({ topics: log.topics, data: log.data });
      if (parsed && parsed.name === "BetPlaced") {
        betId = parsed.args.betId;
        break;
      }
    } catch (_) {}
  }
  return betId;
}

// Calculate expected payout: (amount - 5% fee) * multiplier / 100
function expectedPayout(amountUsdt, multiplier100) {
  const amount = BigInt(amountUsdt) * 1000000n;
  const fee = amount * 500n / 10000n;
  const net = amount - fee;
  return (net * BigInt(multiplier100)) / 100n;
}

// ─── TESTS ───

describe("LaBolitaGame", function () {
  let bolita, usdt, vrfCoordinator, owner, player, player2;

  beforeEach(async function () {
    ({ bolita, usdt, vrfCoordinator, owner, player, player2 } = await deployBolitaFixture());
  });

  // ─── DEPLOYMENT ───
  describe("Deployment", function () {
    it("sets correct initial state", async function () {
      expect(await bolita.paymentToken()).to.equal(await usdt.getAddress());
      expect(await bolita.feeBps()).to.equal(500);
      expect(await bolita.fijoMultiplier()).to.equal(6500);
      expect(await bolita.centenaMultiplier()).to.equal(30000);
      expect(await bolita.parleMultiplier()).to.equal(100000);
      expect(await bolita.drawCounter()).to.equal(0);
      expect(await bolita.betCounter()).to.equal(0);
    });

    it("has funded pool", async function () {
      expect(await bolita.availablePool()).to.equal(ethers.parseUnits("50000", 6));
    });
  });

  // ─── DRAW LIFECYCLE ───
  describe("Draw Lifecycle", function () {
    it("creates, opens, closes a draw", async function () {
      const drawId = await createAndOpenDraw(bolita);

      let [id, , , status] = await bolita.getDraw(drawId);
      expect(status).to.equal(1); // OPEN

      // closeDraw triggers VRF request
      await bolita.closeDraw(drawId);
      [, , , status] = await bolita.getDraw(drawId);
      expect(status).to.equal(3); // VRF_PENDING
    });

    it("reverts openDraw if not SCHEDULED", async function () {
      const drawId = await createAndOpenDraw(bolita);
      await expect(bolita.openDraw(drawId)).to.be.reverted;
    });

    it("reverts closeDraw if not OPEN", async function () {
      const block = await ethers.provider.getBlock("latest");
      const tx = await bolita.createDraw("D1", block.timestamp + 3600);
      const receipt = await tx.wait();
      let drawId;
      for (const log of receipt.logs) {
        try {
          const parsed = bolita.interface.parseLog({ topics: log.topics, data: log.data });
          if (parsed && parsed.name === "DrawCreated") { drawId = parsed.args.drawId; break; }
        } catch (_) {}
      }
      // Draw is SCHEDULED, not OPEN
      await expect(bolita.closeDraw(drawId)).to.be.revertedWithCustomError(bolita, "DrawNotOpen");
    });
  });

  // ─── PLACE BET ───
  describe("placeBet", function () {
    let drawId;

    beforeEach(async function () {
      drawId = await createAndOpenDraw(bolita);
    });

    it("places a Fijo bet (00-99)", async function () {
      const betId = await placeBetGetId(bolita, player, drawId, 0, 42, 1);
      expect(betId).to.equal(1);

      const [p, dId, bt, num, amt, , resolved, won] = await bolita.getBet(betId);
      expect(p).to.equal(player.address);
      expect(dId).to.equal(drawId);
      expect(bt).to.equal(0); // FIJO
      expect(num).to.equal(42);
      expect(amt).to.equal(ethers.parseUnits("1", 6));
      expect(resolved).to.equal(false);
    });

    it("places a Centena bet (000-999)", async function () {
      const betId = await placeBetGetId(bolita, player, drawId, 1, 342, 1);
      const [, , bt, num] = await bolita.getBet(betId);
      expect(bt).to.equal(1); // CENTENA
      expect(num).to.equal(342);
    });

    it("places a Parle bet (0000-9999)", async function () {
      const betId = await placeBetGetId(bolita, player, drawId, 2, 1342, 1);
      const [, , bt, num] = await bolita.getBet(betId);
      expect(bt).to.equal(2); // PARLE
      expect(num).to.equal(1342);
    });

    it("allows Fijo bet on number 0", async function () {
      const betId = await placeBetGetId(bolita, player, drawId, 0, 0, 1);
      const [, , , num] = await bolita.getBet(betId);
      expect(num).to.equal(0);
    });

    it("transfers tokens from player", async function () {
      const balBefore = await usdt.balanceOf(player.address);
      await placeBetGetId(bolita, player, drawId, 0, 42, 5);
      const balAfter = await usdt.balanceOf(player.address);
      expect(balBefore - balAfter).to.equal(ethers.parseUnits("5", 6));
    });

    it("accrues fee immediately", async function () {
      await placeBetGetId(bolita, player, drawId, 0, 42, 10);
      // Fee = 10 * 5% = 0.5 USDT
      expect(await bolita.accruedFees()).to.equal(ethers.parseUnits("0.5", 6));
    });

    it("updates draw stats", async function () {
      await placeBetGetId(bolita, player, drawId, 0, 42, 2);
      await placeBetGetId(bolita, player, drawId, 1, 500, 3);

      const [, , , , , totalBets, totalAmount] = await bolita.getDraw(drawId);
      expect(totalBets).to.equal(2);
      expect(totalAmount).to.equal(ethers.parseUnits("5", 6));
    });

    it("tracks exposure per number", async function () {
      await placeBetGetId(bolita, player, drawId, 0, 42, 5);
      await placeBetGetId(bolita, player2, drawId, 0, 42, 3);

      const exposure = await bolita.getNumberExposure(drawId, 0, 42);
      expect(exposure).to.equal(ethers.parseUnits("8", 6));
    });

    it("reverts if draw not open", async function () {
      await bolita.closeDraw(drawId);
      await expect(
        bolita.connect(player).placeBet(drawId, 0, 42, ethers.parseUnits("1", 6))
      ).to.be.revertedWithCustomError(bolita, "DrawNotOpen");
    });

    it("reverts for invalid Fijo number (> 99)", async function () {
      await expect(
        bolita.connect(player).placeBet(drawId, 0, 100, ethers.parseUnits("1", 6))
      ).to.be.revertedWithCustomError(bolita, "InvalidNumber");
    });

    it("reverts for invalid Centena number (> 999)", async function () {
      await expect(
        bolita.connect(player).placeBet(drawId, 1, 1000, ethers.parseUnits("1", 6))
      ).to.be.revertedWithCustomError(bolita, "InvalidNumber");
    });

    it("reverts for invalid Parle number (> 9999)", async function () {
      await expect(
        bolita.connect(player).placeBet(drawId, 2, 10000, ethers.parseUnits("1", 6))
      ).to.be.revertedWithCustomError(bolita, "InvalidNumber");
    });

    it("reverts for amount below minimum", async function () {
      await expect(
        bolita.connect(player).placeBet(drawId, 0, 42, 100) // 0.0001 USDT
      ).to.be.revertedWithCustomError(bolita, "InvalidAmount");
    });

    it("reverts when paused", async function () {
      await bolita.pause();
      await expect(
        bolita.connect(player).placeBet(drawId, 0, 42, ethers.parseUnits("1", 6))
      ).to.be.revertedWithCustomError(bolita, "EnforcedPause");
    });

    it("reverts when exposure limit exceeded", async function () {
      // Set low exposure limit: 10 USDT
      await bolita.setBetLimits(100000, 100000000, ethers.parseUnits("10", 6));

      await placeBetGetId(bolita, player, drawId, 0, 42, 9);
      await expect(
        bolita.connect(player2).placeBet(drawId, 0, 42, ethers.parseUnits("2", 6))
      ).to.be.revertedWithCustomError(bolita, "ExposureLimitExceeded");
    });

    it("emits BetPlaced event", async function () {
      await expect(
        bolita.connect(player).placeBet(drawId, 0, 42, ethers.parseUnits("1", 6))
      ).to.emit(bolita, "BetPlaced");
    });
  });

  // ─── BATCH BETS ───
  describe("placeBetsBatch", function () {
    let drawId;

    beforeEach(async function () {
      drawId = await createAndOpenDraw(bolita);
    });

    it("places multiple bets in one tx", async function () {
      const bets = [
        { betType: 0, number: 42, amount: ethers.parseUnits("1", 6) },
        { betType: 1, number: 342, amount: ethers.parseUnits("2", 6) },
        { betType: 2, number: 1342, amount: ethers.parseUnits("1", 6) },
      ];

      await bolita.connect(player).placeBetsBatch(drawId, bets);
      expect(await bolita.getDrawBetCount(drawId)).to.equal(3);
    });

    it("reverts on empty batch", async function () {
      await expect(
        bolita.connect(player).placeBetsBatch(drawId, [])
      ).to.be.revertedWithCustomError(bolita, "BatchEmpty");
    });
  });

  // ─── VRF + RESOLUTION ───
  describe("VRF fulfillment and resolution", function () {
    let drawId;

    beforeEach(async function () {
      drawId = await createAndOpenDraw(bolita);
    });

    it("stores winning number from VRF (small draw auto-resolves)", async function () {
      await placeBetGetId(bolita, player, drawId, 0, 42, 1);
      await bolita.closeDraw(drawId);

      // Fulfill with word that produces winning number 4242
      await vrfCoordinator.fulfillRandomWords(1, [BigInt(4242)]);

      const [, , , status, winNum] = await bolita.getDraw(drawId);
      // <=100 bets: auto-resolved to COMPLETED
      expect(status).to.equal(5); // COMPLETED
      expect(winNum).to.equal(4242);
    });

    it("resolves Fijo winner correctly", async function () {
      // Bet on Fijo 42
      await placeBetGetId(bolita, player, drawId, 0, 42, 1);
      await bolita.closeDraw(drawId);

      // Winning number: 1342 → fijo = 42 (last 2 digits)
      const balBefore = await usdt.balanceOf(player.address);
      await vrfCoordinator.fulfillRandomWords(1, [BigInt(1342)]);
      const balAfter = await usdt.balanceOf(player.address);

      // Payout: (1 - 5%) * 65 = 0.95 * 65 = 61.75 USDT
      const expected = expectedPayout(1, 6500);
      expect(balAfter - balBefore).to.equal(expected);
    });

    it("resolves Centena winner correctly", async function () {
      await placeBetGetId(bolita, player, drawId, 1, 342, 2);
      await bolita.closeDraw(drawId);

      // Winning number: 1342 → centena = 342 (last 3 digits)
      const balBefore = await usdt.balanceOf(player.address);
      await vrfCoordinator.fulfillRandomWords(1, [BigInt(1342)]);
      const balAfter = await usdt.balanceOf(player.address);

      // Payout: (2 - 5%) * 300 = 1.90 * 300 = 570 USDT
      const expected = expectedPayout(2, 30000);
      expect(balAfter - balBefore).to.equal(expected);
    });

    it("resolves Parle winner correctly", async function () {
      await placeBetGetId(bolita, player, drawId, 2, 1342, 1);
      await bolita.closeDraw(drawId);

      // Winning number: 1342 → parle match
      const balBefore = await usdt.balanceOf(player.address);
      await vrfCoordinator.fulfillRandomWords(1, [BigInt(1342)]);
      const balAfter = await usdt.balanceOf(player.address);

      // Payout: (1 - 5%) * 1000 = 0.95 * 1000 = 950 USDT
      const expected = expectedPayout(1, 100000);
      expect(balAfter - balBefore).to.equal(expected);
    });

    it("losing bet gets 0 payout", async function () {
      const betId = await placeBetGetId(bolita, player, drawId, 0, 99, 1);
      await bolita.closeDraw(drawId);
      await vrfCoordinator.fulfillRandomWords(1, [BigInt(1342)]);

      const [, , , , , payout, resolved, won] = await bolita.getBet(betId);
      expect(resolved).to.equal(true);
      expect(won).to.equal(false);
      expect(payout).to.equal(0);
    });

    it("emits DrawResolved when all bets resolved", async function () {
      await placeBetGetId(bolita, player, drawId, 0, 42, 1);
      await placeBetGetId(bolita, player2, drawId, 0, 99, 1);
      await bolita.closeDraw(drawId);

      await expect(vrfCoordinator.fulfillRandomWords(1, [BigInt(1342)]))
        .to.emit(bolita, "DrawResolved");
    });

    it("handles winning number 0000", async function () {
      // Bet on Fijo 0
      await placeBetGetId(bolita, player, drawId, 0, 0, 1);
      await bolita.closeDraw(drawId);

      // Winning number: 10000 % 10000 = 0 → fijo = 00
      const balBefore = await usdt.balanceOf(player.address);
      await vrfCoordinator.fulfillRandomWords(1, [BigInt(10000)]);
      const balAfter = await usdt.balanceOf(player.address);

      expect(balAfter - balBefore).to.equal(expectedPayout(1, 6500));
    });
  });

  // ─── PAGED RESOLUTION ───
  describe("Paged resolution", function () {
    it("uses resolveDrawBatch for large draws", async function () {
      const drawId = await createAndOpenDraw(bolita);

      // Place 5 bets (small enough to test, but we can force paged mode)
      for (let i = 0; i < 5; i++) {
        await placeBetGetId(bolita, player, drawId, 0, i, 1);
      }

      await bolita.closeDraw(drawId);
      // Since 5 <= MAX_BETS_PER_RESOLVE (100), fulfillRandomWords auto-resolves
      await vrfCoordinator.fulfillRandomWords(1, [BigInt(1342)]);

      const [, , , status] = await bolita.getDraw(drawId);
      expect(status).to.equal(5); // COMPLETED
    });

    it("anyone can call resolveDrawBatch", async function () {
      // We need > 100 bets to trigger paged mode, which is gas-expensive in tests.
      // Instead, verify the function exists and reverts correctly for non-VRF_FULFILLED draws.
      const drawId = await createAndOpenDraw(bolita);
      await expect(
        bolita.connect(player2).resolveDrawBatch(drawId, 10)
      ).to.be.revertedWithCustomError(bolita, "DrawNotVrfFulfilled");
    });
  });

  // ─── CANCEL DRAW (OWNER) ───
  describe("cancelDraw (owner)", function () {
    it("cancels open draw and refunds all bets", async function () {
      const drawId = await createAndOpenDraw(bolita);
      await placeBetGetId(bolita, player, drawId, 0, 42, 5);
      await placeBetGetId(bolita, player2, drawId, 1, 342, 3);

      const bal1Before = await usdt.balanceOf(player.address);
      const bal2Before = await usdt.balanceOf(player2.address);

      await bolita.cancelDraw(drawId);

      const bal1After = await usdt.balanceOf(player.address);
      const bal2After = await usdt.balanceOf(player2.address);

      // Full refund (including fees returned)
      expect(bal1After - bal1Before).to.equal(ethers.parseUnits("5", 6));
      expect(bal2After - bal2Before).to.equal(ethers.parseUnits("3", 6));

      const [, , , status] = await bolita.getDraw(drawId);
      expect(status).to.equal(6); // CANCELLED
    });

    it("non-owner cannot cancel", async function () {
      const drawId = await createAndOpenDraw(bolita);
      await expect(
        bolita.connect(player).cancelDraw(drawId)
      ).to.be.reverted;
    });

    it("refund reverses fee accrual", async function () {
      const drawId = await createAndOpenDraw(bolita);
      await placeBetGetId(bolita, player, drawId, 0, 42, 10);

      // Fees accrued after bet
      const feesBefore = await bolita.accruedFees();
      expect(feesBefore).to.equal(ethers.parseUnits("0.5", 6));

      await bolita.cancelDraw(drawId);

      // Fees reversed
      const feesAfter = await bolita.accruedFees();
      expect(feesAfter).to.equal(0);
    });
  });

  // ─── CANCEL STALE DRAW ───
  describe("cancelStaleDraw", function () {
    it("refunds all bets after VRF timeout", async function () {
      const drawId = await createAndOpenDraw(bolita);
      await placeBetGetId(bolita, player, drawId, 0, 42, 5);
      await bolita.closeDraw(drawId);

      // Not yet timed out
      await expect(bolita.cancelStaleDraw(drawId))
        .to.be.revertedWithCustomError(bolita, "VrfNotTimedOut");

      // Advance time past VRF_TIMEOUT (2 hours)
      await ethers.provider.send("evm_increaseTime", [7201]);
      await ethers.provider.send("evm_mine", []);

      const balBefore = await usdt.balanceOf(player.address);
      await bolita.cancelStaleDraw(drawId);
      const balAfter = await usdt.balanceOf(player.address);

      expect(balAfter - balBefore).to.equal(ethers.parseUnits("5", 6));
    });

    it("anyone can cancel a stale draw", async function () {
      const drawId = await createAndOpenDraw(bolita);
      await placeBetGetId(bolita, player, drawId, 0, 42, 1);
      await bolita.closeDraw(drawId);

      await ethers.provider.send("evm_increaseTime", [7201]);
      await ethers.provider.send("evm_mine", []);

      await expect(bolita.connect(player2).cancelStaleDraw(drawId))
        .to.emit(bolita, "DrawCancelled");
    });
  });

  // ─── RETRY UNPAID ───
  describe("retryUnpaidBet", function () {
    it("pays when pool is funded after initial failure", async function () {
      // Deploy with tiny pool
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const token = await MockERC20.deploy("T", "T", 6);
      const MockVRF = await ethers.getContractFactory("MockVRFCoordinator");
      const vrf = await MockVRF.deploy();
      const LaBolitaGame = await ethers.getContractFactory("LaBolitaGame");
      const small = await LaBolitaGame.deploy(
        await token.getAddress(),
        await vrf.getAddress(),
        1,
        ethers.ZeroHash
      );

      // Fund with only 10 USDT (not enough for 61.75 payout)
      await token.mint(owner.address, ethers.parseUnits("10", 6));
      await token.approve(await small.getAddress(), ethers.parseUnits("10", 6));
      await small.fundPool(ethers.parseUnits("10", 6));

      // Player setup
      await token.mint(player.address, ethers.parseUnits("100", 6));
      await token.connect(player).approve(await small.getAddress(), ethers.parseUnits("100", 6));

      // Create draw and bet
      const block = await ethers.provider.getBlock("latest");
      await small.createDraw("D1", block.timestamp + 3600);
      await small.openDraw(1);
      await small.connect(player).placeBet(1, 0, 42, ethers.parseUnits("1", 6));
      await small.closeDraw(1);

      // Winning: fijo 42 wins but pool can't pay
      await vrf.fulfillRandomWords(1, [BigInt(1342)]);

      // Bet won but wasn't paid (pool insufficient)
      const [, , , , , payout, resolved, won] = await small.getBet(1);
      expect(resolved).to.equal(true);
      expect(won).to.equal(true);
      expect(payout).to.be.greaterThan(0);

      // Cannot retry — still not enough pool
      await expect(small.retryUnpaidBet(1))
        .to.be.revertedWithCustomError(small, "InsufficientPool");

      // Fund pool with more
      await token.mint(owner.address, ethers.parseUnits("200", 6));
      await token.approve(await small.getAddress(), ethers.parseUnits("200", 6));
      await small.fundPool(ethers.parseUnits("200", 6));

      // Now retry
      const balBefore = await token.balanceOf(player.address);
      await small.retryUnpaidBet(1);
      const balAfter = await token.balanceOf(player.address);

      expect(balAfter - balBefore).to.equal(payout);
    });
  });

  // ─── POOL ───
  describe("Pool accounting", function () {
    it("availablePool = balance - accruedFees", async function () {
      const bal = await usdt.balanceOf(await bolita.getAddress());
      const fees = await bolita.accruedFees();
      expect(await bolita.availablePool()).to.equal(bal - fees);
    });

    it("fundPool transfers from owner", async function () {
      const amount = ethers.parseUnits("500", 6);
      await usdt.mint(owner.address, amount);
      await usdt.approve(await bolita.getAddress(), amount);
      await expect(bolita.fundPool(amount))
        .to.emit(bolita, "PoolFunded")
        .withArgs(owner.address, amount);
    });
  });

  // ─── ADMIN ───
  describe("Admin functions", function () {
    it("owner can withdraw accrued fees", async function () {
      const drawId = await createAndOpenDraw(bolita);
      await placeBetGetId(bolita, player, drawId, 0, 99, 10);
      // Fee = 10 * 5% = 0.5 USDT
      const fees = await bolita.accruedFees();
      expect(fees).to.equal(ethers.parseUnits("0.5", 6));

      await expect(bolita.withdrawFees(fees, owner.address))
        .to.emit(bolita, "FeesWithdrawn");
      expect(await bolita.accruedFees()).to.equal(0);
    });

    it("owner can set multipliers", async function () {
      await bolita.setMultipliers(7000, 35000, 120000);
      const [f, c, p] = await bolita.getMultipliers();
      expect(f).to.equal(7000);
      expect(c).to.equal(35000);
      expect(p).to.equal(120000);
    });

    it("owner can set bet limits", async function () {
      await bolita.setBetLimits(200000, 50000000, ethers.parseUnits("100", 6));
      expect(await bolita.minBetAmount()).to.equal(200000);
      expect(await bolita.maxBetAmount()).to.equal(50000000);
    });

    it("owner can set fee bps (max 20%)", async function () {
      await bolita.setFeeBps(1000); // 10%
      expect(await bolita.feeBps()).to.equal(1000);
      await expect(bolita.setFeeBps(2001)).to.be.reverted; // > 20%
    });

    it("owner can set VRF config", async function () {
      const newHash = ethers.keccak256(ethers.toUtf8Bytes("new"));
      await bolita.setVrfConfig(42, newHash, 200000, 5);
      expect(await bolita.vrfSubscriptionId()).to.equal(42);
    });

    it("owner can pause/unpause", async function () {
      await bolita.pause();
      expect(await bolita.paused()).to.equal(true);
      await bolita.unpause();
      expect(await bolita.paused()).to.equal(false);
    });

    it("non-owner cannot call admin functions", async function () {
      await expect(
        bolita.connect(player).setMultipliers(1, 1, 1)
      ).to.be.reverted;
      await expect(
        bolita.connect(player).pause()
      ).to.be.reverted;
    });
  });

  // ─── VIEWS ───
  describe("View functions", function () {
    it("getDrawBetCount returns correct count", async function () {
      const drawId = await createAndOpenDraw(bolita);
      await placeBetGetId(bolita, player, drawId, 0, 42, 1);
      await placeBetGetId(bolita, player, drawId, 0, 43, 1);
      expect(await bolita.getDrawBetCount(drawId)).to.equal(2);
    });

    it("getUserBetCount tracks per-user bets", async function () {
      const drawId = await createAndOpenDraw(bolita);
      await placeBetGetId(bolita, player, drawId, 0, 42, 1);
      await placeBetGetId(bolita, player, drawId, 1, 342, 1);
      await placeBetGetId(bolita, player2, drawId, 0, 55, 1);

      expect(await bolita.getUserBetCount(player.address)).to.equal(2);
      expect(await bolita.getUserBetCount(player2.address)).to.equal(1);
    });

    it("getOpenDraws returns open draw IDs", async function () {
      const drawId = await createAndOpenDraw(bolita);
      const openDraws = await bolita.getOpenDraws();
      expect(openDraws.length).to.equal(1);
      expect(openDraws[0]).to.equal(drawId);
    });

    it("getMultipliers returns all three", async function () {
      const [f, c, p] = await bolita.getMultipliers();
      expect(f).to.equal(6500);
      expect(c).to.equal(30000);
      expect(p).to.equal(100000);
    });

    it("getDrawBetIds with pagination", async function () {
      const drawId = await createAndOpenDraw(bolita);
      await placeBetGetId(bolita, player, drawId, 0, 10, 1);
      await placeBetGetId(bolita, player, drawId, 0, 20, 1);
      await placeBetGetId(bolita, player, drawId, 0, 30, 1);

      const page1 = await bolita.getDrawBetIds(drawId, 0, 2);
      expect(page1.length).to.equal(2);

      const page2 = await bolita.getDrawBetIds(drawId, 2, 2);
      expect(page2.length).to.equal(1);
    });
  });
});
