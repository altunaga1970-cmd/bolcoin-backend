const {
  calculateBetFee,
  calculateLossDistribution,
  calculateCappedPayout,
  shouldChargeFee,
  MVP_DEFAULTS
} = require('../gameConfigService');

describe('gameConfigService', () => {
  describe('calculateBetFee', () => {
    it('splits a $1 bet into 12% fee and $0.88 effective bet', () => {
      const result = calculateBetFee(1, 1200);
      expect(result.fee).toBeCloseTo(0.12, 6);
      expect(result.effectiveBet).toBeCloseTo(0.88, 6);
      expect(result.grossBet).toBe(1);
      expect(result.fee + result.effectiveBet).toBeCloseTo(1, 6);
    });

    it('handles fractional bets without floating-point drift', () => {
      const result = calculateBetFee(0.33, 1200);
      expect(result.fee + result.effectiveBet).toBeCloseTo(0.33, 6);
      expect(result.fee).toBeGreaterThanOrEqual(0);
      expect(result.effectiveBet).toBeGreaterThanOrEqual(0);
    });

    it('handles large bets', () => {
      const result = calculateBetFee(10000, 1200);
      expect(result.fee).toBeCloseTo(1200, 2);
      expect(result.effectiveBet).toBeCloseTo(8800, 2);
      expect(result.grossBet).toBe(10000);
    });

    it('fee + effectiveBet always equals grossBet', () => {
      const amounts = [0.01, 0.1, 0.33, 0.99, 1, 2.5, 7.77, 100, 999.99];
      for (const amount of amounts) {
        const result = calculateBetFee(amount);
        expect(result.fee + result.effectiveBet).toBeCloseTo(amount, 5);
      }
    });

    it('fee is always <= grossBet', () => {
      for (let i = 0; i < 100; i++) {
        const bet = Math.random() * 1000;
        const result = calculateBetFee(bet);
        expect(result.fee).toBeLessThanOrEqual(bet);
        expect(result.effectiveBet).toBeLessThanOrEqual(bet);
      }
    });

    it('handles zero bet', () => {
      const result = calculateBetFee(0);
      expect(result.fee).toBe(0);
      expect(result.effectiveBet).toBe(0);
      expect(result.grossBet).toBe(0);
    });
  });

  describe('calculateLossDistribution (deprecated)', () => {
    it('still works for backward compatibility', () => {
      const result = calculateLossDistribution(1, 1200, 8800);
      expect(result.fee).toBeCloseTo(0.12, 6);
      expect(result.reserve).toBeCloseTo(0.88, 6);
      expect(result.total).toBe(1);
    });
  });

  describe('calculateCappedPayout', () => {
    it('returns uncapped payout when below max (effective bet)', () => {
      // With $0.88 effective bet, 3x = $2.64
      const result = calculateCappedPayout(0.88, 3, 50);
      expect(result.theoreticalPayout).toBeCloseTo(2.64, 2);
      expect(result.actualPayout).toBeCloseTo(2.64, 2);
      expect(result.capped).toBe(false);
    });

    it('caps payout at maxPayout', () => {
      const result = calculateCappedPayout(0.88, 10000, 50);
      expect(result.theoreticalPayout).toBeCloseTo(8800, 2);
      expect(result.actualPayout).toBe(50);
      expect(result.capped).toBe(true);
    });

    it('returns zero for zero multiplier', () => {
      const result = calculateCappedPayout(0.88, 0, 50);
      expect(result.theoreticalPayout).toBe(0);
      expect(result.actualPayout).toBe(0);
      expect(result.capped).toBe(false);
    });

    it('handles exact max boundary', () => {
      const result = calculateCappedPayout(1, 50, 50);
      expect(result.actualPayout).toBe(50);
      expect(result.capped).toBe(false);
    });
  });

  describe('shouldChargeFee', () => {
    it('always charges fee (on every bet)', () => {
      expect(shouldChargeFee(-1)).toBe(true);
      expect(shouldChargeFee(0)).toBe(true);
      expect(shouldChargeFee(1)).toBe(true);
      expect(shouldChargeFee(100)).toBe(true);
    });
  });

  describe('MVP_DEFAULTS', () => {
    it('has expected keno config', () => {
      expect(MVP_DEFAULTS.keno_bet_amount).toBe(1);
      expect(MVP_DEFAULTS.keno_fee_bps).toBe(1200);
      expect(MVP_DEFAULTS.keno_pool_bps).toBe(8800);
      expect(MVP_DEFAULTS.keno_min_pool_balance).toBe(500);
    });

    it('has loss limit defaults', () => {
      expect(MVP_DEFAULTS.keno_daily_loss_limit).toBe(100);
      expect(MVP_DEFAULTS.keno_session_loss_limit).toBe(50);
      expect(MVP_DEFAULTS.keno_max_games_per_session).toBe(200);
    });

    it('has commit-reveal disabled by default', () => {
      expect(MVP_DEFAULTS.keno_commit_reveal_enabled).toBe(false);
      expect(MVP_DEFAULTS.keno_settlement_enabled).toBe(false);
    });
  });
});
