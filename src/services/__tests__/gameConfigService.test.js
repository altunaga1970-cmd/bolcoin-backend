const {
  calculateLossDistribution,
  calculateCappedPayout,
  shouldChargeFee,
  MVP_DEFAULTS
} = require('../gameConfigService');

describe('gameConfigService', () => {
  describe('calculateLossDistribution', () => {
    it('splits a $1 loss into 12% fee and 88% reserve', () => {
      const result = calculateLossDistribution(1, 1200, 8800);
      expect(result.fee).toBeCloseTo(0.12, 6);
      expect(result.reserve).toBeCloseTo(0.88, 6);
      expect(result.total).toBe(1);
      expect(result.fee + result.reserve).toBeCloseTo(1, 6);
    });

    it('handles fractional losses without floating-point drift', () => {
      const result = calculateLossDistribution(0.33, 1200, 8800);
      expect(result.fee + result.reserve).toBeCloseTo(0.33, 6);
      expect(result.fee).toBeGreaterThanOrEqual(0);
      expect(result.reserve).toBeGreaterThanOrEqual(0);
    });

    it('handles large losses', () => {
      const result = calculateLossDistribution(10000, 1200, 8800);
      expect(result.fee).toBeCloseTo(1200, 2);
      expect(result.reserve).toBeCloseTo(8800, 2);
      expect(result.total).toBe(10000);
    });

    it('fee + reserve always equals total', () => {
      const amounts = [0.01, 0.1, 0.33, 0.99, 1, 2.5, 7.77, 100, 999.99];
      for (const amount of amounts) {
        const result = calculateLossDistribution(amount);
        expect(result.fee + result.reserve).toBeCloseTo(amount, 5);
      }
    });

    it('fee is always <= loss', () => {
      for (let i = 0; i < 100; i++) {
        const loss = Math.random() * 1000;
        const result = calculateLossDistribution(loss);
        expect(result.fee).toBeLessThanOrEqual(loss);
        expect(result.reserve).toBeLessThanOrEqual(loss);
      }
    });

    it('handles zero loss', () => {
      const result = calculateLossDistribution(0);
      expect(result.fee).toBe(0);
      expect(result.reserve).toBe(0);
      expect(result.total).toBe(0);
    });
  });

  describe('calculateCappedPayout', () => {
    it('returns uncapped payout when below max', () => {
      const result = calculateCappedPayout(1, 3, 50);
      expect(result.theoreticalPayout).toBe(3);
      expect(result.actualPayout).toBe(3);
      expect(result.capped).toBe(false);
    });

    it('caps payout at maxPayout', () => {
      const result = calculateCappedPayout(1, 10000, 50);
      expect(result.theoreticalPayout).toBe(10000);
      expect(result.actualPayout).toBe(50);
      expect(result.capped).toBe(true);
    });

    it('returns zero for zero multiplier', () => {
      const result = calculateCappedPayout(1, 0, 50);
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
    it('charges fee on losses (negative netResult)', () => {
      expect(shouldChargeFee(-1)).toBe(true);
      expect(shouldChargeFee(-0.01)).toBe(true);
    });

    it('does not charge fee on wins', () => {
      expect(shouldChargeFee(1)).toBe(false);
      expect(shouldChargeFee(100)).toBe(false);
    });

    it('does not charge fee on break-even', () => {
      expect(shouldChargeFee(0)).toBe(false);
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
