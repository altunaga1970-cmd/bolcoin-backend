const { calculateBolitaPayout, calculateDrawPrizes } = require('../prizeService');

describe('prizeService', () => {
  describe('calculateBolitaPayout', () => {
    const winningNumber = '1234';

    describe('fijos (last 2 digits = 34)', () => {
      it('pays 65x on match', () => {
        const result = calculateBolitaPayout('fijos', '34', 10, winningNumber);
        expect(result.won).toBe(true);
        expect(result.payout).toBe(650);
        expect(result.multiplier).toBe(65);
      });

      it('no payout on miss', () => {
        const result = calculateBolitaPayout('fijos', '12', 10, winningNumber);
        expect(result.won).toBe(false);
        expect(result.payout).toBe(0);
      });

      it('handles zero-padded numbers', () => {
        const result = calculateBolitaPayout('fijos', '04', 5, '5604');
        expect(result.won).toBe(true);
        expect(result.payout).toBe(325);
      });
    });

    describe('centenas (last 3 digits = 234)', () => {
      it('pays 300x on match', () => {
        const result = calculateBolitaPayout('centenas', '234', 5, winningNumber);
        expect(result.won).toBe(true);
        expect(result.payout).toBe(1500);
        expect(result.multiplier).toBe(300);
      });

      it('no payout on miss', () => {
        const result = calculateBolitaPayout('centenas', '123', 5, winningNumber);
        expect(result.won).toBe(false);
        expect(result.payout).toBe(0);
      });
    });

    describe('parles (all 4 digits = 1234)', () => {
      it('pays 1000x on match', () => {
        const result = calculateBolitaPayout('parles', '1234', 2, winningNumber);
        expect(result.won).toBe(true);
        expect(result.payout).toBe(2000);
        expect(result.multiplier).toBe(1000);
      });

      it('no payout on miss', () => {
        const result = calculateBolitaPayout('parles', '1235', 2, winningNumber);
        expect(result.won).toBe(false);
      });
    });

    it('returns error for invalid game type', () => {
      const result = calculateBolitaPayout('invalid', '34', 10, winningNumber);
      expect(result.won).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('uses integer cents math (no floating-point errors)', () => {
      // $0.33 * 65 = $21.45 exactly
      const result = calculateBolitaPayout('fijos', '34', 0.33, '1234');
      expect(result.payout).toBe(21.45);
    });
  });

  describe('calculateDrawPrizes', () => {
    const winningNumber = '5678';

    it('calculates multiple winners correctly', () => {
      const bets = [
        { id: 1, user_id: 1, game_type: 'fijos', bet_number: '78', amount: 10 },
        { id: 2, user_id: 2, game_type: 'fijos', bet_number: '78', amount: 5 },
        { id: 3, user_id: 3, game_type: 'fijos', bet_number: '12', amount: 10 },
      ];

      const result = calculateDrawPrizes(bets, winningNumber);
      expect(result.winners).toHaveLength(2);
      expect(result.totalPayout).toBe(975); // 10*65 + 5*65
      expect(result.breakdown.fijos.count).toBe(2);
    });

    it('handles no winners', () => {
      const bets = [
        { id: 1, user_id: 1, game_type: 'fijos', bet_number: '12', amount: 10 },
      ];
      const result = calculateDrawPrizes(bets, winningNumber);
      expect(result.winners).toHaveLength(0);
      expect(result.totalPayout).toBe(0);
    });

    it('handles mixed game types', () => {
      const bets = [
        { id: 1, user_id: 1, game_type: 'fijos', bet_number: '78', amount: 1 },
        { id: 2, user_id: 2, game_type: 'centenas', bet_number: '678', amount: 1 },
        { id: 3, user_id: 3, game_type: 'parles', bet_number: '5678', amount: 1 },
      ];
      const result = calculateDrawPrizes(bets, winningNumber);
      expect(result.winners).toHaveLength(3);
      expect(result.totalPayout).toBe(1365); // 65 + 300 + 1000
    });

    it('handles empty bets array', () => {
      const result = calculateDrawPrizes([], '1234');
      expect(result.winners).toHaveLength(0);
      expect(result.totalPayout).toBe(0);
    });
  });
});
