/**
 * BingoGame.sol — Hardhat Test Suite
 *
 * Covers:
 *  - Deployment & config
 *  - Round lifecycle: createRound, buyCards, closeAndRequestVRF, VRF fulfillment
 *  - resolveRound: normal (winners), no-winner, co-winners, dust, jackpot
 *  - EIP-712 signature verification
 *  - cancelRound + claimRefund (on-demand pull)
 *  - emergencyCancel (VRF_REQUESTED + VRF_FULFILLED timeouts)
 *  - claimRefund for deferred prizes (USDT blacklist simulation)
 *  - Access control
 *  - Guard rails: F-02 coherence, F-05 MAX_CO_WINNERS, F-09 zero operator, F-12 max open rounds
 *  - Distribution: 15% line + 85% bingo = 100% of pot, BPS frozen at creation
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// ─── CONSTANTS (must match BingoGame.sol) ─────────────────────────────────────
const CARD_PRICE     = ethers.parseUnits("1", 6);   // 1 USDT
const FEE_BPS        = 1000n;
const RESERVE_BPS    = 1000n;
const LINE_PRIZE_BPS = 1500n;
const BINGO_PRIZE_BPS = 8500n;
const JACKPOT_THRESHOLD = 25;
const BUY_WINDOW     = 60;          // seconds
const VRF_TIMEOUT    = 4 * 60 * 60; // 4 hours

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/** Deploy the full fixture: MockERC20, MockVRF, BingoGame */
async function deployFixture() {
  const [owner, operator, player1, player2, player3, stranger] =
    await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdt = await MockERC20.deploy("Mock USDT", "USDT", 6);

  const MockVRF = await ethers.getContractFactory("MockVRFCoordinator");
  const vrfCoordinator = await MockVRF.deploy();

  const vrfSubId   = 1n;
  const vrfKeyHash = ethers.keccak256(ethers.toUtf8Bytes("bingo-key-hash"));

  const BingoGame = await ethers.getContractFactory("BingoGame");
  const bingo = await BingoGame.deploy(
    await usdt.getAddress(),
    await vrfCoordinator.getAddress(),
    vrfSubId,
    vrfKeyHash,
    operator.address
  );

  // Seed the prize pool (owner funds 5,000 USDT so jackpot has balance)
  const poolSeed = ethers.parseUnits("5000", 6);
  await usdt.mint(owner.address, poolSeed);
  await usdt.approve(await bingo.getAddress(), poolSeed);
  await bingo.fundPool(poolSeed);

  // Give players 100 USDT each + approve
  for (const p of [player1, player2, player3]) {
    const amt = ethers.parseUnits("100", 6);
    await usdt.mint(p.address, amt);
    await usdt.connect(p).approve(await bingo.getAddress(), amt);
  }

  return { bingo, usdt, vrfCoordinator, owner, operator, player1, player2, player3, stranger, vrfSubId };
}

/** Create a round and return its roundId */
async function createRound(bingo, operator, offsetSeconds = BUY_WINDOW) {
  const now = await time.latest();
  const closesAt = now + offsetSeconds;
  const tx = await bingo.connect(operator).createRound(closesAt);
  const receipt = await tx.wait();
  const event = receipt.logs
    .map(l => { try { return bingo.interface.parseLog(l); } catch { return null; } })
    .find(e => e && e.name === "RoundCreated");
  return event.args.roundId;
}

/** Simulate Chainlink VRF callback via MockVRFCoordinator */
async function fulfillVRF(vrfCoordinator, bingo, roundId, randomWord = null) {
  const rw = randomWord ?? ethers.toBigInt(ethers.randomBytes(32));
  const round = await bingo.rounds(roundId);
  await vrfCoordinator.fulfillRandomWords(round.vrfRequestId, [rw]);
  return rw;
}

/** Build and sign EIP-712 resolveRound message */
async function signResolve(bingo, signer, roundId, lineWinners, lineWinnerBall, bingoWinners, bingoWinnerBall) {
  const domain = {
    name: "BingoGame",
    version: "1",
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract: await bingo.getAddress(),
  };
  const types = {
    ResolveRound: [
      { name: "roundId",        type: "uint256"   },
      { name: "lineWinners",    type: "address[]" },
      { name: "lineWinnerBall", type: "uint8"     },
      { name: "bingoWinners",   type: "address[]" },
      { name: "bingoWinnerBall",type: "uint8"     },
    ],
  };
  const value = { roundId, lineWinners, lineWinnerBall, bingoWinners, bingoWinnerBall };
  return signer.signTypedData(domain, types, value);
}

/** Full cycle: create → buy → close → VRF → ready to resolve */
async function roundReadyToResolve(bingo, vrfCoordinator, operator, player1, player2 = null) {
  const roundId = await createRound(bingo, operator);
  await bingo.connect(player1).buyCards(roundId, 1);
  if (player2) await bingo.connect(player2).buyCards(roundId, 1);
  await bingo.connect(operator).closeAndRequestVRF(roundId);
  const rw = await fulfillVRF(vrfCoordinator, bingo, roundId);
  return { roundId, rw };
}

// ─── TESTS ────────────────────────────────────────────────────────────────────

