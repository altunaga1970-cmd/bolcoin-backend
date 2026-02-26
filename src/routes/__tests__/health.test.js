/**
 * Integration tests: Health + Public Config endpoints
 */
const request = require('supertest');
const { app, mockFeatureFlags, mockGameConfig, resetMocks } = require('./helpers/testApp');

beforeEach(() => resetMocks());

// ─── GET / ───────────────────────────────────────────────────────────────
describe('GET /', () => {
  it('returns API info', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/API/i);
    expect(res.body.version).toBeDefined();
    expect(res.body.status).toBe('running');
  });
});

// ─── GET /health ─────────────────────────────────────────────────────────
describe('GET /health', () => {
  it('returns health status with database info', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBeDefined();
    expect(res.body.timestamp).toBeDefined();
    expect(res.body.database).toBeDefined();
  });
});

// ─── GET /api/public-config ──────────────────────────────────────────────
describe('GET /api/public-config', () => {
  it('returns flags, keno config, and system info', async () => {
    const res = await request(app).get('/api/public-config');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const { data } = res.body;
    expect(data.flags).toBeDefined();
    expect(data.keno).toBeDefined();
    expect(data.system).toBeDefined();
    expect(data.system.rngMethod).toBeDefined();
  });

  it('calls featureFlagService and gameConfigService', async () => {
    await request(app).get('/api/public-config');
    expect(mockFeatureFlags.getFlagsSimple).toHaveBeenCalled();
    expect(mockGameConfig.getPublicConfig).toHaveBeenCalled();
  });

  it('returns 500 when featureFlagService throws', async () => {
    mockFeatureFlags.getFlagsSimple.mockRejectedValueOnce(new Error('DB down'));
    const res = await request(app).get('/api/public-config');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// ─── GET /api/public-config/flags ────────────────────────────────────────
describe('GET /api/public-config/flags', () => {
  it('returns flags only', async () => {
    const res = await request(app).get('/api/public-config/flags');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(typeof res.body.data).toBe('object');
  });
});

// ─── GET /api/public-config/keno ─────────────────────────────────────────
describe('GET /api/public-config/keno', () => {
  it('returns keno config only', async () => {
    const res = await request(app).get('/api/public-config/keno');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
  });

  it('returns 500 when gameConfigService throws', async () => {
    mockGameConfig.getKenoConfig.mockRejectedValueOnce(new Error('DB down'));
    const res = await request(app).get('/api/public-config/keno');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// ─── 404 for unknown routes ──────────────────────────────────────────────
describe('Unknown routes', () => {
  it('returns 404 for non-existent path', async () => {
    const res = await request(app).get('/api/nonexistent');
    expect(res.status).toBe(404);
  });
});
