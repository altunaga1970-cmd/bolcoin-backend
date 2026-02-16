// Mock DB and chain modules before importing
jest.mock('../../db', () => ({ query: jest.fn(), connect: jest.fn() }));
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
jest.mock('../../models/User', () => ({}));
jest.mock('../../models/Draw', () => ({}));
jest.mock('../../chain/provider', () => ({
  getLaBolitaContract: jest.fn()
}));
jest.mock('../bankrollService', () => ({
  checkNumberAvailability: jest.fn(),
  canAcceptBet: jest.fn().mockResolvedValue({ available: true, message: 'OK' }),
  registerBetExposure: jest.fn()
}));

const { __mockClient: mockClient } = require('../../config/database');
const bankrollService = require('../bankrollService');
const betService = require('../betService');

describe('betService', () => {
  describe('validateBet', () => {
    it('accepts valid fijos bet', () => {
      expect(() => betService.validateBet({
        game_type: 'fijos',
        number: '34',
        amount: 5
      })).not.toThrow();
    });

    it('accepts valid centenas bet', () => {
      expect(() => betService.validateBet({
        game_type: 'centenas',
        number: '234',
        amount: 10
      })).not.toThrow();
    });

    it('accepts valid parles bet', () => {
      expect(() => betService.validateBet({
        game_type: 'parles',
        number: '1234',
        amount: 2
      })).not.toThrow();
    });

    it('rejects invalid game type', () => {
      expect(() => betService.validateBet({
        game_type: 'invalid',
        number: '34',
        amount: 5
      })).toThrow('Tipo de juego');
    });

    it('rejects missing number', () => {
      expect(() => betService.validateBet({
        game_type: 'fijos',
        number: undefined,
        amount: 5
      })).toThrow('requerido');
    });

    it('rejects non-numeric number', () => {
      expect(() => betService.validateBet({
        game_type: 'fijos',
        number: 'abc',
        amount: 5
      })).toThrow('solo dígitos');
    });

    it('rejects number out of range', () => {
      expect(() => betService.validateBet({
        game_type: 'fijos',
        number: '100',
        amount: 5
      })).toThrow('debe estar entre');
    });

    it('rejects negative amount', () => {
      expect(() => betService.validateBet({
        game_type: 'fijos',
        number: '34',
        amount: -5
      })).toThrow('inválido');
    });

    it('rejects zero amount', () => {
      expect(() => betService.validateBet({
        game_type: 'fijos',
        number: '34',
        amount: 0
      })).toThrow('inválido');
    });
  });

  describe('calculateTotalCost', () => {
    it('sums regular bets', () => {
      const bets = [
        { game_type: 'fijos', amount: 5 },
        { game_type: 'centenas', amount: 10 },
      ];
      expect(betService.calculateTotalCost(bets)).toBe(15);
    });

    it('doubles corrido bets', () => {
      const bets = [
        { game_type: 'corrido', amount: 5 },
      ];
      expect(betService.calculateTotalCost(bets)).toBe(10);
    });

    it('handles mixed types', () => {
      const bets = [
        { game_type: 'fijos', amount: 3 },
        { game_type: 'corrido', amount: 2 },
        { game_type: 'parles', amount: 1 },
      ];
      expect(betService.calculateTotalCost(bets)).toBe(8); // 3 + 4 + 1
    });

    it('handles empty array', () => {
      expect(betService.calculateTotalCost([])).toBe(0);
    });

    it('avoids floating-point errors', () => {
      const bets = [
        { game_type: 'fijos', amount: 0.1 },
        { game_type: 'fijos', amount: 0.2 },
      ];
      expect(betService.calculateTotalCost(bets)).toBe(0.3);
    });

    it('handles many small amounts without drift', () => {
      const bets = Array(100).fill({ game_type: 'fijos', amount: 0.01 });
      expect(betService.calculateTotalCost(bets)).toBe(1);
    });
  });

  describe('placeBets', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      bankrollService.canAcceptBet.mockResolvedValue({ available: true, message: 'OK' });
      bankrollService.registerBetExposure.mockResolvedValue({});
    });

    function setupDbForPlaceBets(balance = 100) {
      mockClient.query
        .mockResolvedValueOnce(null) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 1, balance, version: 1 }] }) // SELECT user FOR UPDATE
        .mockResolvedValueOnce({ rows: [{ id: 1, status: 'open', scheduled_time: new Date() }] }) // SELECT draw
        .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE balance
        .mockResolvedValueOnce({ rows: [{ id: 100, game_type: 'fijos', bet_number: '34', amount: 5 }] }) // INSERT bet
        .mockResolvedValueOnce(null) // registerBetExposure (via bankrollService mock)
        .mockResolvedValueOnce(null); // COMMIT
    }

    it('rejects empty bets array', async () => {
      await expect(betService.placeBets(1, 1, [])).rejects.toThrow('al menos una apuesta');
    });

    it('rejects too many bets', async () => {
      const tooMany = Array(51).fill({ game_type: 'fijos', number: '34', amount: 5 });
      await expect(betService.placeBets(1, 1, tooMany)).rejects.toThrow('Máximo');
    });

    it('rejects when user not found', async () => {
      mockClient.query
        .mockResolvedValueOnce(null) // BEGIN
        .mockResolvedValueOnce({ rows: [] }); // no user

      await expect(
        betService.placeBets(999, 1, [{ game_type: 'fijos', number: '34', amount: 5 }])
      ).rejects.toThrow('no encontrado');
    });

    it('rejects when draw not open', async () => {
      mockClient.query
        .mockResolvedValueOnce(null) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 1, balance: 100, version: 1 }] })
        .mockResolvedValueOnce({ rows: [{ id: 1, status: 'closed' }] }); // closed draw

      await expect(
        betService.placeBets(1, 1, [{ game_type: 'fijos', number: '34', amount: 5 }])
      ).rejects.toThrow('no está abierto');
    });

    it('rejects when balance insufficient', async () => {
      mockClient.query
        .mockResolvedValueOnce(null) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 1, balance: 2, version: 1 }] }) // low balance
        .mockResolvedValueOnce({ rows: [{ id: 1, status: 'open' }] }); // open draw

      await expect(
        betService.placeBets(1, 1, [{ game_type: 'fijos', number: '34', amount: 5 }])
      ).rejects.toThrow('Balance insuficiente');
    });

    it('places valid bet successfully', async () => {
      setupDbForPlaceBets(100);

      const result = await betService.placeBets(1, 1, [
        { game_type: 'fijos', number: '34', amount: 5 }
      ]);

      expect(result.success).toBe(true);
      expect(result.bets).toHaveLength(1);
      expect(result.total_cost).toBe(5);
    });

    it('rolls back on error', async () => {
      mockClient.query
        .mockResolvedValueOnce(null) // BEGIN
        .mockRejectedValueOnce(new Error('DB error'));

      await expect(
        betService.placeBets(1, 1, [{ game_type: 'fijos', number: '34', amount: 5 }])
      ).rejects.toThrow('DB error');

      const rollback = mockClient.query.mock.calls.find(c => c[0] === 'ROLLBACK');
      expect(rollback).toBeDefined();
      expect(mockClient.release).toHaveBeenCalled();
    });
  });
});
