/**
 * Tests for bankrollService
 * Tests pure functions directly, mocks DB for functions that need it.
 */

// Mock DB before importing
jest.mock('../../config/database', () => {
  const mockClient = {
    query: jest.fn(),
    release: jest.fn(),
  };
  return {
    getClient: jest.fn(() => Promise.resolve(mockClient)),
    query: jest.fn(),
    __mockClient: mockClient,
  };
});

const { getClient, query, __mockClient: mockClient } = require('../../config/database');
const bankrollService = require('../bankrollService');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('bankrollService', () => {

  // ── Pure function: calculateNewLimit ──

  describe('calculateNewLimit', () => {
    it('returns minLimit when bankroll and reserve are 0', () => {
      // minLimit from constants = 2
      const result = bankrollService.calculateNewLimit(0, 0);
      expect(result).toBe(2);
    });

    it('increases limit with higher reserve', () => {
      const low = bankrollService.calculateNewLimit(0, 3000);
      const high = bankrollService.calculateNewLimit(0, 9000);
      expect(high).toBeGreaterThan(low);
    });

    it('increases limit with higher bankroll', () => {
      const low = bankrollService.calculateNewLimit(500, 1000);
      const high = bankrollService.calculateNewLimit(5000, 1000);
      expect(high).toBeGreaterThan(low);
    });

    it('never exceeds maxLimit (1000)', () => {
      const result = bankrollService.calculateNewLimit(999999, 999999);
      expect(result).toBeLessThanOrEqual(1000);
    });

    it('never goes below minLimit (2)', () => {
      const result = bankrollService.calculateNewLimit(0.01, 0.01);
      expect(result).toBeGreaterThanOrEqual(2);
    });

    it('rounds to 2 decimal places', () => {
      const result = bankrollService.calculateNewLimit(333, 777);
      const decimals = result.toString().split('.')[1];
      expect(!decimals || decimals.length <= 2).toBe(true);
    });

    it('formula: base from reserve + bonus from bankroll', () => {
      // reserve / 3000 + bankroll / 500
      // 6000 / 3000 + 2500 / 500 = 2 + 5 = 7
      const result = bankrollService.calculateNewLimit(2500, 6000);
      expect(result).toBe(7);
    });
  });

  // ── getBankrollStatus ──

  describe('getBankrollStatus', () => {
    it('returns existing status row', async () => {
      const mockRow = {
        bankroll_balance: 500,
        prize_reserve: 1000,
        current_limit_per_number: 5,
      };
      query.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await bankrollService.getBankrollStatus();
      expect(result).toEqual(mockRow);
    });

    it('creates initial record if none exists', async () => {
      query
        .mockResolvedValueOnce({ rows: [] }) // SELECT returns empty
        .mockResolvedValueOnce({ rows: [] }); // INSERT

      const result = await bankrollService.getBankrollStatus();
      expect(result.bankroll_balance).toBe(0);
      expect(result.prize_reserve).toBe(1000); // initialReserve from constants
      expect(result.current_limit_per_number).toBe(2); // initialLimit
    });
  });

  // ── checkNumberAvailability ──

  describe('checkNumberAvailability', () => {
    it('returns available when number has no exposure', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ current_limit_per_number: 10 }] })
        .mockResolvedValueOnce({ rows: [] }); // no exposure record

      const result = await bankrollService.checkNumberAvailability(1, 'fijos', '34', 5);
      expect(result.available).toBe(true);
      expect(result.availableAmount).toBe(10);
    });

    it('returns unavailable when number is sold out', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ current_limit_per_number: 10 }] })
        .mockResolvedValueOnce({ rows: [{ total_amount: 10, is_sold_out: true }] });

      const result = await bankrollService.checkNumberAvailability(1, 'fijos', '34', 5);
      expect(result.available).toBe(false);
      expect(result.availableAmount).toBe(0);
      expect(result.message).toContain('vendido');
    });

    it('returns unavailable when requested exceeds remaining', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ current_limit_per_number: 10 }] })
        .mockResolvedValueOnce({ rows: [{ total_amount: 8, is_sold_out: false }] });

      const result = await bankrollService.checkNumberAvailability(1, 'fijos', '34', 5);
      expect(result.available).toBe(false);
      expect(result.availableAmount).toBe(2);
      expect(result.message).toContain('Solo puedes apostar');
    });

    it('returns available when amount fits within remaining', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ current_limit_per_number: 10 }] })
        .mockResolvedValueOnce({ rows: [{ total_amount: 3, is_sold_out: false }] });

      const result = await bankrollService.checkNumberAvailability(1, 'fijos', '34', 5);
      expect(result.available).toBe(true);
      expect(result.availableAmount).toBe(7);
    });

    it('releases client even on error', async () => {
      mockClient.query.mockRejectedValueOnce(new Error('DB error'));

      await expect(
        bankrollService.checkNumberAvailability(1, 'fijos', '34', 5)
      ).rejects.toThrow('DB error');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  // ── registerBetExposure ──

  describe('registerBetExposure', () => {
    it('inserts exposure with correct potential payout', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ current_limit_per_number: 10 }] })
        .mockResolvedValueOnce({ rows: [{ total_amount: 5, bets_count: 1 }] });

      const result = await bankrollService.registerBetExposure(mockClient, 1, 'fijos', '34', 5);

      // Verify the INSERT/UPSERT was called
      const upsertCall = mockClient.query.mock.calls[1];
      expect(upsertCall[0]).toContain('INSERT INTO number_exposure');
      // amount param = 5
      expect(upsertCall[1]).toContain(5);
    });

    it('calculates potential payout with correct multiplier for fijos (65x)', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ current_limit_per_number: 10 }] })
        .mockResolvedValueOnce({ rows: [{ total_amount: 5 }] });

      await bankrollService.registerBetExposure(mockClient, 1, 'fijos', '34', 2);

      const upsertCall = mockClient.query.mock.calls[1];
      // potentialPayout = amount * multiplier = 2 * 65 = 130
      // Passed as 6th param (index 5)
      expect(upsertCall[1][5]).toBe(130);
    });
  });

  // ── canAcceptBet ──

  describe('canAcceptBet', () => {
    it('rejects when reserve is insufficient for potential payout', async () => {
      // checkNumberAvailability mock
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ current_limit_per_number: 100 }] }) // limit
        .mockResolvedValueOnce({ rows: [] }) // no exposure
        .mockResolvedValueOnce({ rows: [{ prize_reserve: 50 }] }) // reserve too low
        .mockResolvedValueOnce({ rows: [{ total_exposure: 0 }] }); // current exposure

      const result = await bankrollService.canAcceptBet(1, 'fijos', '34', 5);
      // potentialPayout = 5 * 65 = 325, reserve = 50
      expect(result.available).toBe(false);
      expect(result.message).toContain('reserva insuficiente');
    });

    it('accepts when reserve covers potential payout', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ current_limit_per_number: 100 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ prize_reserve: 500 }] })
        .mockResolvedValueOnce({ rows: [{ total_exposure: 0 }] });

      const result = await bankrollService.canAcceptBet(1, 'fijos', '34', 5);
      // potentialPayout = 5 * 65 = 325, reserve = 500
      expect(result.available).toBe(true);
    });
  });

  // ── settleDrawPool ──

  describe('settleDrawPool', () => {
    it('distributes pool correctly when there is a winner', async () => {
      const bankrollBefore = {
        bankroll_balance: 100,
        prize_reserve: 500,
        current_limit_per_number: 5
      };

      mockClient.query
        .mockResolvedValueOnce(null) // BEGIN
        .mockResolvedValueOnce({ rows: [bankrollBefore] }) // SELECT FOR UPDATE
        .mockResolvedValueOnce(null) // UPDATE bankroll_status
        .mockResolvedValueOnce(null) // INSERT fee transaction
        .mockResolvedValueOnce(null) // INSERT reserve transaction
        .mockResolvedValueOnce(null) // INSERT bankroll transaction
        .mockResolvedValueOnce(null) // INSERT prize payout transaction
        .mockResolvedValueOnce(null) // INSERT draw_settlement
        .mockResolvedValueOnce(null); // COMMIT

      const result = await bankrollService.settleDrawPool(
        1,
        { fijos: '34', centenas: '234', parles: '1234' },
        100, // totalPool
        65   // prizesPaid (1 USDT bet * 65x fijos)
      );

      expect(result.success).toBe(true);
      expect(result.hasWinner).toBe(true);
      expect(result.feeAmount).toBe(5); // 5% of 100
      expect(result.toReserve).toBe(65); // 65% of 100 (with winner)
      expect(result.toBankroll).toBe(30); // 30% of 100 (with winner)
    });

    it('distributes pool correctly when no winner', async () => {
      const bankrollBefore = {
        bankroll_balance: 100,
        prize_reserve: 500,
        current_limit_per_number: 5
      };

      mockClient.query
        .mockResolvedValueOnce(null) // BEGIN
        .mockResolvedValueOnce({ rows: [bankrollBefore] }) // SELECT FOR UPDATE
        .mockResolvedValueOnce(null) // UPDATE bankroll_status
        .mockResolvedValueOnce(null) // INSERT fee transaction
        .mockResolvedValueOnce(null) // INSERT reserve transaction
        .mockResolvedValueOnce(null) // INSERT bankroll transaction
        .mockResolvedValueOnce(null) // INSERT draw_settlement
        .mockResolvedValueOnce(null); // COMMIT

      const result = await bankrollService.settleDrawPool(
        2,
        { fijos: '34', centenas: '234', parles: '1234' },
        100, // totalPool
        0    // prizesPaid = 0 (no winner)
      );

      expect(result.success).toBe(true);
      expect(result.hasWinner).toBe(false);
      expect(result.feeAmount).toBe(5); // 5% of 100
      expect(result.toReserve).toBe(45); // 45% of 100 (no winner)
      expect(result.toBankroll).toBe(50); // 50% of 100 (no winner)
    });

    it('rolls back on error', async () => {
      mockClient.query
        .mockResolvedValueOnce(null) // BEGIN
        .mockRejectedValueOnce(new Error('DB error')); // SELECT fails

      await expect(
        bankrollService.settleDrawPool(1, {}, 100, 0)
      ).rejects.toThrow('DB error');

      // Verify ROLLBACK was called
      const rollbackCall = mockClient.query.mock.calls.find(
        call => typeof call[0] === 'string' && call[0] === 'ROLLBACK'
      );
      expect(rollbackCall).toBeDefined();
    });
  });

  // ── initializeCapital ──

  describe('initializeCapital', () => {
    it('creates initial record when system is fresh', async () => {
      mockClient.query
        .mockResolvedValueOnce(null) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // no existing record
        .mockResolvedValueOnce(null) // INSERT bankroll_status
        .mockResolvedValueOnce(null) // INSERT bankroll_transactions
        .mockResolvedValueOnce(null); // COMMIT

      const result = await bankrollService.initializeCapital(1000);
      expect(result.success).toBe(true);
      expect(result.initialReserve).toBe(1000);
      expect(result.initialLimit).toBe(2);
    });

    it('throws if system already initialized', async () => {
      mockClient.query
        .mockResolvedValueOnce(null) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }); // existing record

      await expect(
        bankrollService.initializeCapital(1000)
      ).rejects.toThrow('ya está inicializado');
    });
  });

  // ── adjustCapital ──

  describe('adjustCapital', () => {
    it('adjusts reserve and recalculates limit', async () => {
      mockClient.query
        .mockResolvedValueOnce(null) // BEGIN
        .mockResolvedValueOnce({ rows: [{
          prize_reserve: 500,
          bankroll_balance: 100,
          current_limit_per_number: 5
        }] }) // SELECT FOR UPDATE
        .mockResolvedValueOnce(null) // UPDATE balance
        .mockResolvedValueOnce(null) // UPDATE limit
        .mockResolvedValueOnce(null) // INSERT transaction
        .mockResolvedValueOnce(null); // COMMIT

      const result = await bankrollService.adjustCapital('reserve', 200, 'top-up', 'admin1');
      expect(result.success).toBe(true);
      expect(result.balanceBefore).toBe(500);
      expect(result.balanceAfter).toBe(700);
    });

    it('rejects negative resulting balance', async () => {
      mockClient.query
        .mockResolvedValueOnce(null) // BEGIN
        .mockResolvedValueOnce({ rows: [{
          prize_reserve: 100,
          bankroll_balance: 50,
          current_limit_per_number: 3
        }] });

      await expect(
        bankrollService.adjustCapital('reserve', -200, 'withdraw', 'admin1')
      ).rejects.toThrow('balance negativo');
    });

    it('rejects invalid fund target', async () => {
      mockClient.query
        .mockResolvedValueOnce(null) // BEGIN
        .mockResolvedValueOnce({ rows: [{
          prize_reserve: 100,
          bankroll_balance: 50
        }] });

      await expect(
        bankrollService.adjustCapital('invalid', 100, 'test', 'admin1')
      ).rejects.toThrow('Fondo inválido');
    });
  });
});
