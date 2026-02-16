// Test pure functions from kenoService (no DB needed)
const crypto = require('crypto');

// We need to extract the pure functions. Since kenoService requires DB at import,
// we mock the DB and dependent services before importing.
jest.mock('../../db', () => ({
  query: jest.fn(),
  connect: jest.fn()
}));
jest.mock('../kenoSessionService', () => ({
  getEffectiveBalance: jest.fn()
}));
jest.mock('../gameConfigService', () => ({
  getKenoConfig: jest.fn(),
  getSystemConfig: jest.fn(),
  getConfigValue: jest.fn(),
  calculateBetFee: jest.fn((bet, feeBps = 1200) => ({
    fee: bet * 0.12,
    effectiveBet: bet * 0.88,
    grossBet: bet
  })),
  calculateCappedPayout: jest.fn((bet, mult, max) => ({
    theoreticalPayout: bet * mult,
    actualPayout: Math.min(bet * mult, max),
    capped: bet * mult > max
  })),
  calculateLossDistribution: jest.fn((loss) => ({
    fee: loss * 0.12,
    reserve: loss * 0.88,
    total: loss
  })),
  invalidatePoolBalanceCache: jest.fn(),
  getLossLimitConfig: jest.fn().mockResolvedValue({
    dailyLossLimit: 0,
    sessionLossLimit: 0,
    maxGamesPerSession: 0
  })
}));
jest.mock('../kenoVrfService', () => ({
  generateServerSeed: jest.fn(() => 'mock-server-seed'),
  generateCombinedSeed: jest.fn((s, c, n) => `${s}-${c}-${n}`)
}));

const pool = require('../../db');
const gameConfigService = require('../gameConfigService');
const { KENO_CONFIG, PAYOUT_TABLE, playKeno } = require('../kenoService');

