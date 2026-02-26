/**
 * Integration tests: Auth endpoints
 */
const request = require('supertest');
const { app, setupAuthForWallet, walletHeaders, resetMocks, TEST_WALLET } = require('./helpers/testApp');

beforeEach(() => {
  resetMocks();
  setupAuthForWallet();
});

// ─── GET /api/auth/nonce ─────────────────────────────────────────────────
describe('GET /api/auth/nonce', () => {
  it('returns a nonce string', async () => {
    const res = await request(app).get('/api/auth/nonce');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.nonce).toBeDefined();
    expect(typeof res.body.nonce).toBe('string');
    expect(res.body.nonce.length).toBeGreaterThan(10);
  });

  it('returns a different nonce each time', async () => {
    const res1 = await request(app).get('/api/auth/nonce');
    const res2 = await request(app).get('/api/auth/nonce');
    expect(res1.body.nonce).not.toBe(res2.body.nonce);
  });
});

// ─── POST /api/auth/verify ───────────────────────────────────────────────
describe('POST /api/auth/verify', () => {
  it('verifies a valid wallet signature', async () => {
    const res = await request(app)
      .post('/api/auth/verify')
      .set(walletHeaders())
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.address).toBe(TEST_WALLET);
  });

  it('rejects missing signature headers', async () => {
    const res = await request(app)
      .post('/api/auth/verify')
      .set({ 'x-wallet-address': TEST_WALLET })
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects missing wallet address', async () => {
    const res = await request(app)
      .post('/api/auth/verify')
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

// ─── GET /api/auth/me ────────────────────────────────────────────────────
describe('GET /api/auth/me', () => {
  it('returns user info when authenticated', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set(walletHeaders());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.address).toBe(TEST_WALLET);
    expect(res.body.user.id).toBeDefined();
  });

  it('rejects unauthenticated request', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

// ─── GET /api/auth/status ────────────────────────────────────────────────
describe('GET /api/auth/status', () => {
  it('returns authenticated=true when wallet header present', async () => {
    const { ethers } = require('ethers');
    ethers.isAddress.mockReturnValue(true);

    const res = await request(app)
      .get('/api/auth/status')
      .set({ 'x-wallet-address': TEST_WALLET });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.authenticated).toBe(true);
  });

  it('returns authenticated=false when no wallet header', async () => {
    const res = await request(app).get('/api/auth/status');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.authenticated).toBe(false);
  });
});

// ─── Deprecated endpoints ────────────────────────────────────────────────
describe('Deprecated auth endpoints', () => {
  it('POST /api/auth/register returns 410 Gone', async () => {
    const res = await request(app).post('/api/auth/register').send({});
    expect(res.status).toBe(410);
    expect(res.body.web3Only).toBe(true);
  });

  it('POST /api/auth/login returns 410 Gone', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(410);
    expect(res.body.web3Only).toBe(true);
  });

  it('POST /api/auth/logout returns success message', async () => {
    const res = await request(app).post('/api/auth/logout').send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
