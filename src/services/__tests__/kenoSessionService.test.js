// Tests for kenoSessionService — EIP-712 settlement signing & session flow

// Shared mock client for pool.connect()
const mockClient = {
  query: jest.fn(),
  release: jest.fn()
};

// Mock DB
const mockPool = {
  query: jest.fn(),
  connect: jest.fn().mockResolvedValue(mockClient)
};
jest.mock('../../db', () => mockPool);

// Mock gameConfigService
jest.mock('../gameConfigService', () => ({
  getConfigValue: jest.fn().mockResolvedValue(false)
}));

// Mock ethers — test EIP-712 structure without a real provider
const mockSignTypedData = jest.fn().mockResolvedValue('0xmocksignature');
const mockGetNetwork = jest.fn().mockResolvedValue({ chainId: 31337n });
const mockGetBalance = jest.fn().mockResolvedValue(0n);

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  return {
    ...actual,
    JsonRpcProvider: jest.fn().mockImplementation(() => ({
      getNetwork: mockGetNetwork
    })),
    Wallet: jest.fn().mockImplementation(() => ({
      signTypedData: mockSignTypedData
    })),
    Contract: jest.fn().mockImplementation(() => ({
      getBalance: mockGetBalance,
      settleKenoSession: jest.fn().mockResolvedValue({
        wait: jest.fn().mockResolvedValue({ hash: '0xtxhash' })
      })
    }))
  };
});

// Set env vars before import
process.env.KENO_CONTRACT_ADDRESS = '0x' + 'a'.repeat(40);
process.env.OPERATOR_PRIVATE_KEY = '0x' + 'b'.repeat(64);

const kenoSessionService = require('../kenoSessionService');

describe('kenoSessionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPool.connect.mockResolvedValue(mockClient);
  });

  describe('EIP712_TYPES structure', () => {
    it('contract SETTLE_TYPEHASH matches 4-field structure (no deadline)', () => {
      // Contract: keccak256("SettleKenoSession(address user,uint256 netAmount,bool isProfit,bytes32 sessionId)")
      const ethers = require('ethers');
      const contractTypehashString = 'SettleKenoSession(address user,uint256 netAmount,bool isProfit,bytes32 sessionId)';
      const expectedHash = ethers.keccak256(ethers.toUtf8Bytes(contractTypehashString));

      expect(expectedHash).toMatch(/^0x[0-9a-f]{64}$/);

      // A 5-field typehash with deadline would differ
      const wrongTypehashString = 'SettleKenoSession(address user,uint256 netAmount,bool isProfit,bytes32 sessionId,uint256 deadline)';
      const wrongHash = ethers.keccak256(ethers.toUtf8Bytes(wrongTypehashString));
      expect(expectedHash).not.toBe(wrongHash);
    });
  });

  describe('signSettlement', () => {
    it('signs with 4 fields (no deadline parameter)', async () => {
      expect(kenoSessionService.signSettlement).toBeDefined();

      const ethers = require('ethers');
      const userAddress = '0x' + '1'.repeat(40);
      const netAmountWei = ethers.parseUnits('10.000000', 6);
      const isProfit = true;
      const sessionIdBytes32 = ethers.zeroPadValue(ethers.toBeHex(42), 32);

      // Trigger initContract so signer is set
      await kenoSessionService.getContractBalance('0x0');

      const sig = await kenoSessionService.signSettlement(
        userAddress, netAmountWei, isProfit, sessionIdBytes32
      );

      expect(sig).toBe('0xmocksignature');

      // Verify signTypedData was called with correct structure
      expect(mockSignTypedData).toHaveBeenCalledTimes(1);
      const [domain, types, value] = mockSignTypedData.mock.calls[0];

      // Domain
      expect(domain.name).toBe('KenoGame');
      expect(domain.version).toBe('1');
      expect(domain.verifyingContract).toBe(process.env.KENO_CONTRACT_ADDRESS);

      // Types — must have exactly 4 fields, no deadline
      expect(types.SettleKenoSession).toHaveLength(4);
      const fieldNames = types.SettleKenoSession.map(f => f.name);
      expect(fieldNames).toEqual(['user', 'netAmount', 'isProfit', 'sessionId']);
      expect(fieldNames).not.toContain('deadline');

      // Value — must have exactly 4 keys, no deadline
      expect(Object.keys(value)).toHaveLength(4);
      expect(value.user).toBe(userAddress);
      expect(value.netAmount).toBe(netAmountWei);
      expect(value.isProfit).toBe(true);
      expect(value.sessionId).toBe(sessionIdBytes32);
      expect(value.deadline).toBeUndefined();
    });
  });

  describe('getOrCreateSession', () => {
    it('returns existing active session if one exists', async () => {
      const mockSession = { id: 1, wallet_address: '0xabc', status: 'active' };
      mockPool.query.mockResolvedValueOnce({ rows: [mockSession] });

      const session = await kenoSessionService.getOrCreateSession('0xABC');
      expect(session).toEqual(mockSession);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM keno_sessions'),
        ['0xabc']
      );
    });

    it('creates new session if none exists', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 2, wallet_address: '0xdef', status: 'active' }] });

      const session = await kenoSessionService.getOrCreateSession('0xDEF');
      expect(session.id).toBe(2);
      expect(session.status).toBe('active');
    });
  });

  describe('settleSession', () => {
    it('returns success when no active session exists', async () => {
      mockClient.query
        .mockResolvedValueOnce() // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SELECT ... FOR UPDATE
        .mockResolvedValueOnce(); // ROLLBACK

      const result = await kenoSessionService.settleSession('0xabc');
      expect(result.success).toBe(true);
      expect(result.message).toContain('No active session');
    });

    it('closes empty session without on-chain settlement', async () => {
      mockClient.query
        .mockResolvedValueOnce() // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 1, total_won: '0', total_wagered: '0', games_played: 0 }] })
        .mockResolvedValueOnce() // UPDATE status
        .mockResolvedValueOnce(); // COMMIT

      const result = await kenoSessionService.settleSession('0xabc');
      expect(result.success).toBe(true);
      expect(result.netResult).toBe(0);
    });

    it('settles DB-only when settlement not enabled', async () => {
      const gameConfigService = require('../gameConfigService');
      gameConfigService.getConfigValue.mockResolvedValue(false);

      mockClient.query
        .mockResolvedValueOnce() // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 5, total_won: '50', total_wagered: '30', games_played: 10 }] })
        .mockResolvedValueOnce() // UPDATE users balance
        .mockResolvedValueOnce() // UPDATE keno_sessions settled
        .mockResolvedValueOnce(); // COMMIT

      const result = await kenoSessionService.settleSession('0xabc');
      expect(result.success).toBe(true);
      expect(result.netResult).toBe(20);
      expect(result.txHash).toBeNull();
    });
  });

  describe('getSessionNetResult', () => {
    it('returns zero when no active session', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await kenoSessionService.getSessionNetResult('0xabc');
      expect(result.netResult).toBe(0);
    });

    it('calculates net result correctly', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 1, total_won: '100', total_wagered: '60', games_played: 5 }]
      });

      const result = await kenoSessionService.getSessionNetResult('0xabc');
      expect(result.netResult).toBe(40);
      expect(result.totalWon).toBe(100);
      expect(result.totalWagered).toBe(60);
    });
  });
});