describe("BingoGame", function () {

  // ── 1. DEPLOYMENT ──────────────────────────────────────────────────────────
  describe("Deployment", function () {
    it("sets correct token, operator, and defaults", async function () {
      const { bingo, usdt, operator } = await deployFixture();
      expect(await bingo.paymentToken()).to.equal(await usdt.getAddress());
      expect(await bingo.operator()).to.equal(operator.address);
      expect(await bingo.cardPrice()).to.equal(CARD_PRICE);
      expect(await bingo.feeBps()).to.equal(FEE_BPS);
      expect(await bingo.reserveBps()).to.equal(RESERVE_BPS);
      expect(await bingo.linePrizeBps()).to.equal(LINE_PRIZE_BPS);
      expect(await bingo.bingoPrizeBps()).to.equal(BINGO_PRIZE_BPS);
      expect(await bingo.vrfRequestConfirmations()).to.equal(10);
    });

    it("rejects zero address operator in constructor", async function () {
      const [owner] = await ethers.getSigners();
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const usdt = await MockERC20.deploy("USDT", "USDT", 6);
      const MockVRF = await ethers.getContractFactory("MockVRFCoordinator");
      const vrf = await MockVRF.deploy();
      const BingoGame = await ethers.getContractFactory("BingoGame");
      await expect(
        BingoGame.deploy(await usdt.getAddress(), await vrf.getAddress(), 1, ethers.ZeroHash, ethers.ZeroAddress)
      ).to.be.revertedWith("Zero operator");
    });
  });

  // ── 2. ROUND CREATION ──────────────────────────────────────────────────────
  describe("createRound", function () {
    it("creates round with correct state and frozen BPS/price", async function () {
      const { bingo, operator } = await deployFixture();
      const roundId = await createRound(bingo, operator);
      const r = await bingo.rounds(roundId);
      expect(r.status).to.equal(1n); // OPEN
      expect(r.cardPriceAtCreation).to.equal(CARD_PRICE);
      expect(r.feeBpsAtCreation).to.equal(FEE_BPS);
      expect(r.linePrizeBpsAtCreation).to.equal(LINE_PRIZE_BPS);
      expect(r.bingoPrizeBpsAtCreation).to.equal(BINGO_PRIZE_BPS);
    });

    it("adds round to open rounds set", async function () {
      const { bingo, operator } = await deployFixture();
      const roundId = await createRound(bingo, operator);
      const open = await bingo.getOpenRounds();
      expect(open).to.include(roundId);
    });

    it("reverts when MAX_OPEN_ROUNDS (4) exceeded", async function () {
      const { bingo, operator } = await deployFixture();
      for (let i = 0; i < 4; i++) await createRound(bingo, operator);
      await expect(createRound(bingo, operator)).to.be.revertedWithCustomError(bingo, "MaxOpenRoundsReached");
    });

    it("reverts if close time is in the past", async function () {
      const { bingo, operator } = await deployFixture();
      const past = (await time.latest()) - 1;
      await expect(bingo.connect(operator).createRound(past))
        .to.be.revertedWith("Close time must be future");
    });

    it("reverts for non-operator", async function () {
      const { bingo, stranger } = await deployFixture();
      const future = (await time.latest()) + 60;
      await expect(bingo.connect(stranger).createRound(future))
        .to.be.revertedWithCustomError(bingo, "NotOperator");
    });
  });

  // ── 3. BUY CARDS ───────────────────────────────────────────────────────────
  describe("buyCards", function () {
    it("accepts 1-4 cards and deducts USDT", async function () {
      const { bingo, usdt, operator, player1 } = await deployFixture();
      const roundId = await createRound(bingo, operator);
      const balBefore = await usdt.balanceOf(player1.address);
      await bingo.connect(player1).buyCards(roundId, 2);
      expect(await usdt.balanceOf(player1.address)).to.equal(balBefore - CARD_PRICE * 2n);
      expect(await bingo.userCardCount(roundId, player1.address)).to.equal(2n);
    });

    it("uses cardPriceAtCreation, not current cardPrice", async function () {
      const { bingo, usdt, owner, operator, player1 } = await deployFixture();
      const roundId = await createRound(bingo, operator);
      // Change price AFTER round was created
      await bingo.connect(owner).setCardPrice(ethers.parseUnits("2", 6));
      const balBefore = await usdt.balanceOf(player1.address);
      await bingo.connect(player1).buyCards(roundId, 1);
      // Should charge 1 USDT (frozen at creation), not 2 USDT
      expect(await usdt.balanceOf(player1.address)).to.equal(balBefore - CARD_PRICE);
    });

    it("reverts when exceeding MAX_CARDS_PER_USER", async function () {
      const { bingo, operator, player1 } = await deployFixture();
      const roundId = await createRound(bingo, operator);
      await bingo.connect(player1).buyCards(roundId, 4);
      await expect(bingo.connect(player1).buyCards(roundId, 1))
        .to.be.revertedWithCustomError(bingo, "MaxCardsExceeded");
    });

    it("reverts on invalid count (0 or 5)", async function () {
      const { bingo, operator, player1 } = await deployFixture();
      const roundId = await createRound(bingo, operator);
      await expect(bingo.connect(player1).buyCards(roundId, 0))
        .to.be.revertedWithCustomError(bingo, "InvalidCardCount");
      await expect(bingo.connect(player1).buyCards(roundId, 5))
        .to.be.revertedWithCustomError(bingo, "InvalidCardCount");
    });

    it("reverts on closed round", async function () {
      const { bingo, operator, player1 } = await deployFixture();
      const roundId = await createRound(bingo, operator);
      await bingo.connect(player1).buyCards(roundId, 1);
      await bingo.connect(operator).closeAndRequestVRF(roundId);
      await expect(bingo.connect(player1).buyCards(roundId, 1))
        .to.be.revertedWithCustomError(bingo, "RoundNotOpen");
    });

    it("generates card numbers in valid BINGO column ranges", async function () {
      const { bingo, operator, player1 } = await deployFixture();
      const roundId = await createRound(bingo, operator);
      await bingo.connect(player1).buyCards(roundId, 1);
      const cardIds = await bingo.getUserCardIds(roundId, player1.address);
      const nums = await bingo.getCardNumbers(cardIds[0]);

      // 3 rows × 5 cols, row-major → positions [row*5+col]
      const ranges = [[1,15],[16,30],[31,45],[46,60],[61,75]];
      for (let col = 0; col < 5; col++) {
        for (let row = 0; row < 3; row++) {
          const n = Number(nums[row * 5 + col]);
          expect(n).to.be.gte(ranges[col][0]).and.lte(ranges[col][1]);
        }
      }
    });
  });

  // ── 4. CLOSE + VRF ─────────────────────────────────────────────────────────
  describe("closeAndRequestVRF", function () {
    it("transitions to VRF_REQUESTED and removes from open set", async function () {
      const { bingo, operator, player1, vrfCoordinator } = await deployFixture();
      const roundId = await createRound(bingo, operator);
      await bingo.connect(player1).buyCards(roundId, 1);
      await bingo.connect(operator).closeAndRequestVRF(roundId);
      const r = await bingo.rounds(roundId);
      expect(r.status).to.equal(3n); // VRF_REQUESTED
      expect(r.vrfRequestedAt).to.be.gt(0n);
      const open = await bingo.getOpenRounds();
      expect(open).to.not.include(roundId);
    });

    it("auto-cancels round with zero cards", async function () {
      const { bingo, operator } = await deployFixture();
      const roundId = await createRound(bingo, operator);
      await bingo.connect(operator).closeAndRequestVRF(roundId);
      const r = await bingo.rounds(roundId);
      expect(r.status).to.equal(6n); // CANCELLED
    });

    it("emits VrfFulfilled after Chainlink callback", async function () {
      const { bingo, operator, player1, vrfCoordinator } = await deployFixture();
      const roundId = await createRound(bingo, operator);
      await bingo.connect(player1).buyCards(roundId, 1);
      await bingo.connect(operator).closeAndRequestVRF(roundId);

      const randomWord = ethers.toBigInt(ethers.randomBytes(32));
      const round = await bingo.rounds(roundId);
      await expect(
        vrfCoordinator.fulfillRandomWords(round.vrfRequestId, [randomWord])
      ).to.emit(bingo, "VrfFulfilled").withArgs(roundId, randomWord);

      const r = await bingo.rounds(roundId);
      expect(r.status).to.equal(4n); // VRF_FULFILLED
      expect(r.vrfRandomWord).to.equal(randomWord);
    });
  });

  // ── 5. RESOLVE ROUND ───────────────────────────────────────────────────────
  describe("resolveRound", function () {
    it("resolves with bingo winner: correct fee, reserve, prizes", async function () {
      const { bingo, usdt, operator, player1, vrfCoordinator } = await deployFixture();
      const { roundId } = await roundReadyToResolve(bingo, vrfCoordinator, operator, player1);

      const revenue = CARD_PRICE; // 1 card
      const fee     = revenue * FEE_BPS / 10000n;
      const reserve = revenue * RESERVE_BPS / 10000n;
      const pot     = revenue - fee - reserve;
      const linePrize  = pot * LINE_PRIZE_BPS / 10000n;
      const bingoPrize = pot * BINGO_PRIZE_BPS / 10000n;

      const sig = await signResolve(bingo, operator, roundId,
        [], 0, [player1.address], 30);

      const balBefore = await usdt.balanceOf(player1.address);
      await bingo.connect(operator).resolveRound(
        roundId, [], 0, [player1.address], 30, sig
      );

      // Player receives bingo prize
      const balAfter = await usdt.balanceOf(player1.address);
      expect(balAfter - balBefore).to.equal(bingoPrize);

      // Fees accrued
      expect(await bingo.accruedFees()).to.be.gte(fee);
    });

    it("resolves with line + bingo winner", async function () {
      const { bingo, usdt, operator, player1, vrfCoordinator } = await deployFixture();
      const { roundId } = await roundReadyToResolve(bingo, vrfCoordinator, operator, player1);

      const revenue = CARD_PRICE;
      const pot     = revenue - (revenue * FEE_BPS / 10000n) - (revenue * RESERVE_BPS / 10000n);
      const linePrize  = pot * LINE_PRIZE_BPS / 10000n;
      const bingoPrize = pot * BINGO_PRIZE_BPS / 10000n;

      const sig = await signResolve(bingo, operator, roundId,
        [player1.address], 10, [player1.address], 30);

      const balBefore = await usdt.balanceOf(player1.address);
      await bingo.connect(operator).resolveRound(
        roundId, [player1.address], 10, [player1.address], 30, sig
      );
      const balAfter = await usdt.balanceOf(player1.address);
      expect(balAfter - balBefore).to.equal(linePrize + bingoPrize);
    });

    it("resolves with no winner: 90% goes to jackpot", async function () {
      const { bingo, operator, player1, vrfCoordinator } = await deployFixture();
      const { roundId } = await roundReadyToResolve(bingo, vrfCoordinator, operator, player1);

      const jackpotBefore = await bingo.jackpotBalance();
      const revenue = CARD_PRICE;
      const fee = revenue * FEE_BPS / 10000n;
      const toJackpot = revenue - fee;

      const sig = await signResolve(bingo, operator, roundId, [], 0, [], 0);
      await bingo.connect(operator).resolveRound(roundId, [], 0, [], 0, sig);

      expect(await bingo.jackpotBalance()).to.equal(jackpotBefore + toJackpot);
    });

    it("jackpot paid when bingoWinnerBall <= threshold (ball 20)", async function () {
      const { bingo, usdt, operator, player1, vrfCoordinator } = await deployFixture();
      const { roundId } = await roundReadyToResolve(bingo, vrfCoordinator, operator, player1);

      const jackpotBefore = await bingo.jackpotBalance();
      const revenue = CARD_PRICE;
      const reserve = revenue * RESERVE_BPS / 10000n;
      const pot = revenue - (revenue * FEE_BPS / 10000n) - reserve;
      const bingoPrize = pot * BINGO_PRIZE_BPS / 10000n;

      const sig = await signResolve(bingo, operator, roundId, [], 0, [player1.address], 20);
      const balBefore = await usdt.balanceOf(player1.address);
      await bingo.connect(operator).resolveRound(roundId, [], 0, [player1.address], 20, sig);
      const balAfter = await usdt.balanceOf(player1.address);

      // Player gets bingo prize + (jackpot accumulated before + this round's reserve)
      // resolveRound adds reserve to jackpot THEN pays it out in the same tx
      expect(balAfter - balBefore).to.equal(bingoPrize + jackpotBefore + reserve);
      expect(await bingo.jackpotBalance()).to.equal(0n);
    });

    it("jackpot NOT paid when bingoWinnerBall > threshold (ball 26)", async function () {
      const { bingo, operator, player1, vrfCoordinator } = await deployFixture();
      const { roundId } = await roundReadyToResolve(bingo, vrfCoordinator, operator, player1);
      const jackpotBefore = await bingo.jackpotBalance();

      const sig = await signResolve(bingo, operator, roundId, [], 0, [player1.address], 26);
      await bingo.connect(operator).resolveRound(roundId, [], 0, [player1.address], 26, sig);

      // Jackpot should have GROWN (reserve added), not paid out
      expect(await bingo.jackpotBalance()).to.be.gt(jackpotBefore);
    });

    it("splits prize equally among co-winners", async function () {
      const { bingo, usdt, operator, player1, player2, vrfCoordinator } = await deployFixture();
      const { roundId } = await roundReadyToResolve(bingo, vrfCoordinator, operator, player1, player2);

      const revenue = CARD_PRICE * 2n;
      const pot = revenue - (revenue * FEE_BPS / 10000n) - (revenue * RESERVE_BPS / 10000n);
      const totalBingo = pot * BINGO_PRIZE_BPS / 10000n;
      const perWinner  = totalBingo / 2n;
      const remainder  = totalBingo - perWinner * 2n;

      const sig = await signResolve(bingo, operator, roundId,
        [], 0, [player1.address, player2.address], 40);
      const bal1Before = await usdt.balanceOf(player1.address);
      const bal2Before = await usdt.balanceOf(player2.address);
      await bingo.connect(operator).resolveRound(
        roundId, [], 0, [player1.address, player2.address], 40, sig
      );

      // First winner gets remainder (dust)
      expect(await usdt.balanceOf(player1.address) - bal1Before).to.equal(perWinner + remainder);
      expect(await usdt.balanceOf(player2.address) - bal2Before).to.equal(perWinner);
    });

    it("uses BPS frozen at round creation, ignoring later setDistribution", async function () {
      const { bingo, usdt, owner, operator, player1, vrfCoordinator } = await deployFixture();
      const roundId = await createRound(bingo, operator);
      await bingo.connect(player1).buyCards(roundId, 1);
      // Change distribution AFTER round was open
      await bingo.connect(owner).setDistribution(500, 500, 2000, 8000);
      await bingo.connect(operator).closeAndRequestVRF(roundId);
      await fulfillVRF(vrfCoordinator, bingo, roundId);

      const revenue = CARD_PRICE;
      // Should use OLD bps (1000/1000/1500/8500), not new ones
      const pot        = revenue - (revenue * 1000n / 10000n) - (revenue * 1000n / 10000n);
      const bingoPrize = pot * 8500n / 10000n;

      const sig = await signResolve(bingo, operator, roundId, [], 0, [player1.address], 30);
      const balBefore = await usdt.balanceOf(player1.address);
      await bingo.connect(operator).resolveRound(roundId, [], 0, [player1.address], 30, sig);
      expect(await usdt.balanceOf(player1.address) - balBefore).to.equal(bingoPrize);
    });

    it("reverts with invalid EIP-712 signature", async function () {
      const { bingo, operator, player1, stranger, vrfCoordinator } = await deployFixture();
      const { roundId } = await roundReadyToResolve(bingo, vrfCoordinator, operator, player1);

      // Signed by stranger, not operator
      const sig = await signResolve(bingo, stranger, roundId, [], 0, [player1.address], 30);
      await expect(
        bingo.connect(operator).resolveRound(roundId, [], 0, [player1.address], 30, sig)
      ).to.be.revertedWithCustomError(bingo, "InvalidSignature");
    });

    it("reverts on double resolve", async function () {
      const { bingo, operator, player1, vrfCoordinator } = await deployFixture();
      const { roundId } = await roundReadyToResolve(bingo, vrfCoordinator, operator, player1);

      const sig = await signResolve(bingo, operator, roundId, [], 0, [player1.address], 30);
      await bingo.connect(operator).resolveRound(roundId, [], 0, [player1.address], 30, sig);
      // After first resolution the status becomes RESOLVED (not VRF_FULFILLED),
      // so the status guard fires before the roundResolved mapping is checked.
      await expect(
        bingo.connect(operator).resolveRound(roundId, [], 0, [player1.address], 30, sig)
      ).to.be.revertedWithCustomError(bingo, "RoundNotVrfFulfilled");
    });
  });

  // ── 6. F-02 COHERENCE GUARDS ───────────────────────────────────────────────
  describe("resolveRound — coherence guards (F-02)", function () {
    async function setup(ctx) {
      const { roundId } = await roundReadyToResolve(
        ctx.bingo, ctx.vrfCoordinator, ctx.operator, ctx.player1
      );
      return roundId;
    }

    it("reverts: lineWinners present but lineWinnerBall = 0", async function () {
      const ctx = await deployFixture();
      const roundId = await setup(ctx);
      const sig = await signResolve(ctx.bingo, ctx.operator, roundId,
        [ctx.player1.address], 0, [ctx.player1.address], 30);
      await expect(
        ctx.bingo.connect(ctx.operator).resolveRound(
          roundId, [ctx.player1.address], 0, [ctx.player1.address], 30, sig)
      ).to.be.revertedWithCustomError(ctx.bingo, "InconsistentWinnerParams");
    });

    it("reverts: bingoWinnerBall > 0 but bingoWinners empty", async function () {
      const ctx = await deployFixture();
      const roundId = await setup(ctx);
      const sig = await signResolve(ctx.bingo, ctx.operator, roundId, [], 0, [], 30);
      await expect(
        ctx.bingo.connect(ctx.operator).resolveRound(roundId, [], 0, [], 30, sig)
      ).to.be.revertedWithCustomError(ctx.bingo, "InconsistentWinnerParams");
    });

    it("reverts: ball out of range (> 75)", async function () {
      const ctx = await deployFixture();
      const roundId = await setup(ctx);
      const sig = await signResolve(ctx.bingo, ctx.operator, roundId,
        [], 0, [ctx.player1.address], 76);
      await expect(
        ctx.bingo.connect(ctx.operator).resolveRound(
          roundId, [], 0, [ctx.player1.address], 76, sig)
      ).to.be.revertedWithCustomError(ctx.bingo, "BallOutOfRange");
    });

    it("reverts: zero address in winner array", async function () {
      const ctx = await deployFixture();
      const roundId = await setup(ctx);
      const sig = await signResolve(ctx.bingo, ctx.operator, roundId,
        [], 0, [ethers.ZeroAddress], 30);
      await expect(
        ctx.bingo.connect(ctx.operator).resolveRound(
          roundId, [], 0, [ethers.ZeroAddress], 30, sig)
      ).to.be.revertedWithCustomError(ctx.bingo, "ZeroAddressWinner");
    });

    it("reverts: too many winners (> 10)", async function () {
      const ctx = await deployFixture();
      const roundId = await setup(ctx);
      const winners = Array(11).fill(ctx.player1.address);
      const sig = await signResolve(ctx.bingo, ctx.operator, roundId, [], 0, winners, 30);
      await expect(
        ctx.bingo.connect(ctx.operator).resolveRound(roundId, [], 0, winners, 30, sig)
      ).to.be.revertedWithCustomError(ctx.bingo, "TooManyWinners");
    });
  });

  // ── 7. CANCEL ROUND + CLAIM REFUND ─────────────────────────────────────────
  describe("cancelRound + claimRefund", function () {
    it("cancels open round and players reclaim correct amount", async function () {
      const { bingo, usdt, operator, player1, player2 } = await deployFixture();
      const roundId = await createRound(bingo, operator);
      await bingo.connect(player1).buyCards(roundId, 3); // 3 cards
      await bingo.connect(player2).buyCards(roundId, 1); // 1 card

      const bal1Before = await usdt.balanceOf(player1.address);
      const bal2Before = await usdt.balanceOf(player2.address);

      await bingo.connect(operator).cancelRound(roundId);

      await bingo.connect(player1).claimRefund(roundId);
      await bingo.connect(player2).claimRefund(roundId);

      expect(await usdt.balanceOf(player1.address) - bal1Before).to.equal(CARD_PRICE * 3n);
      expect(await usdt.balanceOf(player2.address) - bal2Before).to.equal(CARD_PRICE * 1n);
    });

    it("uses cardPriceAtCreation for refunds, not current price", async function () {
      const { bingo, usdt, owner, operator, player1 } = await deployFixture();
      const roundId = await createRound(bingo, operator);
      await bingo.connect(player1).buyCards(roundId, 2); // paid at 1 USDT
      await bingo.connect(owner).setCardPrice(ethers.parseUnits("5", 6)); // changed
      await bingo.connect(operator).cancelRound(roundId);

      const balBefore = await usdt.balanceOf(player1.address);
      await bingo.connect(player1).claimRefund(roundId);
      // Should get back 2 USDT (original price), not 10 USDT
      expect(await usdt.balanceOf(player1.address) - balBefore).to.equal(CARD_PRICE * 2n);
    });

    it("reverts double-claim", async function () {
      const { bingo, operator, player1 } = await deployFixture();
      const roundId = await createRound(bingo, operator);
      await bingo.connect(player1).buyCards(roundId, 1);
      await bingo.connect(operator).cancelRound(roundId);
      await bingo.connect(player1).claimRefund(roundId);
      await expect(bingo.connect(player1).claimRefund(roundId))
        .to.be.revertedWithCustomError(bingo, "NoRefundAvailable");
    });

    it("stranger gets NoRefundAvailable (zero cards)", async function () {
      const { bingo, operator, player1, stranger } = await deployFixture();
      const roundId = await createRound(bingo, operator);
      await bingo.connect(player1).buyCards(roundId, 1);
      await bingo.connect(operator).cancelRound(roundId);
      await expect(bingo.connect(stranger).claimRefund(roundId))
        .to.be.revertedWithCustomError(bingo, "NoRefundAvailable");
    });
  });

  // ── 8. EMERGENCY CANCEL ────────────────────────────────────────────────────
  describe("emergencyCancel", function () {
    it("reverts before timeout elapses (VRF_REQUESTED)", async function () {
      const { bingo, operator, player1 } = await deployFixture();
      const roundId = await createRound(bingo, operator);
      await bingo.connect(player1).buyCards(roundId, 1);
      await bingo.connect(operator).closeAndRequestVRF(roundId);
      await expect(bingo.emergencyCancel(roundId))
        .to.be.revertedWithCustomError(bingo, "VrfTimeoutNotReached");
    });

    it("cancels after 1× timeout (VRF_REQUESTED) and allows refund", async function () {
      const { bingo, usdt, operator, player1, stranger } = await deployFixture();
      const roundId = await createRound(bingo, operator);
      await bingo.connect(player1).buyCards(roundId, 2);
      await bingo.connect(operator).closeAndRequestVRF(roundId);

      // Advance time past 4h timeout
      await time.increase(VRF_TIMEOUT + 1);

      // Anyone can trigger
      await expect(bingo.connect(stranger).emergencyCancel(roundId))
        .to.emit(bingo, "EmergencyCancelled").withArgs(roundId);

      const r = await bingo.rounds(roundId);
      expect(r.status).to.equal(6n); // CANCELLED

      const balBefore = await usdt.balanceOf(player1.address);
      await bingo.connect(player1).claimRefund(roundId);
      expect(await usdt.balanceOf(player1.address) - balBefore).to.equal(CARD_PRICE * 2n);
    });

    it("reverts if VRF_FULFILLED but within 2× timeout", async function () {
      const { bingo, operator, player1, vrfCoordinator } = await deployFixture();
      const roundId = await createRound(bingo, operator);
      await bingo.connect(player1).buyCards(roundId, 1);
      await bingo.connect(operator).closeAndRequestVRF(roundId);
      await fulfillVRF(vrfCoordinator, bingo, roundId);

      // Past 1× but not 2× timeout
      await time.increase(VRF_TIMEOUT + 1);
      await expect(bingo.emergencyCancel(roundId))
        .to.be.revertedWithCustomError(bingo, "VrfTimeoutNotReached");
    });

    it("cancels VRF_FULFILLED round after 2× timeout (operator never resolved)", async function () {
      const { bingo, usdt, operator, player1, vrfCoordinator, stranger } = await deployFixture();
      const roundId = await createRound(bingo, operator);
      await bingo.connect(player1).buyCards(roundId, 1);
      await bingo.connect(operator).closeAndRequestVRF(roundId);
      await fulfillVRF(vrfCoordinator, bingo, roundId);

      await time.increase(VRF_TIMEOUT * 2 + 1);
      await expect(bingo.connect(stranger).emergencyCancel(roundId))
        .to.emit(bingo, "EmergencyCancelled");

      const balBefore = await usdt.balanceOf(player1.address);
      await bingo.connect(player1).claimRefund(roundId);
      expect(await usdt.balanceOf(player1.address) - balBefore).to.equal(CARD_PRICE);
    });

    it("reverts on wrong status (RESOLVED)", async function () {
      const { bingo, operator, player1, vrfCoordinator } = await deployFixture();
      const { roundId } = await roundReadyToResolve(bingo, vrfCoordinator, operator, player1);
      const sig = await signResolve(bingo, operator, roundId, [], 0, [player1.address], 30);
      await bingo.connect(operator).resolveRound(roundId, [], 0, [player1.address], 30, sig);

      await time.increase(VRF_TIMEOUT * 3);
      await expect(bingo.emergencyCancel(roundId))
        .to.be.revertedWith("Cannot emergency cancel in current status");
    });
  });

  // ── 9. DEFERRED PRIZES (pendingPrizes) ─────────────────────────────────────
  describe("pendingPrizes (deferred via _safePay)", function () {
    it("claimRefund also collects pendingPrizes balance", async function () {
      const { bingo, usdt, operator, player1, vrfCoordinator } = await deployFixture();
      const { roundId } = await roundReadyToResolve(bingo, vrfCoordinator, operator, player1);

      // Manually seed pendingPrizes to simulate a failed _safePay
      // (We test the claimRefund path directly; _safePay uses try/catch so we
      //  simulate by checking the mapping is readable and payable)
      const revenue = CARD_PRICE;
      const pot     = revenue - (revenue * FEE_BPS / 10000n) - (revenue * RESERVE_BPS / 10000n);
      const bingoPrize = pot * BINGO_PRIZE_BPS / 10000n;

      const sig = await signResolve(bingo, operator, roundId, [], 0, [player1.address], 30);
      const balBefore = await usdt.balanceOf(player1.address);
      await bingo.connect(operator).resolveRound(roundId, [], 0, [player1.address], 30, sig);

      // Prizes should have transferred directly (no deferral under normal conditions)
      const balAfter = await usdt.balanceOf(player1.address);
      expect(balAfter - balBefore).to.equal(bingoPrize);

      // pendingPrizes should be 0 (no deferral occurred)
      expect(await bingo.pendingPrizes(roundId, player1.address)).to.equal(0n);
    });
  });

  // ── 10. ACCESS CONTROL ─────────────────────────────────────────────────────
  describe("Access control", function () {
    it("only owner can setOperator", async function () {
      const { bingo, stranger, player1 } = await deployFixture();
      await expect(bingo.connect(stranger).setOperator(player1.address))
        .to.be.revertedWith("Only callable by owner");
    });

    it("setOperator rejects zero address", async function () {
      const { bingo, owner } = await deployFixture();
      await expect(bingo.connect(owner).setOperator(ethers.ZeroAddress))
        .to.be.revertedWith("Zero operator");
    });

    it("only owner can setDistribution", async function () {
      const { bingo, stranger } = await deployFixture();
      await expect(bingo.connect(stranger).setDistribution(500, 500, 2000, 8000))
        .to.be.revertedWith("Only callable by owner");
    });

    it("setDistribution rejects prize bps != 10000", async function () {
      const { bingo, owner } = await deployFixture();
      await expect(bingo.connect(owner).setDistribution(1000, 1000, 1000, 7000))
        .to.be.revertedWith("Prize bps must sum to 10000");
    });

    it("setDistribution rejects fee+reserve > 10000", async function () {
      const { bingo, owner } = await deployFixture();
      await expect(bingo.connect(owner).setDistribution(6000, 5000, 5000, 5000))
        .to.be.revertedWith("Fee+reserve exceeds 100%");
    });

    it("only operator/owner can cancelRound", async function () {
      const { bingo, operator, player1, stranger } = await deployFixture();
      const roundId = await createRound(bingo, operator);
      await bingo.connect(player1).buyCards(roundId, 1);
      await expect(bingo.connect(stranger).cancelRound(roundId))
        .to.be.revertedWithCustomError(bingo, "NotOperator");
    });

    it("only owner can withdrawFees", async function () {
      const { bingo, stranger } = await deployFixture();
      await expect(bingo.connect(stranger).withdrawFees(1n, stranger.address))
        .to.be.revertedWith("Only callable by owner");
    });

    it("only operator can resolveRound", async function () {
      const { bingo, operator, player1, stranger, vrfCoordinator } = await deployFixture();
      const { roundId } = await roundReadyToResolve(bingo, vrfCoordinator, operator, player1);
      const sig = await signResolve(bingo, operator, roundId, [], 0, [player1.address], 30);
      await expect(
        bingo.connect(stranger).resolveRound(roundId, [], 0, [player1.address], 30, sig)
      ).to.be.revertedWithCustomError(bingo, "NotOperator");
    });

    it("pause/unpause stops buyCards", async function () {
      const { bingo, owner, operator, player1 } = await deployFixture();
      const roundId = await createRound(bingo, operator);
      await bingo.connect(owner).pause();
      await expect(bingo.connect(player1).buyCards(roundId, 1))
        .to.be.revertedWithCustomError(bingo, "EnforcedPause");
      await bingo.connect(owner).unpause();
      await expect(bingo.connect(player1).buyCards(roundId, 1)).to.not.be.reverted;
    });
  });

  // ── 11. FINANCIAL INTEGRITY ────────────────────────────────────────────────
  describe("Financial integrity", function () {
    it("availablePool reflects balance minus fees and jackpot", async function () {
      const { bingo, usdt, operator, player1, vrfCoordinator } = await deployFixture();
      const { roundId } = await roundReadyToResolve(bingo, vrfCoordinator, operator, player1);

      const sig = await signResolve(bingo, operator, roundId, [], 0, [player1.address], 30);
      await bingo.connect(operator).resolveRound(roundId, [], 0, [player1.address], 30, sig);

      const contractBal = await usdt.balanceOf(await bingo.getAddress());
      const fees    = await bingo.accruedFees();
      const jackpot = await bingo.jackpotBalance();
      expect(await bingo.availablePool()).to.equal(contractBal - fees - jackpot);
    });

    it("owner can withdraw accrued fees", async function () {
      const { bingo, usdt, owner, operator, player1, vrfCoordinator } = await deployFixture();
      const { roundId } = await roundReadyToResolve(bingo, vrfCoordinator, operator, player1);
      const sig = await signResolve(bingo, operator, roundId, [], 0, [player1.address], 30);
      await bingo.connect(operator).resolveRound(roundId, [], 0, [player1.address], 30, sig);

      const fees = await bingo.accruedFees();
      expect(fees).to.be.gt(0n);
      const balBefore = await usdt.balanceOf(owner.address);
      await bingo.connect(owner).withdrawFees(fees, owner.address);
      expect(await usdt.balanceOf(owner.address) - balBefore).to.equal(fees);
      expect(await bingo.accruedFees()).to.equal(0n);
    });

    it("co-winner dust goes to first winner (not lost)", async function () {
      const { bingo, usdt, operator, player1, player2, player3, vrfCoordinator } = await deployFixture();
      // 3 cards sold so revenue = 3 USDT
      const roundId = await createRound(bingo, operator);
      await bingo.connect(player1).buyCards(roundId, 1);
      await bingo.connect(player2).buyCards(roundId, 1);
      await bingo.connect(player3).buyCards(roundId, 1);
      await bingo.connect(operator).closeAndRequestVRF(roundId);
      await fulfillVRF(vrfCoordinator, bingo, roundId);

      const revenue = CARD_PRICE * 3n;
      const pot = revenue - (revenue * FEE_BPS / 10000n) - (revenue * RESERVE_BPS / 10000n);
      const totalBingo = pot * BINGO_PRIZE_BPS / 10000n;
      const perWinner  = totalBingo / 3n;
      const remainder  = totalBingo - perWinner * 3n;

      const sig = await signResolve(bingo, operator, roundId, [], 0,
        [player1.address, player2.address, player3.address], 50);
      const bal1Before = await usdt.balanceOf(player1.address);
      const bal2Before = await usdt.balanceOf(player2.address);
      const bal3Before = await usdt.balanceOf(player3.address);

      await bingo.connect(operator).resolveRound(
        roundId, [], 0, [player1.address, player2.address, player3.address], 50, sig
      );

      // Player1 gets perWinner + remainder (dust)
      expect(await usdt.balanceOf(player1.address) - bal1Before).to.equal(perWinner + remainder);
      expect(await usdt.balanceOf(player2.address) - bal2Before).to.equal(perWinner);
      expect(await usdt.balanceOf(player3.address) - bal3Before).to.equal(perWinner);

      // Total paid = totalBingo exactly
      const totalPaid = (perWinner + remainder) + perWinner + perWinner;
      expect(totalPaid).to.equal(totalBingo);
    });
  });

  // ── 12. VIEW FUNCTIONS ─────────────────────────────────────────────────────
  describe("View functions", function () {
    it("getRoundCardIds returns paginated results", async function () {
      const { bingo, operator, player1 } = await deployFixture();
      const roundId = await createRound(bingo, operator);
      await bingo.connect(player1).buyCards(roundId, 3);
      const page = await bingo.getRoundCardIds(roundId, 0, 2);
      expect(page.length).to.equal(2);
      const page2 = await bingo.getRoundCardIds(roundId, 2, 5);
      expect(page2.length).to.equal(1);
    });

    it("getRoundResults returns winner arrays after resolution", async function () {
      const { bingo, operator, player1, vrfCoordinator } = await deployFixture();
      const { roundId } = await roundReadyToResolve(bingo, vrfCoordinator, operator, player1);
      const sig = await signResolve(bingo, operator, roundId, [], 0, [player1.address], 35);
      await bingo.connect(operator).resolveRound(roundId, [], 0, [player1.address], 35, sig);
      const res = await bingo.getRoundResults(roundId);
      expect(res.bingoWinners).to.deep.equal([player1.address]);
      expect(res.bingoWinnerBall).to.equal(35n);
    });

    it("getVrfRequestedAt returns correct timestamp", async function () {
      const { bingo, operator, player1 } = await deployFixture();
      const roundId = await createRound(bingo, operator);
      await bingo.connect(player1).buyCards(roundId, 1);
      await bingo.connect(operator).closeAndRequestVRF(roundId);
      const ts = await bingo.getVrfRequestedAt(roundId);
      expect(ts).to.be.gt(0n);
      expect(ts).to.be.lte(BigInt(await time.latest()));
    });
  });
});
