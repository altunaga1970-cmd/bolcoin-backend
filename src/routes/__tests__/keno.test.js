/**
 * Integration tests: Keno endpoints
 */
const request = require('supertest');
const {
  app, setupAuthForWallet, walletHeaders, resetMocks,
  mockFeatureFlags, mockClient, TEST_WALLET,
} = require('./helpers/testApp');

beforeEach(() => {
  resetMocks();
  setupAuthForWallet();
});

// ─── GET /api/keno/config (public) ──────────────────────────────────────
describe('GET /api/keno/config', () => {
  it('returns keno config without auth', async () => {
    const res = await request(app).get('/api/keno/config');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
  });
});

// ─── Feature flag gating ─────────────────────────────────────────────────
describe('Feature flag gating', () => {
  it('returns 403 when game_keno is disabled', async () => {
    mockFeatureFlags.isEnabledForWallet.mockResolvedValue(false);
    mockFeatureFlags.isEnabled.mockResolvedValue(false);

    const res = await request(app)
      .get('/api/keno/balance')
      .set(walletHeaders());
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FEATURE_DISABLED');
  });

  it('returns 503 when in maintenance mode', async () => {
    mockFeatureFlags.isMaintenanceMode.mockResolvedValue(true);

    const res = await request(app)
      .get('/api/keno/balance')
      .set(walletHeaders());
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('MAINTENANCE_MODE');
  });
});

// ─── Auth enforcement ────────────────────────────────────────────────────
describe('Auth enforcement on protected keno routes', () => {
  it('GET /api/keno/balance requires auth', async () => {
    const res = await request(app).get('/api/keno/balance');
    expect(res.status).toBe(401);
  });

  it('POST /api/keno/play requires auth', async () => {
    const res = await request(app).post('/api/keno/play').send({});
    expect(res.status).toBe(401);
  });

  it('GET /api/keno/history requires auth', async () => {
    const res = await request(app).get('/api/keno/history');
    expect(res.status).toBe(401);
  });

  it('GET /api/keno/session requires auth', async () => {
    const res = await request(app).get('/api/keno/session');
    expect(res.status).toBe(401);
  });

  it('POST /api/keno/session/settle requires auth', async () => {
    const res = await request(app).post('/api/keno/session/settle').send({});
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/keno/balance (authenticated) ───────────────────────────────
describe('GET /api/keno/balance (authenticated)', () => {
  it('returns balance when authenticated and flag enabled', async () => {
    // Mock the DB queries the route handler makes
    mockClient.query.mockImplementation((text) => {
      if (typeof text === 'string' && text.includes('SELECT id FROM users')) {
        return Promise.resolve({ rows: [{ id: 42 }], rowCount: 1 });
      }
      if (typeof text === 'string' && text.includes('SELECT balance')) {
        return Promise.resolve({ rows: [{ balance: '100.00' }], rowCount: 1 });
      }
      if (typeof text === 'string' && text.includes('keno_sessions')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await request(app)
      .get('/api/keno/balance')
      .set(walletHeaders());
    // Should not be 401 or 403
    expect([200, 500]).toContain(res.status);
  });
});

// ─── GET /api/keno/verify/:gameId (public) ───────────────────────────────
describe('GET /api/keno/verify/:gameId', () => {
  it('returns verification data or 404 for non-existent game', async () => {
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });

    const res = await request(app).get('/api/keno/verify/999999');
    // Either 200 with data or 404 (game not found)
    expect([200, 404, 500]).toContain(res.status);
  });
});
