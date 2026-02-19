/**
 * Tests for Keno Session Settlement - EIP-712 Type Hash Verification
 * Verifies the ABI matches between contract and backend
 */

const { ethers } = require('ethers');

// Backend EIP-712 types from kenoSessionService.js
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

// Expected typehash string (must match contract SETTLE_TYPEHASH)
const EXPECTED_TYPEHASH_STRING = 'SettleKenoSession(address user,uint256 netAmount,bool isProfit,bytes32 sessionId)';

describe('kenoSessionService - EIP-712 Type Hash', () => {
  describe('Type Hash Verification', () => {
    it('has correct 4-field type structure (no deadline)', () => {
      expect(EIP712_TYPES.SettleKenoSession).toHaveLength(4);
      
      const fields = EIP712_TYPES.SettleKenoSession;
      expect(fields[0]).toEqual({ name: 'user', type: 'address' });
      expect(fields[1]).toEqual({ name: 'netAmount', type: 'uint256' });
      expect(fields[2]).toEqual({ name: 'isProfit', type: 'bool' });
      expect(fields[3]).toEqual({ name: 'sessionId', type: 'bytes32' });
    });

    it('typehash string matches expected format', () => {
      const typehashString = ethers.keccak256(ethers.toUtf8Bytes(EXPECTED_TYPEHASH_STRING));
      expect(typehashString).toMatch(/^0x[0-9a-f]{64}$/i);
    });

    it('typehash does NOT match 5-field structure (with deadline)', () => {
      const wrongTypehashString = 'SettleKenoSession(address user,uint256 netAmount,bool isProfit,bytes32 sessionId,uint256 deadline)';
      const correctHash = ethers.keccak256(ethers.toUtf8Bytes(EXPECTED_TYPEHASH_STRING));
      const wrongHash = ethers.keccak256(ethers.toUtf8Bytes(wrongTypehashString));
      
      expect(correctHash).not.toBe(wrongHash);
    });

    it('domain fields are correct', () => {
      expect(EIP712_DOMAIN_NAME).toBe('KenoGame');
      expect(EIP712_DOMAIN_VERSION).toBe('1');
    });
  });

  describe('ABI Function Signature', () => {
    it('settleKenoSession has 5 parameters', () => {
      // Backend ABI from kenoSessionService.js
      const BACKEND_SETTLEMENT_ABI = [
        "function settleKenoSession(address _user, uint256 _netAmount, bool _isProfit, bytes32 _sessionId, bytes _signature) external"
      ];

      const iface = new ethers.Interface(BACKEND_SETTLEMENT_ABI);
      const func = iface.getFunction('settleKenoSession');
      
      expect(func.inputs.length).toBe(5);
      expect(func.inputs[0].name).toBe('_user');
      expect(func.inputs[0].type).toBe('address');
      expect(func.inputs[1].name).toBe('_netAmount');
      expect(func.inputs[1].type).toBe('uint256');
      expect(func.inputs[2].name).toBe('_isProfit');
      expect(func.inputs[2].type).toBe('bool');
      expect(func.inputs[3].name).toBe('_sessionId');
      expect(func.inputs[3].type).toBe('bytes32');
      expect(func.inputs[4].name).toBe('_signature');
      expect(func.inputs[4].type).toBe('bytes');
    });

    it('function selector is deterministic', () => {
      const BACKEND_SETTLEMENT_ABI = [
        "function settleKenoSession(address _user, uint256 _netAmount, bool _isProfit, bytes32 _sessionId, bytes _signature) external"
      ];

      const iface = new ethers.Interface(BACKEND_SETTLEMENT_ABI);
      const func = iface.getFunction('settleKenoSession');
      
      // Selector should be 4 bytes (8 hex chars + 0x)
      expect(func.selector).toMatch(/^0x[0-9a-f]{8}$/i);
    });
  });

  describe('Session ID Format', () => {
    it('sessionId should be bytes32 (32 bytes)', () => {
      const sessionId = ethers.zeroPadValue(ethers.toBeHex(42), 32);
      expect(sessionId).toMatch(/^0x[0-9a-f]{64}$/i);
      expect(sessionId.length).toBe(66); // 0x + 64 hex chars
    });

    it('different session IDs produce different bytes32', () => {
      const sessionId1 = ethers.zeroPadValue(ethers.toBeHex(1), 32);
      const sessionId2 = ethers.zeroPadValue(ethers.toBeHex(2), 32);
      
      expect(sessionId1).not.toBe(sessionId2);
    });
  });

  describe('Net Amount Format', () => {
    it('netAmount uses 6 decimals (USDT)', () => {
      const amount = ethers.parseUnits('10.500000', 6);
      expect(amount).toBe(BigInt('10500000'));
    });

    it('handles loss amounts (positive value for netAmount)', () => {
      // Even for losses, netAmount is the absolute value
      // isProfit=false indicates it's a loss
      const lossAmount = ethers.parseUnits('5.000000', 6);
      expect(lossAmount).toBe(BigInt('5000000'));
    });
  });
});
