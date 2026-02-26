/**
 * Integration tests: Draw endpoints
 */
const request = require('supertest');
const { app, resetMocks } = require('./helpers/testApp');
const drawController = require('../../controllers/drawController');

beforeEach(() => resetMocks());

// ─── GET /api/draws/active ──────────────────────────────────────────────
describe('GET /api/draws/active', () => {
  it('returns 200 with active draws', async () => {
    const res = await request(app).get('/api/draws/active');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('calls drawController.getActive', async () => {
    await request(app).get('/api/draws/active');
    expect(drawController.getActive).toHaveBeenCalled();
  });
});

// ─── GET /api/draws/upcoming ────────────────────────────────────────────
describe('GET /api/draws/upcoming', () => {
  it('returns 200 with upcoming draws', async () => {
    const res = await request(app).get('/api/draws/upcoming');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('accepts limit query param', async () => {
    const res = await request(app).get('/api/draws/upcoming?limit=10');
    expect(res.status).toBe(200);
    expect(drawController.getUpcoming).toHaveBeenCalled();
  });
});

// ─── GET /api/draws/completed ───────────────────────────────────────────
describe('GET /api/draws/completed', () => {
  it('returns 200 with completed draws', async () => {
    const res = await request(app).get('/api/draws/completed');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('accepts pagination query params', async () => {
    const res = await request(app).get('/api/draws/completed?page=1&limit=10');
    expect(res.status).toBe(200);
    expect(drawController.getCompleted).toHaveBeenCalled();
  });
});

// ─── GET /api/draws/:id ─────────────────────────────────────────────────
describe('GET /api/draws/:id', () => {
  it('returns 200 for a specific draw', async () => {
    const res = await request(app).get('/api/draws/1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('calls drawController.getById', async () => {
    await request(app).get('/api/draws/42');
    expect(drawController.getById).toHaveBeenCalled();
  });
});

// ─── GET /api/draws/:id/results ─────────────────────────────────────────
describe('GET /api/draws/:id/results', () => {
  it('returns 200 for draw results', async () => {
    const res = await request(app).get('/api/draws/1/results');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('calls drawController.getResults', async () => {
    await request(app).get('/api/draws/5/results');
    expect(drawController.getResults).toHaveBeenCalled();
  });
});
