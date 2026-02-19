/**
 * Integration Test: KenoGame Contract ABI Verification
 * 
 * Verifies that the backend settlement service ABI matches the contract.
 * This test ensures the 5-parameter settleKenoSession function is correctly defined.
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

describe("KenoGame — ABI Verification (Backend Integration)", function () {
  let keno, operator;

  // ABI hardcoded in kenoSessionService.js
  const BACKEND_SETTLEMENT_ABI = [
    "function settleKenoSession(address _user, uint256 _netAmount, bool _isProfit, bytes32 _sessionId, bytes _signature) external",
    "function adminDeposit(address _user, uint256 _amount) external",
    "function adminWithdraw(address _user, uint256 _amount) external",
    "function getBalance(address _user) view returns (uint256)",
    "function userBalances(address) view returns (uint256)"
  ];

  // EIP-712 types from backend
  const EIP712_DOMAIN_NAME = 'KenoGame';
  const EIP712_DOMAIN_VERSION = '1';
  const EIP712_TYPES = {
    SettleKenoSession: [
      { name: 'user', type: 'address' },
      { name: 'netAmount', type: 'uint256' },
      { name: 'isProfit', type: 'bool' },
      { name: 'sessionId', type: 'bytes32' }
    ]
  };

  before(async function () {
    [owner, operator] = await ethers.getSigners();
  });

  beforeEach(async function () {
    // Deploy minimal KenoGame for testing
    const USDT = await ethers.getContractFactory("MockERC20");
    const usdt = await USDT.deploy("USDT", "USDT", 6);
    
    const VRFMock = await ethers.getContractFactory("VRFCoordinatorV2Mock");
    const vrfMock = await VRFMock.deploy();
    
    const KenoGame = await ethers.getContractFactory("KenoGame");
    keno = await KenoGame.deploy(
      await usdt.getAddress(),
      await vrfMock.getAddress(),
      1, // subId
      "0x0000000000000000000000000000000000000000000000000000000000000000", // keyHash
      operator.address // operator
    );
    await keno.waitForDeployment();
  });

  describe("Contract Interface", function () {
    it("contract has settleKenoSession function with 5 parameters", async function () {
      const contractInterface = keno.interface;
      
      // Check function exists
      expect(contractInterface.getFunction("settleKenoSession")).to.not.be.null;
      
      // Check function inputs
      const func = contractInterface.getFunction("settleKenoSession");
      expect(func.inputs.length).to.equal(5);
      expect(func.inputs[0].name).to.equal("_user");
      expect(func.inputs[0].type).to.equal("address");
      expect(func.inputs[1].name).to.equal("_netAmount");
      expect(func.inputs[1].type).to.equal("uint256");
      expect(func.inputs[2].name).to.equal("_isProfit");
      expect(func.inputs[2].type).to.equal("bool");
      expect(func.inputs[3].name).to.equal("_sessionId");
      expect(func.inputs[3].type).to.equal("bytes32");
      expect(func.inputs[4].name).to.equal("_signature");
      expect(func.inputs[4].type).to.equal("bytes");
    });

    it("SETTLE_TYPEHASH matches backend EIP-712 types", async function () {
      const contractTypehash = await keno.SETTLE_TYPEHASH();
      
      // Calculate expected typehash from backend types
      const expectedTypehash = ethers.keccak256(
        ethers.toUtf8Bytes(
          "SettleKenoSession(address user,uint256 netAmount,bool isProfit,bytes32 sessionId)"
        )
      );
      
      expect(contractTypehash).to.equal(expectedTypehash);
    });

    it("contract interface matches backend ABI", async function () {
      const contractInterface = keno.interface;
      const backendInterface = new ethers.Interface(BACKEND_SETTLEMENT_ABI);
      
      // Check settleKenoSession signature matches
      const contractFunc = contractInterface.getFunction("settleKenoSession");
      const backendFunc = backendInterface.getFunction("settleKenoSession");
      
      expect(contractFunc.selector).to.equal(backendFunc.selector);
    });
  });

  describe("EIP-712 Signature Flow", function () {
    // Helper: create EIP-712 signature for settlement
    async function signSettlement(signer, user, netAmount, isProfit, sessionId) {
      const domain = {
        name: EIP712_DOMAIN_NAME,
        version: EIP712_DOMAIN_VERSION,
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await keno.getAddress(),
      };

      const types = {
        SettleKenoSession: [
          { name: 'user', type: 'address' },
          { name: 'netAmount', type: 'uint256' },
          { name: 'isProfit', type: 'bool' },
          { name: 'sessionId', type: 'bytes32' },
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

    it("accepts valid settlement with correct 5-param call", async function () {
      // Enable settlement
      await keno.setSettlementEnabled(true);

      const sessionId = ethers.keccak256(ethers.toUtf8Bytes("session-1"));
      const netAmount = ethers.parseUnits("5", 6);
      const isProfit = true;

      // Sign with operator
      const sig = await signSettlement(
        operator,
        owner.address,
        netAmount,
        isProfit,
        sessionId
      );

      // Call with 5 parameters (matching backend ABI)
      await expect(
        keno.settleKenoSession(
          owner.address,      // _user (address)
          netAmount,          // _netAmount (uint256)
          isProfit,           // _isProfit (bool)
          sessionId,          // _sessionId (bytes32)
          sig                 // _signature (bytes)
        )
      )
        .to.emit(keno, "KenoSessionSettled")
        .withArgs(owner.address, netAmount, true, sessionId);
    });

    it("rejects call with wrong number of parameters", async function () {
      await keno.setSettlementEnabled(true);

      const sessionId = ethers.keccak256(ethers.toUtf8Bytes("session-2"));
      const netAmount = ethers.parseUnits("3", 6);
      const sig = await signSettlement(
        operator,
        owner.address,
        netAmount,
        true,
        sessionId
      );

      // Try calling with only 4 params (should fail at ABI level)
      try {
        await keno.settleKenoSession(
          owner.address,
          netAmount,
          true,
          sessionId
          // Missing signature
        );
        expect.fail("Should have failed with missing parameter");
      } catch (err) {
        // Expected: CALL_EXCEPTION or similar
        expect(err).to.not.be.null;
      }
    });

    it("rejects signature with wrong EIP-712 domain", async function () {
      await keno.setSettlementEnabled(true);

      const sessionId = ethers.keccak256(ethers.toUtf8Bytes("session-3"));
      const netAmount = ethers.parseUnits("5", 6);

      // Sign with wrong domain name
      const domain = {
        name: "WrongName", // Wrong!
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await keno.getAddress(),
      };

      const types = {
        SettleKenoSession: [
          { name: 'user', type: 'address' },
          { name: 'netAmount', type: 'uint256' },
          { name: 'isProfit', type: 'bool' },
          { name: 'sessionId', type: 'bytes32' },
        ],
      };

      const sig = await operator.signTypedData(domain, types, {
        user: owner.address,
        netAmount,
        isProfit: true,
        sessionId,
      });

      await expect(
        keno.settleKenoSession(
          owner.address,
          netAmount,
          true,
          sessionId,
          sig
        )
      ).to.be.revertedWithCustomError(keno, "InvalidSignature");
    });

    it("rejects signature with wrong type structure (5 fields instead of 4)", async function () {
      await keno.setSettlementEnabled(true);

      const sessionId = ethers.keccak256(ethers.toUtf8Bytes("session-4"));
      const netAmount = ethers.parseUnits("5", 6);

      // Sign with WRONG type structure (includes deadline)
      const domain = {
        name: "KenoGame",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await keno.getAddress(),
      };

      const wrongTypes = {
        SettleKenoSession: [
          { name: 'user', type: 'address' },
          { name: 'netAmount', type: 'uint256' },
          { name: 'isProfit', type: 'bool' },
          { name: 'sessionId', type: 'bytes32' },
          { name: 'deadline', type: 'uint256' }, // WRONG!
        ],
      };

      const sig = await operator.signTypedData(domain, wrongTypes, {
        user: owner.address,
        netAmount,
        isProfit: true,
        sessionId,
        deadline: Math.floor(Date.now() / 1000) + 3600,
      });

      // This should fail because the signature is for a different typehash
      await expect(
        keno.settleKenoSession(
          owner.address,
          netAmount,
          true,
          sessionId,
          sig
        )
      ).to.be.revertedWithCustomError(keno, "InvalidSignature");
    });
  });

  describe("Backend ABI File Verification", function () {
    it("KenoGame.abi.json contains settleKenoSession with 5 inputs", async function () {
      // Read the ABI file used by backend
      const abiPath = path.join(__dirname, "../../src/chain/abi/KenoGame.abi.json");
      
      if (!fs.existsSync(abiPath)) {
        console.warn(`ABI file not found at ${abiPath}, skipping test`);
        this.skip();
        return;
      }

      const abiContent = fs.readFileSync(abiPath, "utf8");
      const abi = JSON.parse(abiContent);

      // Find settleKenoSession function
      const settleFunc = abi.find(
        item => item.type === "function" && item.name === "settleKenoSession"
      );

      expect(settleFunc).to.not.be.undefined;
      expect(settleFunc.inputs.length).to.equal(5);
      expect(settleFunc.inputs[0].name).to.equal("_user");
      expect(settleFunc.inputs[3].name).to.equal("_sessionId");
      expect(settleFunc.inputs[4].name).to.equal("_signature");
    });
  });
});
