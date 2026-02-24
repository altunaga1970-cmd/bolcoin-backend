/**
 * Integration tests: Admin Dashboard endpoints
 * All routes require admin JWT auth via adminAuth middleware.
 *
 * GET  /api/admin/dashboard/metrics
 * GET  /api/admin/dashboard/summary
 * GET  /api/admin/dashboard/chart-data
 * GET  /api/admin/dashboard/realtime
 * POST /api/admin/dashboard/aggregate
 */
const request = require('supertest');
const { app, resetMocks } = require('./helpers/testApp');
const metricsService = require('../../services/metricsService');

const ADMIN_HDR = { Authorization: 'Bearer test-admin-jwt' };

beforeEach(() => {
  resetMocks();
});

// ─── Auth guard ────────────────────────────────────────────────────────
describe('Admin dashboard auth guard', () => {
  it('GET /api/admin/dashboard/metrics returns 401 without token', async () => {
    const res = await request(app).get('/api/admin/dashboard/metrics');
    expect(res.status).toBe(401);
  });

  it('GET /api/admin/dashboard/summary returns 401 without token', async () => {
    const res = await request(app).get('/api/admin/dashboard/summary');
    expect(res.status).toBe(401);
  });

  it('POST /api/admin/dashboard/aggregate returns 401 without token', async () => {
    const res = await request(app).post('/api/admin/dashboard/aggregate');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/admin/dashboard/metrics ──────────────────────────────────
describe('GET /api/admin/dashboard/metrics', () => {
  it('returns 200 with default period', async () => {
    const res = await request(app)
      .get('/api/admin/dashboard/metrics')
      .set(ADMIN_HDR);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(metricsService.getDashboardMetrics).toHaveBeenCalledWith(
      'daily', null, null
    );
  });

  it('passes period and date params to service', async () => {
    await request(app)
      .get('/api/admin/dashboard/metrics?period=monthly&date_from=2026-01-01&date_to=2026-01-31')
      .set(ADMIN_HDR);
    expect(metricsService.getDashboardMetrics).toHaveBeenCalledWith(
      'monthly',
      expect.any(Date),
      expect.any(Date)
    );
  });

  it('returns 500 when service throws', async () => {
    metricsService.getDashboardMetrics.mockRejectedValueOnce(new Error('fail'));
    const res = await request(app)
      .get('/api/admin/dashboard/metrics')
      .set(ADMIN_HDR);
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// ─── GET /api/admin/dashboard/summary ──────────────────────────────────
describe('GET /api/admin/dashboard/summary', () => {
  it('returns 200 with summary data', async () => {
    metricsService.getDashboardSummary.mockResolvedValueOnce({
      totalUsers: 10,
      totalBets: 500,
    });

    const res = await request(app)
      .get('/api/admin/dashboard/summary')
      .set(ADMIN_HDR);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('totalUsers');
  });

  it('returns 500 when service throws', async () => {
    metricsService.getDashboardSummary.mockRejectedValueOnce(new Error('fail'));
    const res = await request(app)
      .get('/api/admin/dashboard/summary')
      .set(ADMIN_HDR);
    expect(res.status).toBe(500);
  });
});

// ─── GET /api/admin/dashboard/chart-data ───────────────────────────────
describe('GET /api/admin/dashboard/chart-data', () => {
  it('returns 200 with default params', async () => {
    metricsService.getChartData.mockResolvedValueOnce([{ date: '2026-02-24', bets: 5 }]);

    const res = await request(app)
      .get('/api/admin/dashboard/chart-data')
      .set(ADMIN_HDR);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(metricsService.getChartData).toHaveBeenCalledWith('daily', 30);
  });

  it('passes custom period and days', async () => {
    await request(app)
      .get('/api/admin/dashboard/chart-data?period=monthly&days=90')
      .set(ADMIN_HDR);
    expect(metricsService.getChartData).toHaveBeenCalledWith('monthly', 90);
  });

  it('returns 500 when service throws', async () => {
    metricsService.getChartData.mockRejectedValueOnce(new Error('fail'));
    const res = await request(app)
      .get('/api/admin/dashboard/chart-data')
      .set(ADMIN_HDR);
    expect(res.status).toBe(500);
  });
});

// ─── GET /api/admin/dashboard/realtime ─────────────────────────────────
describe('GET /api/admin/dashboard/realtime', () => {
  it('returns 200 with realtime metrics', async () => {
    metricsService.getRealTimeMetrics.mockResolvedValueOnce({
      activePlayers: 3,
      openDraws: 1,
    });

    const res = await request(app)
      .get('/api/admin/dashboard/realtime')
      .set(ADMIN_HDR);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('activePlayers');
  });

  it('returns 500 when service throws', async () => {
    metricsService.getRealTimeMetrics.mockRejectedValueOnce(new Error('fail'));
    const res = await request(app)
      .get('/api/admin/dashboard/realtime')
      .set(ADMIN_HDR);
    expect(res.status).toBe(500);
  });
});

// ─── POST /api/admin/dashboard/aggregate ───────────────────────────────
describe('POST /api/admin/dashboard/aggregate', () => {
  it('returns 200 and calls aggregateTodayMetrics', async () => {
    const res = await request(app)
      .post('/api/admin/dashboard/aggregate')
      .set(ADMIN_HDR);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(metricsService.aggregateTodayMetrics).toHaveBeenCalled();
  });

  it('returns 500 when service throws', async () => {
    metricsService.aggregateTodayMetrics.mockRejectedValueOnce(new Error('fail'));
    const res = await request(app)
      .post('/api/admin/dashboard/aggregate')
      .set(ADMIN_HDR);
    expect(res.status).toBe(500);
  });
});
