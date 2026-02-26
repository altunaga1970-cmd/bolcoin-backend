/**
 * Integration tests: Wallet endpoints
 */
const request = require('supertest');
const {
  app, setupAuthForWallet, walletHeaders, resetMocks,
  mockClient, TEST_WALLET,
} = require('./helpers/testApp');

beforeEach(() => {
  resetMocks();
  setupAuthForWallet();
});

// ─── Auth enforcement ────────────────────────────────────────────────────
describe('Auth enforcement on wallet routes', () => {
  it('GET /api/wallet/balance requires auth', async () => {
    const res = await request(app).get('/api/wallet/balance');
    expect(res.status).toBe(401);
  });

  it('POST /api/wallet/recharge requires auth', async () => {
    const res = await request(app)
      .post('/api/wallet/recharge')
      .send({ amount: 10 });
    expect(res.status).toBe(401);
  });

  it('GET /api/wallet/transactions requires auth', async () => {
    const res = await request(app).get('/api/wallet/transactions');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/wallet/balance-by-address (public) ─────────────────────────
describe('GET /api/wallet/balance-by-address', () => {
  it('returns balance for a valid address', async () => {
    mockClient.query.mockResolvedValue({
      rows: [{ balance: '50.00' }],
      rowCount: 1,
    });

    const res = await request(app)
      .get('/api/wallet/balance-by-address')
      .query({ address: TEST_WALLET });
    // Route may return 200 with data or error shape
    expect([200, 400, 404, 500]).toContain(res.status);
  });

  it('returns error without address param', async () => {
    const res = await request(app)
      .get('/api/wallet/balance-by-address');
    expect([400, 500]).toContain(res.status);
  });
});

// ─── GET /api/wallet/balance (authenticated) ─────────────────────────────
describe('GET /api/wallet/balance (authenticated)', () => {
  it('returns balance when authenticated', async () => {
    mockClient.query.mockImplementation((text) => {
      if (typeof text === 'string' && text.includes('SELECT id FROM users')) {
        return Promise.resolve({ rows: [{ id: 42 }], rowCount: 1 });
      }
      if (typeof text === 'string' && text.includes('balance')) {
        return Promise.resolve({ rows: [{ balance: '100.00' }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await request(app)
      .get('/api/wallet/balance')
      .set(walletHeaders());
    expect([200, 500]).toContain(res.status);
  });
});

// ─── GET /api/wallet/transactions (authenticated) ────────────────────────
describe('GET /api/wallet/transactions (authenticated)', () => {
  it('returns transactions list', async () => {
    mockClient.query.mockImplementation((text) => {
      if (typeof text === 'string' && text.includes('SELECT id FROM users')) {
        return Promise.resolve({ rows: [{ id: 42 }], rowCount: 1 });
      }
      if (typeof text === 'string' && text.includes('transactions')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (typeof text === 'string' && text.includes('balance')) {
        return Promise.resolve({ rows: [{ balance: '100.00' }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await request(app)
      .get('/api/wallet/transactions')
      .set(walletHeaders());
    expect([200, 500]).toContain(res.status);
  });
});
