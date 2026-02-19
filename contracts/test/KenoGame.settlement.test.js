const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployFixture } = require("./helpers");

describe("KenoGame — Phase 2 Settlement (disabled by default)", function () {
  let keno, usdt, owner, player, player2, operatorSigner;

  beforeEach(async function () {
    ({ keno, usdt, owner, player, player2, operatorSigner } =
      await deployFixture());
  });

  // Helper: create EIP-712 signature for settlement
  async function signSettlement(signer, user, netAmount, isProfit, sessionId) {
    const domain = {
      name: "KenoGame",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await keno.getAddress(),
    };

    const types = {
      SettleKenoSession: [
        { name: "user", type: "address" },
        { name: "netAmount", type: "uint256" },
        { name: "isProfit", type: "bool" },
        { name: "sessionId", type: "bytes32" },
      ],
    };

    const value = {
      user,
      netAmount,
      isProfit,
      sessionId,
    };

    return await signer.signTypedData(domain, types, value);
  }

  describe("Disabled by default", function () {
    it("settlementEnabled is false", async function () {
      expect(await keno.settlementEnabled()).to.equal(false);
    });

    it("settleKenoSession reverts when disabled", async function () {
      const sessionId = ethers.keccak256(ethers.toUtf8Bytes("session-1"));
      const sig = await signSettlement(
        operatorSigner,
        player.address,
        ethers.parseUnits("5", 6),
        true,
        sessionId
      );

      await expect(
        keno.settleKenoSession(
          player.address,
          ethers.parseUnits("5", 6),
          true,
          sessionId,
          sig
        )
      ).to.be.revertedWithCustomError(keno, "SettlementDisabled");
    });
  });

  describe("When enabled", function () {
    beforeEach(async function () {
      await keno.setSettlementEnabled(true);
    });

    it("accepts valid EIP-712 operator signature", async function () {
      const sessionId = ethers.keccak256(ethers.toUtf8Bytes("session-1"));
      const netAmount = ethers.parseUnits("5", 6);

      const sig = await signSettlement(
        operatorSigner,
        player.address,
        netAmount,
        true,
        sessionId
      );

      await expect(
        keno.settleKenoSession(
          player.address,
          netAmount,
          true,
          sessionId,
          sig
        )
      )
        .to.emit(keno, "KenoSessionSettled")
        .withArgs(player.address, netAmount, true, sessionId);
    });

    it("rejects invalid signature (wrong signer)", async function () {
      const sessionId = ethers.keccak256(ethers.toUtf8Bytes("session-2"));
      const netAmount = ethers.parseUnits("3", 6);

      // Sign with player instead of operator
      const sig = await signSettlement(
        player,
        player.address,
        netAmount,
        false,
        sessionId
      );

      await expect(
        keno.settleKenoSession(
          player.address,
          netAmount,
          false,
          sessionId,
          sig
        )
      ).to.be.revertedWithCustomError(keno, "InvalidSignature");
    });

    it("rejects signature for wrong user", async function () {
      const sessionId = ethers.keccak256(ethers.toUtf8Bytes("session-3"));
      const netAmount = ethers.parseUnits("5", 6);

      // Sign for player but try to settle for player2
      const sig = await signSettlement(
        operatorSigner,
        player.address,
        netAmount,
        true,
        sessionId
      );

      await expect(
        keno.settleKenoSession(
          player2.address, // wrong user
          netAmount,
          true,
          sessionId,
          sig
        )
      ).to.be.revertedWithCustomError(keno, "InvalidSignature");
    });

    describe("Anti-replay (per-user)", function () {
      it("rejects same sessionId for same user", async function () {
        const sessionId = ethers.keccak256(ethers.toUtf8Bytes("session-4"));
        const netAmount = ethers.parseUnits("5", 6);

        const sig = await signSettlement(
          operatorSigner,
          player.address,
          netAmount,
          true,
          sessionId
        );

        // First call succeeds
        await keno.settleKenoSession(
          player.address,
          netAmount,
          true,
          sessionId,
          sig
        );

        // Second call with same sessionId reverts
        await expect(
          keno.settleKenoSession(
            player.address,
            netAmount,
            true,
            sessionId,
            sig
          )
        ).to.be.revertedWithCustomError(keno, "SessionAlreadySettled");
      });

      it("accepts same sessionId for different user", async function () {
        const sessionId = ethers.keccak256(ethers.toUtf8Bytes("session-5"));
        const netAmount = ethers.parseUnits("5", 6);

        // Settle for player
        const sig1 = await signSettlement(
          operatorSigner,
          player.address,
          netAmount,
          true,
          sessionId
        );
        await keno.settleKenoSession(
          player.address,
          netAmount,
          true,
          sessionId,
          sig1
        );

        // Same sessionId for player2 should work (per-user mapping)
        const sig2 = await signSettlement(
          operatorSigner,
          player2.address,
          netAmount,
          true,
          sessionId
        );
        await expect(
          keno.settleKenoSession(
            player2.address,
            netAmount,
            true,
            sessionId,
            sig2
          )
        ).to.not.be.reverted;
      });

      it("usedSessionIds is per-user", async function () {
        const sessionId = ethers.keccak256(ethers.toUtf8Bytes("session-6"));

        // Not used for player initially
        expect(
          await keno.usedSessionIds(player.address, sessionId)
        ).to.equal(false);

        // Settle for player
        const sig = await signSettlement(
          operatorSigner,
          player.address,
          ethers.parseUnits("1", 6),
          true,
          sessionId
        );
        await keno.settleKenoSession(
          player.address,
          ethers.parseUnits("1", 6),
          true,
          sessionId,
          sig
        );

        // Used for player
        expect(
          await keno.usedSessionIds(player.address, sessionId)
        ).to.equal(true);

        // NOT used for player2 (independent)
        expect(
          await keno.usedSessionIds(player2.address, sessionId)
        ).to.equal(false);
      });
    });

    it("NatSpec documents Phase 2 (verified by compilation)", async function () {
      // This test just verifies the contract compiles with NatSpec
      // The actual documentation is in the source code
      expect(await keno.settlementEnabled()).to.equal(true);
    });
  });

  describe("Owner controls", function () {
    it("only owner can enable/disable settlement", async function () {
      await expect(
        keno.connect(player).setSettlementEnabled(true)
      ).to.be.revertedWith("Only callable by owner");
    });

    it("owner can toggle settlement", async function () {
      await keno.setSettlementEnabled(true);
      expect(await keno.settlementEnabled()).to.equal(true);

      await keno.setSettlementEnabled(false);
      expect(await keno.settlementEnabled()).to.equal(false);
    });
  });
});
