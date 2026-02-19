const { expect } = require("chai");
const { ethers } = require("hardhat");
const { PAYOUT_TABLE, setupPayoutTable, deployFixture, placeBetAndGetIds, randomWord } = require("./helpers");

describe("KenoGame — Payout Table", function () {
  let keno, usdt, vrfCoordinator, owner, player;

  beforeEach(async function () {
    ({ keno, usdt, vrfCoordinator, owner, player } = await deployFixture());
  });

  describe("Initial setup", function () {
    it("has version 1 after setup", async function () {
      expect(await keno.payoutTableVersion()).to.equal(1);
    });

    it("stores correct multipliers", async function () {
      // Spot 1, hit 1 = 3x (300 in 1e2)
      expect(await keno.getPayoutMultiplier(1, 1)).to.equal(300);
      // Spot 5, hit 5 = 300x (30000 in 1e2)
      expect(await keno.getPayoutMultiplier(5, 5)).to.equal(30000);
      // Spot 10, hit 10 = 10000x (1000000 in 1e2)
      expect(await keno.getPayoutMultiplier(10, 10)).to.equal(1000000);
      // Spot 3, hit 0 = 0x
      expect(await keno.getPayoutMultiplier(3, 0)).to.equal(0);
    });
  });

  describe("updatePayoutRow", function () {
    it("writes to next version (not current)", async function () {
      // Current version is 1. Writing to next (version 2)
      await keno.updatePayoutRow(1, [0, 500]); // Change pick-1, hit-1 to 5x

      // Version 1 should be unchanged
      expect(await keno.getPayoutMultiplier(1, 1)).to.equal(300);
      // Version 2 should have new value
      expect(await keno.getPayoutMultiplierForVersion(2, 1, 1)).to.equal(500);
    });

    it("reverts for invalid spots", async function () {
      await expect(
        keno.updatePayoutRow(0, [0])
      ).to.be.revertedWithCustomError(keno, "InvalidSpots");
      await expect(
        keno.updatePayoutRow(11, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
      ).to.be.revertedWithCustomError(keno, "InvalidSpots");
    });

    it("reverts for wrong multipliers length", async function () {
      await expect(
        keno.updatePayoutRow(3, [0, 0]) // needs 4 entries for 3 spots
      ).to.be.revertedWith("Wrong length");
    });

    it("only owner can call", async function () {
      await expect(
        keno.connect(player).updatePayoutRow(1, [0, 300])
      ).to.be.revertedWith("Only callable by owner");
    });
  });

  describe("commitPayoutUpdate", function () {
    it("activates new version after populating all spots", async function () {
      // Advance time past 24h timelock (version 1 already committed by fixture)
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      // Populate all 10 spot rows for version 2
      for (let spots = 1; spots <= 10; spots++) {
        const mults = PAYOUT_TABLE[spots].map(m => m);
        await keno.updatePayoutRow(spots, mults);
      }

      await keno.commitPayoutUpdate();
      expect(await keno.payoutTableVersion()).to.equal(2);
    });

    it("sets effectiveFromBetId = betCounter + 1", async function () {
      // Place a bet first to advance betCounter
      await placeBetAndGetIds(keno, player, [1]);
      // Resolve it
      await vrfCoordinator.fulfillRandomWords(1, [randomWord()]);

      expect(await keno.betCounter()).to.equal(1);

      // Now update table — need to wait 24h for timelock
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      for (let spots = 1; spots <= 10; spots++) {
        const mults = PAYOUT_TABLE[spots].map(m => m);
        await keno.updatePayoutRow(spots, mults);
      }
      await keno.commitPayoutUpdate();

      expect(await keno.payoutEffectiveFromBetId()).to.equal(2); // betCounter(1) + 1
    });

    it("reverts if not all spots populated", async function () {
      // Only populate spots 1-5
      for (let spots = 1; spots <= 5; spots++) {
        const mults = PAYOUT_TABLE[spots].map(m => m);
        await keno.updatePayoutRow(spots, mults);
      }

      await expect(
        keno.commitPayoutUpdate()
      ).to.be.revertedWithCustomError(keno, "NotAllSpotsPopulated");
    });

    it("first commit has no timelock", async function () {
      // Deploy fresh contract (no payout table yet)
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

      // Should commit immediately (no timelock for version 0 → 1)
      await setupPayoutTable(freshKeno);
      expect(await freshKeno.payoutTableVersion()).to.equal(1);
    });

    it("second commit requires 24h timelock", async function () {
      // Try to commit version 2 immediately
      for (let spots = 1; spots <= 10; spots++) {
        const mults = PAYOUT_TABLE[spots].map(m => m);
        await keno.updatePayoutRow(spots, mults);
      }

      await expect(
        keno.commitPayoutUpdate()
      ).to.be.revertedWithCustomError(keno, "TimelockActive");
    });

    it("second commit succeeds after 24h", async function () {
      // Advance time by 24h + 1s
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      for (let spots = 1; spots <= 10; spots++) {
        const mults = PAYOUT_TABLE[spots].map(m => m);
        await keno.updatePayoutRow(spots, mults);
      }

      await expect(keno.commitPayoutUpdate())
        .to.emit(keno, "PayoutTableUpdated")
        .withArgs(2, 1); // version 2, effectiveFromBetId = 0 + 1 = 1
    });

    it("reverts with pending bets on subsequent commits", async function () {
      // Advance time
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      // Place a bet (creates pending)
      await placeBetAndGetIds(keno, player, [1]);

      for (let spots = 1; spots <= 10; spots++) {
        const mults = PAYOUT_TABLE[spots].map(m => m);
        await keno.updatePayoutRow(spots, mults);
      }

      await expect(
        keno.commitPayoutUpdate()
      ).to.be.revertedWithCustomError(keno, "PendingBetsExist");
    });

    it("only owner can commit", async function () {
      await expect(
        keno.connect(player).commitPayoutUpdate()
      ).to.be.revertedWith("Only callable by owner");
    });
  });

  describe("Version snapshot in bets", function () {
    it("bet uses table version from placement time", async function () {
      // Bet placed with version 1
      const { betId } = await placeBetAndGetIds(keno, player, [1]);
      expect(await keno.betPayoutVersion(betId)).to.equal(1);

      // Even if we update the table later, the bet still references version 1
      // (fulfillRandomWords looks up _payoutTables[betPayoutVersion[betId]])
    });

    it("version 1 table preserved after version 2 commit", async function () {
      // Advance time for timelock
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      // Update to version 2 with different multipliers
      for (let spots = 1; spots <= 10; spots++) {
        const mults = PAYOUT_TABLE[spots].map(m => m * 2); // double all
        await keno.updatePayoutRow(spots, mults);
      }
      await keno.commitPayoutUpdate();

      // Version 1 still preserved
      expect(await keno.getPayoutMultiplierForVersion(1, 1, 1)).to.equal(300);
      // Version 2 has doubled values
      expect(await keno.getPayoutMultiplierForVersion(2, 1, 1)).to.equal(600);
      // Current version is 2
      expect(await keno.getPayoutMultiplier(1, 1)).to.equal(600);
    });
  });
});
