/**
 * Integration tests: Bankroll endpoints
 * Public routes + admin-protected routes
 */
const request = require('supertest');
const { app, resetMocks, walletHeaders, setupAuthForWallet } = require('./helpers/testApp');
const bankrollService = require('../../services/bankrollService');

beforeEach(() => {
  resetMocks();
  setupAuthForWallet();
});

// ─── GET /api/bankroll/status ───────────────────────────────────────────
describe('GET /api/bankroll/status', () => {
  it('returns 200 with public bankroll status (no auth required)', async () => {
    const res = await request(app).get('/api/bankroll/status');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('current_limit_per_number');
    expect(res.body.data).toHaveProperty('min_limit');
    expect(res.body.data).toHaveProperty('max_limit');
  });

  it('calls bankrollService.getBankrollStatus', async () => {
    await request(app).get('/api/bankroll/status');
    expect(bankrollService.getBankrollStatus).toHaveBeenCalled();
  });

  it('returns 500 when service throws', async () => {
    bankrollService.getBankrollStatus.mockRejectedValueOnce(new Error('DB error'));
    const res = await request(app).get('/api/bankroll/status');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// ─── GET /api/bankroll/check-number/:drawId/:gameType/:number ───────────
describe('GET /api/bankroll/check-number/:drawId/:gameType/:number', () => {
  it('returns 200 with availability info', async () => {
    const res = await request(app).get('/api/bankroll/check-number/1/fijo/42');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('available');
  });

  it('passes amount query param to service', async () => {
    await request(app).get('/api/bankroll/check-number/1/fijo/42?amount=5');
    expect(bankrollService.checkNumberAvailability).toHaveBeenCalledWith(
      1, 'fijo', '42', 5
    );
  });

  it('defaults amount to 1 when not provided', async () => {
    await request(app).get('/api/bankroll/check-number/1/fijo/42');
    expect(bankrollService.checkNumberAvailability).toHaveBeenCalledWith(
      1, 'fijo', '42', 1
    );
  });

  it('returns 500 when service throws', async () => {
    bankrollService.checkNumberAvailability.mockRejectedValueOnce(new Error('fail'));
    const res = await request(app).get('/api/bankroll/check-number/1/fijo/42');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// ─── GET /api/bankroll/sold-out/:drawId ─────────────────────────────────
describe('GET /api/bankroll/sold-out/:drawId', () => {
  it('returns 200 with sold-out numbers', async () => {
    const res = await request(app).get('/api/bankroll/sold-out/1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('sold_out_numbers');
    expect(res.body.data).toHaveProperty('count');
    expect(res.body.data.draw_id).toBe(1);
  });

  it('calls bankrollService.getSoldOutNumbers', async () => {
    await request(app).get('/api/bankroll/sold-out/5');
    expect(bankrollService.getSoldOutNumbers).toHaveBeenCalledWith(5);
  });

  it('returns 500 when service throws', async () => {
    bankrollService.getSoldOutNumbers.mockRejectedValueOnce(new Error('fail'));
    const res = await request(app).get('/api/bankroll/sold-out/1');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// ─── GET /api/bankroll/exposure/:drawId ─────────────────────────────────
describe('GET /api/bankroll/exposure/:drawId', () => {
  it('returns 200 with exposure data', async () => {
    const res = await request(app).get('/api/bankroll/exposure/1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('draw_id');
    expect(res.body.data).toHaveProperty('exposure');
  });

  it('calls bankrollService.getDrawExposure', async () => {
    await request(app).get('/api/bankroll/exposure/3');
    expect(bankrollService.getDrawExposure).toHaveBeenCalledWith(3);
  });

  it('returns 500 when service throws', async () => {
    bankrollService.getDrawExposure.mockRejectedValueOnce(new Error('fail'));
    const res = await request(app).get('/api/bankroll/exposure/1');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// ─── Admin routes ───────────────────────────────────────────────────────
describe('Admin bankroll routes', () => {
  it('GET /admin/full-status returns 401 without auth', async () => {
    const res = await request(app).get('/api/bankroll/admin/full-status');
    expect(res.status).toBe(401);
  });

  it('GET /admin/full-status returns 200 for admin', async () => {
    const res = await request(app)
      .get('/api/bankroll/admin/full-status')
      .set('Authorization', 'Bearer test-admin-jwt');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('bankroll_balance');
  });

  it('GET /admin/settlements returns 401 without auth', async () => {
    const res = await request(app).get('/api/bankroll/admin/settlements');
    expect(res.status).toBe(401);
  });

  it('GET /admin/settlements returns 200 for admin', async () => {
    const res = await request(app)
      .get('/api/bankroll/admin/settlements')
      .set('Authorization', 'Bearer test-admin-jwt');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('POST /admin/initialize returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/bankroll/admin/initialize')
      .send({ initial_reserve: 500 });
    expect(res.status).toBe(401);
  });

  it('POST /admin/initialize returns 400 when reserve < 100', async () => {
    const res = await request(app)
      .post('/api/bankroll/admin/initialize')
      .set('Authorization', 'Bearer test-admin-jwt')
      .send({ initial_reserve: 50 });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /admin/initialize returns 200 with valid reserve', async () => {
    const res = await request(app)
      .post('/api/bankroll/admin/initialize')
      .set('Authorization', 'Bearer test-admin-jwt')
      .send({ initial_reserve: 500 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('POST /admin/adjust returns 400 with invalid target_fund', async () => {
    const res = await request(app)
      .post('/api/bankroll/admin/adjust')
      .set('Authorization', 'Bearer test-admin-jwt')
      .send({ target_fund: 'invalid', amount: 100 });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /admin/adjust returns 400 without amount', async () => {
    const res = await request(app)
      .post('/api/bankroll/admin/adjust')
      .set('Authorization', 'Bearer test-admin-jwt')
      .send({ target_fund: 'reserve' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
