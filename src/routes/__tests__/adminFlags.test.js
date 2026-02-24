/**
 * Integration tests: Admin Flags endpoints
 * All routes require admin JWT auth via adminAuth middleware.
 *
 * GET    /api/admin/flags
 * PATCH  /api/admin/flags/:key
 * POST   /api/admin/flags/invalidate-cache
 * GET    /api/admin/flags/:key/wallets
 * POST   /api/admin/flags/:key/wallets
 * DELETE /api/admin/flags/:key/wallets/:wallet
 * GET    /api/admin/flags/config
 * PATCH  /api/admin/flags/config/:key
 */
const request = require('supertest');
const { app, resetMocks, mockFeatureFlags, mockGameConfig } = require('./helpers/testApp');

const ADMIN_HDR = { Authorization: 'Bearer test-admin-jwt' };

beforeEach(() => {
  resetMocks();
});

// ─── Auth guard ────────────────────────────────────────────────────────
describe('Admin flags auth guard', () => {
  it('GET /api/admin/flags returns 401 without token', async () => {
    const res = await request(app).get('/api/admin/flags');
    expect(res.status).toBe(401);
  });

  it('PATCH /api/admin/flags/some_key returns 401 without token', async () => {
    const res = await request(app)
      .patch('/api/admin/flags/some_key')
      .send({ enabled: true });
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/admin/flags ──────────────────────────────────────────────
describe('GET /api/admin/flags', () => {
  it('returns 200 with flags list', async () => {
    mockFeatureFlags.getAllFlags.mockResolvedValueOnce([
      { key: 'game_keno', enabled: true },
      { key: 'bingo_enabled', enabled: false },
    ]);

    const res = await request(app).get('/api/admin/flags').set(ADMIN_HDR);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('flags');
    expect(res.body.data).toHaveProperty('cacheInfo');
    expect(res.body.data.flags).toHaveLength(2);
  });

  it('calls featureFlagService.getAllFlags', async () => {
    await request(app).get('/api/admin/flags').set(ADMIN_HDR);
    expect(mockFeatureFlags.getAllFlags).toHaveBeenCalled();
  });

  it('returns 500 when service throws', async () => {
    mockFeatureFlags.getAllFlags.mockRejectedValueOnce(new Error('DB down'));
    const res = await request(app).get('/api/admin/flags').set(ADMIN_HDR);
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// ─── PATCH /api/admin/flags/:key ───────────────────────────────────────
describe('PATCH /api/admin/flags/:key', () => {
  it('returns 200 on valid update', async () => {
    const res = await request(app)
      .patch('/api/admin/flags/game_keno')
      .set(ADMIN_HDR)
      .send({ enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockFeatureFlags.setFlag).toHaveBeenCalledWith('game_keno', false, undefined);
  });

  it('returns 400 when enabled is not boolean', async () => {
    const res = await request(app)
      .patch('/api/admin/flags/game_keno')
      .set(ADMIN_HDR)
      .send({ enabled: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when enabled is missing', async () => {
    const res = await request(app)
      .patch('/api/admin/flags/game_keno')
      .set(ADMIN_HDR)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 404 when flag not found', async () => {
    mockFeatureFlags.setFlag.mockRejectedValueOnce(new Error('Flag not found'));
    const res = await request(app)
      .patch('/api/admin/flags/nonexistent')
      .set(ADMIN_HDR)
      .send({ enabled: true });
    expect(res.status).toBe(404);
  });

  it('returns 500 on generic service error', async () => {
    mockFeatureFlags.setFlag.mockRejectedValueOnce(new Error('DB error'));
    const res = await request(app)
      .patch('/api/admin/flags/game_keno')
      .set(ADMIN_HDR)
      .send({ enabled: true });
    expect(res.status).toBe(500);
  });
});

// ─── POST /api/admin/flags/invalidate-cache ────────────────────────────
describe('POST /api/admin/flags/invalidate-cache', () => {
  it('returns 200 and calls both invalidateCache methods', async () => {
    const res = await request(app)
      .post('/api/admin/flags/invalidate-cache')
      .set(ADMIN_HDR);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockFeatureFlags.invalidateCache).toHaveBeenCalled();
    expect(mockGameConfig.invalidateCache).toHaveBeenCalled();
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/admin/flags/invalidate-cache');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/admin/flags/:key/wallets ─────────────────────────────────
describe('GET /api/admin/flags/:key/wallets', () => {
  it('returns 200 with wallets list', async () => {
    mockFeatureFlags.getWhitelistedWallets.mockResolvedValueOnce([
      '0x1234567890abcdef1234567890abcdef12345678',
    ]);

    const res = await request(app)
      .get('/api/admin/flags/bingo_enabled/wallets')
      .set(ADMIN_HDR);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.flag).toBe('bingo_enabled');
    expect(res.body.data.wallets).toHaveLength(1);
  });

  it('calls getWhitelistedWallets with the flag key', async () => {
    await request(app)
      .get('/api/admin/flags/game_keno/wallets')
      .set(ADMIN_HDR);
    expect(mockFeatureFlags.getWhitelistedWallets).toHaveBeenCalledWith('game_keno');
  });

  it('returns 500 when service throws', async () => {
    mockFeatureFlags.getWhitelistedWallets.mockRejectedValueOnce(new Error('fail'));
    const res = await request(app)
      .get('/api/admin/flags/game_keno/wallets')
      .set(ADMIN_HDR);
    expect(res.status).toBe(500);
  });
});

// ─── POST /api/admin/flags/:key/wallets ────────────────────────────────
describe('POST /api/admin/flags/:key/wallets', () => {
  it('returns 200 when adding a wallet', async () => {
    const wallet = '0x' + 'b'.repeat(40);
    const res = await request(app)
      .post('/api/admin/flags/bingo_enabled/wallets')
      .set(ADMIN_HDR)
      .send({ wallet, reason: 'beta tester' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockFeatureFlags.addWalletToFlag).toHaveBeenCalledWith(
      'bingo_enabled', wallet, 'beta tester'
    );
  });

  it('returns 400 when wallet is missing', async () => {
    const res = await request(app)
      .post('/api/admin/flags/bingo_enabled/wallets')
      .set(ADMIN_HDR)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 500 when service throws', async () => {
    mockFeatureFlags.addWalletToFlag.mockRejectedValueOnce(new Error('fail'));
    const res = await request(app)
      .post('/api/admin/flags/bingo_enabled/wallets')
      .set(ADMIN_HDR)
      .send({ wallet: '0x' + 'c'.repeat(40) });
    expect(res.status).toBe(500);
  });
});

// ─── DELETE /api/admin/flags/:key/wallets/:wallet ──────────────────────
describe('DELETE /api/admin/flags/:key/wallets/:wallet', () => {
  it('returns 200 when removing a wallet', async () => {
    const wallet = '0x' + 'd'.repeat(40);
    const res = await request(app)
      .delete(`/api/admin/flags/bingo_enabled/wallets/${wallet}`)
      .set(ADMIN_HDR);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockFeatureFlags.removeWalletFromFlag).toHaveBeenCalledWith(
      'bingo_enabled', wallet
    );
  });

  it('returns 500 when service throws', async () => {
    mockFeatureFlags.removeWalletFromFlag.mockRejectedValueOnce(new Error('fail'));
    const wallet = '0x' + 'e'.repeat(40);
    const res = await request(app)
      .delete(`/api/admin/flags/bingo_enabled/wallets/${wallet}`)
      .set(ADMIN_HDR);
    expect(res.status).toBe(500);
  });
});

// ─── GET /api/admin/flags/config ───────────────────────────────────────
describe('GET /api/admin/flags/config', () => {
  it('returns 200 with all config', async () => {
    const res = await request(app)
      .get('/api/admin/flags/config')
      .set(ADMIN_HDR);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockGameConfig.getAllConfig).toHaveBeenCalled();
  });

  it('returns 500 when service throws', async () => {
    mockGameConfig.getAllConfig.mockRejectedValueOnce(new Error('fail'));
    const res = await request(app)
      .get('/api/admin/flags/config')
      .set(ADMIN_HDR);
    expect(res.status).toBe(500);
  });
});

// ─── PATCH /api/admin/flags/config/:key ────────────────────────────────
describe('PATCH /api/admin/flags/config/:key', () => {
  it('returns 200 on valid update', async () => {
    const res = await request(app)
      .patch('/api/admin/flags/config/keno_bet_amount')
      .set(ADMIN_HDR)
      .send({ value: 2, type: 'number' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockGameConfig.setConfigValue).toHaveBeenCalledWith(
      'keno_bet_amount', 2, 'number'
    );
  });

  it('returns 400 when value is missing', async () => {
    const res = await request(app)
      .patch('/api/admin/flags/config/keno_bet_amount')
      .set(ADMIN_HDR)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 500 when service throws', async () => {
    mockGameConfig.setConfigValue.mockRejectedValueOnce(new Error('fail'));
    const res = await request(app)
      .patch('/api/admin/flags/config/keno_bet_amount')
      .set(ADMIN_HDR)
      .send({ value: 999 });
    expect(res.status).toBe(500);
  });
});
