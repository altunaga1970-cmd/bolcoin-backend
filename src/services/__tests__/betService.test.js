// Mock DB and chain modules before importing
jest.mock('../../db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../../config/database', () => ({
  getClient: jest.fn(),
  query: jest.fn()
}));
jest.mock('../../models/User', () => ({}));
jest.mock('../../models/Draw', () => ({}));
jest.mock('../../chain/provider', () => ({
  getLaBolitaContract: jest.fn()
}));
jest.mock('../bankrollService', () => ({
  checkNumberAvailability: jest.fn(),
  registerBetExposure: jest.fn()
}));

// Now we can require the module — only pure functions will work without DB
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
});
