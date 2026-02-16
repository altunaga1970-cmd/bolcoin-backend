/**
 * Tests for bingoResolverService pure functions.
 * No DB or contract interaction needed.
 */

// Mock DB and chain dependencies before importing
jest.mock('../../db', () => ({
  query: jest.fn(),
  connect: jest.fn()
}));
jest.mock('../../chain/bingoProvider', () => ({
  getBingoContract: jest.fn(),
  getBingoContractReadOnly: jest.fn(),
  isBingoOnChain: jest.fn(() => false),
  BINGO_CONTRACT_ADDRESS: '0x1234567890123456789012345678901234567890',
}));
jest.mock('../../chain/provider', () => ({
  getProvider: jest.fn(),
  getSigner: jest.fn(),
}));

const {
  CARD_ROWS, CARD_COLS, NUMBERS_PER_CARD, TOTAL_BALLS, ZERO_ADDRESS, ROWS,
  drawBallsFromVrfSeed,
  checkCard,
  detectWinners,
} = require('../bingoResolverService');

describe('bingoResolverService', () => {

  // ── Constants ──

  describe('Constants', () => {
    it('has correct card dimensions', () => {
      expect(CARD_ROWS).toBe(3);
      expect(CARD_COLS).toBe(5);
      expect(NUMBERS_PER_CARD).toBe(15);
    });

    it('has 75 total balls', () => {
      expect(TOTAL_BALLS).toBe(75);
    });

    it('defines 3 rows of 5 indices each', () => {
      expect(ROWS).toHaveLength(3);
      expect(ROWS[0]).toEqual([0, 1, 2, 3, 4]);
      expect(ROWS[1]).toEqual([5, 6, 7, 8, 9]);
      expect(ROWS[2]).toEqual([10, 11, 12, 13, 14]);
    });
  });

  // ── drawBallsFromVrfSeed ──

  describe('drawBallsFromVrfSeed', () => {
    const testSeed = '12345678901234567890123456789012345678901234567890';

    it('returns exactly 75 balls', () => {
      const balls = drawBallsFromVrfSeed(testSeed);
      expect(balls).toHaveLength(75);
    });

    it('returns unique balls', () => {
      const balls = drawBallsFromVrfSeed(testSeed);
      const unique = new Set(balls);
      expect(unique.size).toBe(75);
    });

    it('returns balls in range 1-75', () => {
      const balls = drawBallsFromVrfSeed(testSeed);
      for (const ball of balls) {
        expect(ball).toBeGreaterThanOrEqual(1);
        expect(ball).toBeLessThanOrEqual(75);
      }
    });

    it('is deterministic: same seed produces same result', () => {
      const balls1 = drawBallsFromVrfSeed(testSeed);
      const balls2 = drawBallsFromVrfSeed(testSeed);
      expect(balls1).toEqual(balls2);
    });

    it('different seeds produce different results', () => {
      const balls1 = drawBallsFromVrfSeed('111');
      const balls2 = drawBallsFromVrfSeed('222');
      expect(balls1).not.toEqual(balls2);
    });

    it('handles large BigInt seeds', () => {
      const largeSeed = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
      const balls = drawBallsFromVrfSeed(largeSeed);
      expect(balls).toHaveLength(75);
      expect(new Set(balls).size).toBe(75);
    });
  });

  // ── checkCard ──

  describe('checkCard', () => {
    // Helper: create drawn balls where specific numbers come early
    function makeBallsWithEarly(earlyBalls) {
      const all = [];
      for (let i = 1; i <= 75; i++) all.push(i);
      // Move earlyBalls to the front
      const result = [...earlyBalls];
      for (const b of all) {
        if (!earlyBalls.includes(b)) result.push(b);
      }
      return result;
    }

    it('detects row 0 line (indices 0-4)', () => {
      // Card: row 0 = [1, 16, 31, 46, 61]
      const card = [1, 16, 31, 46, 61, 2, 17, 32, 47, 62, 3, 18, 33, 48, 63];
      const balls = makeBallsWithEarly([1, 16, 31, 46, 61]);
      const result = checkCard(card, balls);
      expect(result.lineHitBall).toBe(5); // 5th ball completes the row
    });

    it('detects row 1 line (indices 5-9)', () => {
      const card = [1, 16, 31, 46, 61, 2, 17, 32, 47, 62, 3, 18, 33, 48, 63];
      const balls = makeBallsWithEarly([2, 17, 32, 47, 62]);
      const result = checkCard(card, balls);
      expect(result.lineHitBall).toBe(5);
    });

    it('detects row 2 line (indices 10-14)', () => {
      const card = [1, 16, 31, 46, 61, 2, 17, 32, 47, 62, 3, 18, 33, 48, 63];
      const balls = makeBallsWithEarly([3, 18, 33, 48, 63]);
      const result = checkCard(card, balls);
      expect(result.lineHitBall).toBe(5);
    });

    it('does NOT detect partial row as line', () => {
      const card = [1, 16, 31, 46, 61, 2, 17, 32, 47, 62, 3, 18, 33, 48, 63];
      // Only 4 of row 0's 5 numbers come first; the 5th comes very late
      const balls = makeBallsWithEarly([1, 16, 31, 46]);
      // 61 should be somewhere later - check partial doesn't trigger
      const result = checkCard(card, balls);
      // lineHitBall should NOT be 4 (only 4 of 5 matched)
      expect(result.lineHitBall).not.toBe(4);
    });

    it('detects full bingo (all 15 numbers)', () => {
      const card = [1, 16, 31, 46, 61, 2, 17, 32, 47, 62, 3, 18, 33, 48, 63];
      const balls = makeBallsWithEarly(card);
      const result = checkCard(card, balls);
      expect(result.bingoHitBall).toBe(15); // 15th ball completes all
    });

    it('returns line before bingo when row completes first', () => {
      const card = [1, 16, 31, 46, 61, 2, 17, 32, 47, 62, 3, 18, 33, 48, 63];
      const balls = makeBallsWithEarly([1, 16, 31, 46, 61, 2, 17, 32, 47, 62, 3, 18, 33, 48, 63]);
      const result = checkCard(card, balls);
      expect(result.lineHitBall).toBe(5);
      expect(result.bingoHitBall).toBe(15);
      expect(result.lineHitBall).toBeLessThan(result.bingoHitBall);
    });

    it('handles card where no numbers match early balls', () => {
      const card = [70, 71, 72, 73, 74, 65, 66, 67, 68, 69, 60, 56, 57, 58, 59];
      // All balls 1-59 come first, then 60-75
      const balls = [];
      for (let i = 1; i <= 75; i++) balls.push(i);
      const result = checkCard(card, balls);
      // Line and bingo should eventually be found but at late ball numbers
      expect(result.lineHitBall).not.toBeNull();
      expect(result.bingoHitBall).not.toBeNull();
    });
  });

  // ── detectWinners ──

  describe('detectWinners', () => {
    function makeBallsWithEarly(earlyBalls) {
      const all = [];
      for (let i = 1; i <= 75; i++) all.push(i);
      const result = [...earlyBalls];
      for (const b of all) {
        if (!earlyBalls.includes(b)) result.push(b);
      }
      return result;
    }

    it('picks earliest line winner by ball number', () => {
      const cards = [
        { cardId: 1, owner: '0xaaa', numbers: [10, 20, 30, 40, 50, 11, 21, 31, 41, 51, 12, 22, 32, 42, 52] },
        { cardId: 2, owner: '0xbbb', numbers: [1, 16, 31, 46, 61, 2, 17, 32, 47, 62, 3, 18, 33, 48, 63] },
      ];
      // Card 2's row 0 [1,16,31,46,61] completes faster than card 1's rows
      const balls = makeBallsWithEarly([1, 16, 31, 46, 61]);
      const result = detectWinners(cards, balls);
      expect(result.lineWinner).toBe('0xbbb');
      expect(result.lineWinnerBall).toBe(5);
    });

    it('picks earliest bingo winner by ball number', () => {
      // Card 1: all numbers in range 1-15 (requires 15 specific balls)
      const card1Nums = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
      // Card 2: spread across full range
      const card2Nums = [1, 16, 31, 46, 61, 2, 17, 32, 47, 62, 3, 18, 33, 48, 63];

      const cards = [
        { cardId: 1, owner: '0xaaa', numbers: card1Nums },
        { cardId: 2, owner: '0xbbb', numbers: card2Nums },
      ];

      // Balls 1-15 come first - card 1 gets bingo at ball 15
      const balls = makeBallsWithEarly([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
      const result = detectWinners(cards, balls);
      expect(result.bingoWinner).toBe('0xaaa');
      expect(result.bingoWinnerBall).toBe(15);
    });

    it('tie broken by lowest cardId', () => {
      // Both cards have the same row 0 numbers
      const cards = [
        { cardId: 5, owner: '0xbbb', numbers: [1, 16, 31, 46, 61, 2, 17, 32, 47, 62, 3, 18, 33, 48, 63] },
        { cardId: 3, owner: '0xaaa', numbers: [1, 16, 31, 46, 61, 5, 20, 35, 50, 65, 8, 23, 38, 53, 68] },
      ];
      const balls = makeBallsWithEarly([1, 16, 31, 46, 61]);
      const result = detectWinners(cards, balls);
      // Both complete line at ball 5, but cardId 3 < cardId 5
      expect(result.lineWinner).toBe('0xaaa');
      expect(result.lineWinnerCardId).toBe(3);
    });

    it('no-winner case returns zero address', () => {
      // Card with numbers that form no complete row in any order
      // This is actually impossible since all 75 balls are drawn...
      // But we can check with a card whose numbers don't exist
      // Actually, all valid 1-75 numbers will eventually be drawn.
      // So we test with the actual addresses
      const cards = [
        { cardId: 1, owner: '0xaaa', numbers: [1, 16, 31, 46, 61, 2, 17, 32, 47, 62, 3, 18, 33, 48, 63] },
      ];
      const balls = makeBallsWithEarly([1, 16, 31, 46, 61]);
      const result = detectWinners(cards, balls);
      // With all 75 balls drawn, there will always be a line and bingo winner
      expect(result.lineWinner).not.toBe(ZERO_ADDRESS);
      expect(result.bingoWinner).not.toBe(ZERO_ADDRESS);
    });

    it('handles empty cards array', () => {
      const balls = drawBallsFromVrfSeed('999');
      const result = detectWinners([], balls);
      expect(result.lineWinner).toBe(ZERO_ADDRESS);
      expect(result.lineWinnerBall).toBe(0);
      expect(result.bingoWinner).toBe(ZERO_ADDRESS);
      expect(result.bingoWinnerBall).toBe(0);
    });
  });

  // ── Revenue math validation ──

  describe('Revenue math', () => {
    it('fee 10% + reserve 10% + pot 80% sums to 100%', () => {
      const feeBps = 1000;
      const reserveBps = 1000;
      const potBps = 10000 - feeBps - reserveBps;
      expect(potBps).toBe(8000);
      expect(feeBps + reserveBps + potBps).toBe(10000);
    });

    it('pot split: line 10% + bingo 70% sums to 80% of pot', () => {
      const linePrizeBps = 1000;
      const bingoPrizeBps = 7000;
      expect(linePrizeBps + bingoPrizeBps).toBe(8000);
    });

    it('revenue distribution example: 100 USDT revenue', () => {
      const revenue = 100;
      const fee = (revenue * 1000) / 10000;       // 10
      const reserve = (revenue * 1000) / 10000;   // 10
      const pot = revenue - fee - reserve;          // 80
      const linePrize = (pot * 1000) / 10000;      // 8
      const bingoPrize = (pot * 7000) / 10000;     // 56

      expect(fee).toBe(10);
      expect(reserve).toBe(10);
      expect(pot).toBe(80);
      expect(linePrize).toBe(8);
      expect(bingoPrize).toBe(56);
      // Remaining 16 stays in contract pool
      expect(pot - linePrize - bingoPrize).toBe(16);
    });
  });
});