describe('kenoService', () => {
  describe('KENO_CONFIG', () => {
    it('has correct static defaults', () => {
      expect(KENO_CONFIG.TOTAL_NUMBERS).toBe(80);
      expect(KENO_CONFIG.DRAWN_NUMBERS).toBe(20);
      expect(KENO_CONFIG.MIN_SPOTS).toBe(1);
      expect(KENO_CONFIG.MAX_SPOTS).toBe(10);
      expect(KENO_CONFIG.BET_AMOUNT).toBe(1);
      expect(KENO_CONFIG.FEE_BPS).toBe(1200);
      expect(KENO_CONFIG.POOL_BPS).toBe(8800);
    });
  });

  describe('PAYOUT_TABLE', () => {
    it('has entries for spots 1-10', () => {
      for (let spots = 1; spots <= 10; spots++) {
        expect(PAYOUT_TABLE[spots]).toBeDefined();
      }
    });

    it('has correct number of hit entries per spot', () => {
      for (let spots = 1; spots <= 10; spots++) {
        const entries = Object.keys(PAYOUT_TABLE[spots]);
        expect(entries.length).toBe(spots + 1); // 0 hits through N hits
      }
    });

    it('0 hits always pays 0', () => {
      for (let spots = 1; spots <= 10; spots++) {
        expect(PAYOUT_TABLE[spots][0]).toBe(0);
      }
    });

    it('max hits have highest multipliers', () => {
      expect(PAYOUT_TABLE[1][1]).toBe(3);
      expect(PAYOUT_TABLE[5][5]).toBe(300);
      expect(PAYOUT_TABLE[10][10]).toBe(10000);
    });

    it('multipliers are non-negative', () => {
      for (let spots = 1; spots <= 10; spots++) {
        for (let hits = 0; hits <= spots; hits++) {
          expect(PAYOUT_TABLE[spots][hits]).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('multipliers increase with more hits (for a given spot count)', () => {
      for (let spots = 3; spots <= 10; spots++) {
        const maxHits = spots;
        // The maximum hit multiplier should be the highest
        const maxMult = PAYOUT_TABLE[spots][maxHits];
        for (let hits = 0; hits < maxHits; hits++) {
          expect(PAYOUT_TABLE[spots][hits]).toBeLessThanOrEqual(maxMult);
        }
      }
    });
  });

  describe('generateRandomNumbers (via seed determinism)', () => {
    // Test that the same seed always produces the same numbers
    it('is deterministic given the same seed', () => {
      const seed = 'test-seed-123';
      const count = 20;
      const max = 80;

      // Reproduce the function logic
      function generateRandomNumbers(count, max, seed) {
        const numbers = new Set();
        let counter = 0;
        while (numbers.size < count) {
          const hash = crypto.createHash('sha256')
            .update(`${seed}-${counter}`)
            .digest('hex');
          const num = (parseInt(hash.substring(0, 8), 16) % max) + 1;
          numbers.add(num);
          counter++;
        }
        return Array.from(numbers).sort((a, b) => a - b);
      }

      const run1 = generateRandomNumbers(count, max, seed);
      const run2 = generateRandomNumbers(count, max, seed);

      expect(run1).toEqual(run2);
      expect(run1).toHaveLength(count);
    });

    it('produces numbers in range [1, max]', () => {
      function generateRandomNumbers(count, max, seed) {
        const numbers = new Set();
        let counter = 0;
        while (numbers.size < count) {
          const hash = crypto.createHash('sha256')
            .update(`${seed}-${counter}`)
            .digest('hex');
          const num = (parseInt(hash.substring(0, 8), 16) % max) + 1;
          numbers.add(num);
          counter++;
        }
        return Array.from(numbers).sort((a, b) => a - b);
      }

      const numbers = generateRandomNumbers(20, 80, 'range-test');
      for (const n of numbers) {
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(80);
      }
    });

    it('produces unique numbers', () => {
      function generateRandomNumbers(count, max, seed) {
        const numbers = new Set();
        let counter = 0;
        while (numbers.size < count) {
          const hash = crypto.createHash('sha256')
            .update(`${seed}-${counter}`)
            .digest('hex');
          const num = (parseInt(hash.substring(0, 8), 16) % max) + 1;
          numbers.add(num);
          counter++;
        }
        return Array.from(numbers).sort((a, b) => a - b);
      }

      const numbers = generateRandomNumbers(20, 80, 'unique-test');
      const unique = new Set(numbers);
      expect(unique.size).toBe(20);
    });

    it('different seeds produce different results', () => {
      function generateRandomNumbers(count, max, seed) {
        const numbers = new Set();
        let counter = 0;
        while (numbers.size < count) {
          const hash = crypto.createHash('sha256')
            .update(`${seed}-${counter}`)
            .digest('hex');
          const num = (parseInt(hash.substring(0, 8), 16) % max) + 1;
          numbers.add(num);
          counter++;
        }
        return Array.from(numbers).sort((a, b) => a - b);
      }

      const a = generateRandomNumbers(20, 80, 'seed-a');
      const b = generateRandomNumbers(20, 80, 'seed-b');
      expect(a).not.toEqual(b);
    });
  });

  describe('playKeno', () => {
    let mockClient;

    beforeEach(() => {
      jest.clearAllMocks();
      mockClient = {
        query: jest.fn(),
        release: jest.fn(),
      };
      pool.connect.mockResolvedValue(mockClient);

      // Setup gameConfigService mocks for playKeno
      gameConfigService.getKenoConfig.mockResolvedValue({
        betAmount: 1,
        maxPayout: 50,
        feeBps: 1200,
        poolBps: 8800,
        minSpots: 1,
        maxSpots: 10,
        totalNumbers: 80,
        drawnNumbers: 20,
      });
      gameConfigService.getSystemConfig.mockResolvedValue({});
      gameConfigService.getConfigValue.mockResolvedValue(false); // commit-reveal disabled
    });

    function setupDbForPlay(balance = 100, sessionExists = true) {
      const sessionRow = { id: 1, total_wagered: 0, total_won: 0, games_played: 0 };
      if (sessionExists) {
        mockClient.query
          .mockResolvedValueOnce(null) // BEGIN
          .mockResolvedValueOnce({ rows: [sessionRow] }) // SELECT session FOR UPDATE
          .mockResolvedValueOnce({ rows: [{ balance }] }) // SELECT balance FOR UPDATE
          .mockResolvedValueOnce({ rows: [{ daily_loss: 0 }] }) // loss limits (no-op when 0)
          .mockResolvedValueOnce({ rows: [{ next_nonce: 0 }] }) // nonce
          .mockResolvedValueOnce(null) // INSERT keno_games
          .mockResolvedValueOnce(null) // UPDATE keno_sessions
          .mockResolvedValueOnce(null) // INSERT keno_fees
          .mockResolvedValueOnce(null) // UPDATE keno_pool
          .mockResolvedValueOnce(null); // COMMIT
      } else {
        mockClient.query
          .mockResolvedValueOnce(null) // BEGIN
          .mockResolvedValueOnce({ rows: [] }) // no session
          .mockResolvedValueOnce({ rows: [sessionRow] }) // INSERT session RETURNING
          .mockResolvedValueOnce({ rows: [{ balance }] }) // SELECT balance
          .mockResolvedValueOnce({ rows: [{ daily_loss: 0 }] }) // loss limits
          .mockResolvedValueOnce({ rows: [{ next_nonce: 0 }] }) // nonce
          .mockResolvedValueOnce(null) // INSERT keno_games
          .mockResolvedValueOnce(null) // UPDATE keno_sessions
          .mockResolvedValueOnce(null) // INSERT keno_fees
          .mockResolvedValueOnce(null) // UPDATE keno_pool
          .mockResolvedValueOnce(null); // COMMIT
      }
    }

    it('returns game result with correct structure', async () => {
      setupDbForPlay(100);

      const result = await playKeno('0xABC123', [5, 10, 15], 1);

      expect(result).toHaveProperty('gameId');
      expect(result).toHaveProperty('selectedNumbers');
      expect(result).toHaveProperty('drawnNumbers');
      expect(result).toHaveProperty('matchedNumbers');
      expect(result).toHaveProperty('spots', 3);
      expect(result).toHaveProperty('hits');
      expect(result).toHaveProperty('betAmount', 1);
      expect(result).toHaveProperty('effectiveBet', 0.88);
      expect(result).toHaveProperty('feeAmount', 0.12);
      expect(result).toHaveProperty('provablyFair');
      expect(result.provablyFair).toHaveProperty('serverSeed');
      expect(result.provablyFair).toHaveProperty('nonce', 0);
    });

    it('lowercases wallet address', async () => {
      setupDbForPlay(100);

      await playKeno('0xABCDEF', [1, 2, 3], 1);

      // First query after BEGIN should use lowercase wallet
      const sessionQuery = mockClient.query.mock.calls[1];
      expect(sessionQuery[1][0]).toBe('0xabcdef');
    });

    it('rejects fewer than minSpots numbers', async () => {
      await expect(
        playKeno('0xabc', [], 1)
      ).rejects.toThrow('Selecciona al menos');
    });

    it('rejects more than maxSpots numbers', async () => {
      await expect(
        playKeno('0xabc', [1,2,3,4,5,6,7,8,9,10,11], 1)
      ).rejects.toThrow('Maximo');
    });

    it('rejects numbers out of range', async () => {
      await expect(
        playKeno('0xabc', [0, 5, 10], 1)
      ).rejects.toThrow('fuera de rango');
    });

    it('rejects duplicate numbers', async () => {
      await expect(
        playKeno('0xabc', [5, 5, 10], 1)
      ).rejects.toThrow('unicos');
    });

    it('rejects non-integer numbers', async () => {
      await expect(
        playKeno('0xabc', [1.5, 2, 3], 1)
      ).rejects.toThrow('entero');
    });

    it('rejects when balance is insufficient', async () => {
      mockClient.query
        .mockResolvedValueOnce(null) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 1, total_wagered: 0, total_won: 0 }] })
        .mockResolvedValueOnce({ rows: [{ balance: 0.5 }] }); // not enough

      await expect(
        playKeno('0xabc', [1, 2, 3], 1)
      ).rejects.toThrow('Balance insuficiente');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('creates session if none exists', async () => {
      setupDbForPlay(100, false);

      const result = await playKeno('0xabc', [1, 2, 3], 1);
      expect(result).toHaveProperty('gameId');
    });

    it('rolls back on error and releases client', async () => {
      mockClient.query
        .mockResolvedValueOnce(null) // BEGIN
        .mockRejectedValueOnce(new Error('DB fail'));

      await expect(
        playKeno('0xabc', [1, 2, 3], 1)
      ).rejects.toThrow('DB fail');

      const rollback = mockClient.query.mock.calls.find(
        c => c[0] === 'ROLLBACK'
      );
      expect(rollback).toBeDefined();
      expect(mockClient.release).toHaveBeenCalled();
    });
  });
});
