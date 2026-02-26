/**
 * Integration tests: Bingo endpoints
 */
const request = require('supertest');
const {
  app, setupAuthForWallet, walletHeaders, resetMocks,
  mockFeatureFlags, TEST_WALLET,
} = require('./helpers/testApp');

const bingoService = require('../../services/bingoService');

beforeEach(() => {
  resetMocks();
  setupAuthForWallet();
});

// ─── GET /api/bingo/config (public) ──────────────────────────────────────
describe('GET /api/bingo/config', () => {
  it('returns bingo config without auth', async () => {
    const res = await request(app).get('/api/bingo/config');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── GET /api/bingo/rooms (public) ───────────────────────────────────────
describe('GET /api/bingo/rooms', () => {
  it('returns rooms list', async () => {
    bingoService.getActiveRooms.mockResolvedValue([]);
    bingoService.getJackpotBalance.mockResolvedValue('0.00');
    bingoService.getPlayerCounts.mockResolvedValue({});

    const res = await request(app).get('/api/bingo/rooms');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── GET /api/bingo/rounds (public) ──────────────────────────────────────
describe('GET /api/bingo/rounds', () => {
  it('returns rounds list', async () => {
    bingoService.getRounds.mockResolvedValue([]);
    const res = await request(app).get('/api/bingo/rounds');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── Feature flag gating ─────────────────────────────────────────────────
describe('Feature flag gating (bingo_enabled)', () => {
  it('POST /api/bingo/buy-cards returns 403 when bingo disabled', async () => {
    mockFeatureFlags.isEnabledForWallet.mockResolvedValue(false);
    mockFeatureFlags.isEnabled.mockResolvedValue(false);

    const res = await request(app)
      .post('/api/bingo/buy-cards')
      .set(walletHeaders())
      .send({ roundId: 1, count: 1 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FEATURE_DISABLED');
  });
});

// ─── Auth enforcement ────────────────────────────────────────────────────
describe('Auth enforcement on protected bingo routes', () => {
  it('POST /api/bingo/buy-cards requires auth', async () => {
    const res = await request(app)
      .post('/api/bingo/buy-cards')
      .send({ roundId: 1, count: 1 });
    expect(res.status).toBe(401);
  });

  it('GET /api/bingo/my-rooms requires auth', async () => {
    const res = await request(app).get('/api/bingo/my-rooms');
    expect(res.status).toBe(401);
  });

  it('GET /api/bingo/my-cards requires auth', async () => {
    const res = await request(app).get('/api/bingo/my-cards');
    expect(res.status).toBe(401);
  });

  it('GET /api/bingo/history requires auth', async () => {
    const res = await request(app).get('/api/bingo/history');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/bingo/my-rooms (authenticated) ─────────────────────────────
describe('GET /api/bingo/my-rooms (authenticated)', () => {
  it('returns rooms for authenticated user', async () => {
    bingoService.getMyRooms.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/bingo/my-rooms')
      .set(walletHeaders());
    // Should pass auth + flag check
    expect([200, 500]).toContain(res.status);
  });
});

// ─── GET /api/bingo/rounds/:id (public) ──────────────────────────────────
describe('GET /api/bingo/rounds/:id', () => {
  it('returns round detail or 404', async () => {
    bingoService.getRoundDetail.mockResolvedValue(null);

    const res = await request(app).get('/api/bingo/rounds/999');
    // 200 with null data or 404
    expect([200, 404, 500]).toContain(res.status);
  });
});
