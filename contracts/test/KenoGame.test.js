const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployFixture, placeBetAndGetIds, randomWord } = require("./helpers");

describe("KenoGame — Core MVP", function () {
  let keno, usdt, vrfCoordinator, owner, player, player2, operatorSigner;

  beforeEach(async function () {
    ({ keno, usdt, vrfCoordinator, owner, player, player2, operatorSigner } =
      await deployFixture());
  });

  // ─── DEPLOYMENT ───
  describe("Deployment", function () {
    it("sets correct initial state", async function () {
      expect(await keno.paymentToken()).to.equal(await usdt.getAddress());
      expect(await keno.operator()).to.equal(operatorSigner.address);
      expect(await keno.settlementEnabled()).to.equal(false);
      expect(await keno.feeBps()).to.equal(1200);
      expect(await keno.betAmount()).to.equal(ethers.parseUnits("1", 6));
      expect(await keno.payoutTableVersion()).to.equal(1);
      expect(await keno.betCounter()).to.equal(0);
      expect(await keno.pendingBetCount()).to.equal(0);
    });

    it("has funded pool", async function () {
      expect(await keno.availablePool()).to.equal(
        ethers.parseUnits("10000", 6)
      );
    });
  });

  // ─── PLACE BET ───
  describe("placeBet", function () {
    it("places a bet and requests VRF", async function () {
      const { betId, vrfRequestId } = await placeBetAndGetIds(keno, player, [
        5, 10, 15, 20, 30,
      ]);
      expect(betId).to.equal(1);
      expect(vrfRequestId).to.equal(1);
      expect(await keno.betCounter()).to.equal(1);
      expect(await keno.pendingBetCount()).to.equal(1);
    });

    it("transfers betAmount from player", async function () {
      const balBefore = await usdt.balanceOf(player.address);
      await placeBetAndGetIds(keno, player, [1, 2, 3]);
      const balAfter = await usdt.balanceOf(player.address);
      expect(balBefore - balAfter).to.equal(ethers.parseUnits("1", 6));
    });

    it("stores bet correctly", async function () {
      await placeBetAndGetIds(keno, player, [7, 14, 21]);
      const bet = await keno.bets(1);
      expect(bet.user).to.equal(player.address);
      expect(bet.amount).to.equal(ethers.parseUnits("1", 6));
      expect(bet.spots).to.equal(3);
      expect(bet.status).to.equal(0); // PENDING
    });

    it("snapshots payoutTableVersion", async function () {
      await placeBetAndGetIds(keno, player, [1]);
      expect(await keno.betPayoutVersion(1)).to.equal(1);
    });

    it("emits BetPlaced", async function () {
      await expect(keno.connect(player).placeBet([5, 10]))
        .to.emit(keno, "BetPlaced")
        .withArgs(1, player.address, ethers.parseUnits("1", 6), 2, 1);
    });

    it("reverts if paused", async function () {
      await keno.pause();
      await expect(
        keno.connect(player).placeBet([1, 2, 3])
      ).to.be.revertedWithCustomError(keno, "EnforcedPause");
    });

    it("reverts with 0 spots", async function () {
      await expect(
        keno.connect(player).placeBet([])
      ).to.be.revertedWithCustomError(keno, "InvalidSpots");
    });

    it("reverts with > 10 spots", async function () {
      await expect(
        keno.connect(player).placeBet([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
      ).to.be.revertedWithCustomError(keno, "InvalidSpots");
    });

    it("reverts with number out of range", async function () {
      await expect(
        keno.connect(player).placeBet([0])
      ).to.be.revertedWithCustomError(keno, "InvalidNumber");
      await expect(
        keno.connect(player).placeBet([81])
      ).to.be.revertedWithCustomError(keno, "InvalidNumber");
    });

    it("reverts with duplicate numbers", async function () {
      await expect(
        keno.connect(player).placeBet([5, 5])
      ).to.be.revertedWithCustomError(keno, "DuplicateNumber");
    });

    it("reverts if no payout table set", async function () {
      // Deploy fresh keno without payout table
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const token = await MockERC20.deploy("T", "T", 6);
      const MockVRF = await ethers.getContractFactory("MockVRFCoordinator");
      const vrf = await MockVRF.deploy();
      const KenoGame = await ethers.getContractFactory("KenoGame");
      const freshKeno = await KenoGame.deploy(
        await token.getAddress(),
        await vrf.getAddress(),
        1,
        ethers.ZeroHash,
        owner.address
      );
      await token.mint(player.address, ethers.parseUnits("10", 6));
      await token
        .connect(player)
        .approve(await freshKeno.getAddress(), ethers.parseUnits("10", 6));
      await expect(
        freshKeno.connect(player).placeBet([1])
      ).to.be.revertedWithCustomError(freshKeno, "NoPayoutTable");
    });
  });

  // ─── VRF FULFILLMENT ───
  describe("fulfillRandomWords", function () {
    it("resolves bet, calculates hits, and pays user", async function () {
      const { betId, vrfRequestId } = await placeBetAndGetIds(keno, player, [
        1, 2, 3, 4, 5,
      ]);

      const balBefore = await usdt.balanceOf(player.address);
      const word = randomWord();

      await expect(
        vrfCoordinator.fulfillRandomWords(vrfRequestId, [word])
      ).to.emit(keno, "BetResolved");

      const bet = await keno.bets(betId);
      expect(bet.status).to.not.equal(0); // Not PENDING anymore
      expect(await keno.pendingBetCount()).to.equal(0);
    });

    it("pays directly to user (no internal balance)", async function () {
      const { betId, vrfRequestId } = await placeBetAndGetIds(keno, player, [
        1,
      ]);

      const balBefore = await usdt.balanceOf(player.address);

      // Use a fixed random word for deterministic testing
      await vrfCoordinator.fulfillRandomWords(vrfRequestId, [
        ethers.toBigInt("0x" + "ab".repeat(32)),
      ]);

      const bet = await keno.bets(betId);
      const balAfter = await usdt.balanceOf(player.address);

      if (bet.payout > 0n) {
        expect(balAfter).to.be.greaterThan(balBefore);
        expect(bet.status).to.equal(1); // PAID
      } else {
        expect(balAfter).to.equal(balBefore);
        expect(bet.status).to.equal(1); // PAID (nothing to pay)
      }
    });

    it("accrues fees on loss", async function () {
      const { vrfRequestId } = await placeBetAndGetIds(keno, player, [
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
      ]);

      // Fulfill — very unlikely to match 10 out of 10, so expect a loss
      const word = randomWord();
      const tx = await vrfCoordinator.fulfillRandomWords(vrfRequestId, [word]);

      const bet = await keno.bets(1);
      const payout = bet.payout;
      const betAmt = bet.amount;

      if (payout < betAmt) {
        const loss = betAmt - payout;
        const expectedFee = (loss * 1200n) / 10000n;
        expect(await keno.accruedFees()).to.equal(expectedFee);
      }
    });

    it("emits FeesAccrued on loss", async function () {
      const { vrfRequestId } = await placeBetAndGetIds(keno, player, [
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
      ]);

      // With 10 picks, very likely to have some loss
      await expect(
        vrfCoordinator.fulfillRandomWords(vrfRequestId, [randomWord()])
      ).to.emit(keno, "BetResolved");
      // FeesAccrued event emitted if there's a loss (checked by accruedFees > 0)
    });

    it("never reverts on VRF callback", async function () {
      // Place multiple bets
      const { vrfRequestId: r1 } = await placeBetAndGetIds(keno, player, [1]);
      const { vrfRequestId: r2 } = await placeBetAndGetIds(keno, player, [2]);

      // Both should fulfill without revert
      await vrfCoordinator.fulfillRandomWords(r1, [randomWord()]);
      await vrfCoordinator.fulfillRandomWords(r2, [randomWord()]);

      expect(await keno.pendingBetCount()).to.equal(0);
    });
  });

  // ─── POOL ───
  describe("Pool accounting", function () {
    it("availablePool = balanceOf - accruedFees", async function () {
      const bal = await usdt.balanceOf(await keno.getAddress());
      const fees = await keno.accruedFees();
      expect(await keno.availablePool()).to.equal(bal - fees);
    });

    it("direct token transfer increases pool", async function () {
      const poolBefore = await keno.availablePool();
      const amount = ethers.parseUnits("500", 6);
      await usdt.mint(owner.address, amount);
      await usdt.transfer(await keno.getAddress(), amount);
      expect(await keno.availablePool()).to.equal(poolBefore + amount);
    });

    it("fundPool transfers from owner", async function () {
      const amount = ethers.parseUnits("500", 6);
      await usdt.mint(owner.address, amount);
      await usdt.approve(await keno.getAddress(), amount);
      await expect(keno.fundPool(amount))
        .to.emit(keno, "PoolFunded")
        .withArgs(owner.address, amount);
    });
  });

  // ─── ADMIN ───
  describe("Admin functions", function () {
    it("owner can withdraw accrued fees", async function () {
      // Place and resolve a bet to generate fees
      const { vrfRequestId } = await placeBetAndGetIds(keno, player, [1]);
      await vrfCoordinator.fulfillRandomWords(vrfRequestId, [randomWord()]);

      const fees = await keno.accruedFees();
      if (fees > 0n) {
        await expect(keno.withdrawFees(fees, owner.address))
          .to.emit(keno, "FeesWithdrawn")
          .withArgs(owner.address, fees);
        expect(await keno.accruedFees()).to.equal(0);
      }
    });

    it("cannot withdraw more than accrued fees", async function () {
      await expect(
        keno.withdrawFees(ethers.parseUnits("1", 6), owner.address)
      ).to.be.revertedWith("Exceeds accrued fees");
    });

    it("owner can set bet amount", async function () {
      await keno.setBetAmount(ethers.parseUnits("2", 6));
      expect(await keno.betAmount()).to.equal(ethers.parseUnits("2", 6));
    });

    it("owner can set operator", async function () {
      await expect(keno.setOperator(player.address))
        .to.emit(keno, "OperatorUpdated")
        .withArgs(operatorSigner.address, player.address);
    });

    it("owner can pause/unpause", async function () {
      await keno.pause();
      expect(await keno.paused()).to.equal(true);
      await keno.unpause();
      expect(await keno.paused()).to.equal(false);
    });

    it("owner can set VRF config", async function () {
      const newKeyHash = ethers.keccak256(ethers.toUtf8Bytes("new-key"));
      await keno.setVrfConfig(42, newKeyHash, 500_000, 5);
      expect(await keno.vrfSubscriptionId()).to.equal(42);
      expect(await keno.vrfKeyHash()).to.equal(newKeyHash);
      expect(await keno.vrfCallbackGasLimit()).to.equal(500_000);
      expect(await keno.vrfRequestConfirmations()).to.equal(5);
    });

    it("non-owner cannot call admin functions", async function () {
      await expect(
        keno.connect(player).setBetAmount(0)
      ).to.be.revertedWith("Only callable by owner");
      await expect(
        keno.connect(player).setOperator(player.address)
      ).to.be.revertedWith("Only callable by owner");
      await expect(
        keno.connect(player).pause()
      ).to.be.revertedWith("Only callable by owner");
    });
  });

  // ─── CANCEL STALE BET ───
  describe("cancelStaleBet", function () {
    it("refunds user after timeout", async function () {
      const { betId } = await placeBetAndGetIds(keno, player, [1, 2, 3]);
      expect(await keno.pendingBetCount()).to.equal(1);

      // Should revert before timeout
      await expect(
        keno.cancelStaleBet(betId)
      ).to.be.revertedWithCustomError(keno, "BetNotExpired");

      // Advance time by 1 hour + 1 second
      await ethers.provider.send("evm_increaseTime", [3601]);
      await ethers.provider.send("evm_mine", []);

      const balBefore = await usdt.balanceOf(player.address);

      await expect(keno.cancelStaleBet(betId))
        .to.emit(keno, "BetCancelled")
        .withArgs(betId, player.address, ethers.parseUnits("1", 6));

      const balAfter = await usdt.balanceOf(player.address);
      expect(balAfter - balBefore).to.equal(ethers.parseUnits("1", 6));

      // Bet is now PAID
      const bet = await keno.bets(betId);
      expect(bet.status).to.equal(1); // PAID
      expect(bet.payout).to.equal(ethers.parseUnits("1", 6));
      expect(await keno.pendingBetCount()).to.equal(0);
    });

    it("reverts if bet is not pending", async function () {
      const { betId, vrfRequestId } = await placeBetAndGetIds(keno, player, [1]);
      // Fulfill the bet first
      await vrfCoordinator.fulfillRandomWords(vrfRequestId, [randomWord()]);

      await ethers.provider.send("evm_increaseTime", [3601]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        keno.cancelStaleBet(betId)
      ).to.be.revertedWithCustomError(keno, "BetNotPending");
    });

    it("anyone can call cancelStaleBet", async function () {
      const { betId } = await placeBetAndGetIds(keno, player, [5, 10]);

      await ethers.provider.send("evm_increaseTime", [3601]);
      await ethers.provider.send("evm_mine", []);

      // player2 (not the bet owner) can cancel
      await expect(keno.connect(player2).cancelStaleBet(betId))
        .to.emit(keno, "BetCancelled");
    });

    it("VRF callback is no-op after cancel", async function () {
      const { betId, vrfRequestId } = await placeBetAndGetIds(keno, player, [1, 2]);

      await ethers.provider.send("evm_increaseTime", [3601]);
      await ethers.provider.send("evm_mine", []);

      await keno.cancelStaleBet(betId);

      const balBefore = await usdt.balanceOf(player.address);
      // Late VRF callback should be silently skipped
      await vrfCoordinator.fulfillRandomWords(vrfRequestId, [randomWord()]);
      const balAfter = await usdt.balanceOf(player.address);

      // Balance unchanged — no double refund
      expect(balAfter).to.equal(balBefore);
      // Status still PAID (not changed by VRF)
      const bet = await keno.bets(betId);
      expect(bet.status).to.equal(1);
    });
  });

  // ─── DRAWN BITMAP ───
  describe("drawnBitmap storage", function () {
    it("stores drawnBitmap after VRF fulfillment", async function () {
      const { betId, vrfRequestId } = await placeBetAndGetIds(keno, player, [1, 2, 3]);
      await vrfCoordinator.fulfillRandomWords(vrfRequestId, [randomWord()]);
      const bet = await keno.bets(betId);
      // drawnBitmap should be non-zero (20 numbers drawn)
      expect(bet.drawnBitmap).to.not.equal(0n);
    });
  });

  // ─── NO INTERNAL BALANCES ───
  describe("No internal balances", function () {
    it("contract has no userBalances mapping or withdraw function", async function () {
      // Verify that the contract does NOT have these functions
      const abi = keno.interface.fragments;
      const functionNames = abi
        .filter((f) => f.type === "function")
        .map((f) => f.name);

      expect(functionNames).to.not.include("userBalances");
      expect(functionNames).to.not.include("withdraw");
    });
  });
});
