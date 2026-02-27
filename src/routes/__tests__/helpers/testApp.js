/**
 * Test App Helper
 *
 * Sets up all necessary mocks BEFORE requiring the Express app,
 * then exports a supertest-ready app instance.
 *
 * Usage in test files:
 *   const { app, mockDb, mockFeatureFlags, mockGameConfig } = require('./helpers/testApp');
 *   const request = require('supertest');
 *   // ...
 *   const res = await request(app).get('/health');
 */

// ── Environment ──────────────────────────────────────────────────────────
process.env.NODE_ENV = 'test';
process.env.OPERATOR_WALLET = '0x' + '1'.repeat(40);
process.env.SESSION_SECRET = 'test-session-secret-not-dev';

// ── Mock: database (config/database) ─────────────────────────────────────
const mockClient = {
  query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  release: jest.fn(),
};

const mockDb = {
  pool: { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }), on: jest.fn() },
  query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  getClient: jest.fn().mockResolvedValue(mockClient),
  testConnection: jest.fn().mockResolvedValue(true),
  dbAvailable: true,
  setDbAvailable: jest.fn(),
  __mockClient: mockClient,
};

jest.mock('../../../config/database', () => mockDb);

// ── Mock: db (re-export of pool) ─────────────────────────────────────────
jest.mock('../../../db', () => ({
  query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  connect: jest.fn().mockResolvedValue(mockClient),
  on: jest.fn(),
}));

// ── Mock: ethers (for web3Auth) ──────────────────────────────────────────
jest.mock('ethers', () => ({
  ethers: {
    verifyMessage: jest.fn().mockReturnValue('0x' + 'a'.repeat(40)),
    isAddress: jest.fn().mockReturnValue(true),
  },
}));

// ── Mock: featureFlagService ─────────────────────────────────────────────
const mockFeatureFlags = {
  getFlagsSimple: jest.fn().mockResolvedValue({
    game_keno: true,
    game_bolita: false,
    game_fortuna: false,
    bingo_enabled: true,
    maintenance_mode: false,
  }),
  isEnabled: jest.fn().mockResolvedValue(true),
  isEnabledForWallet: jest.fn().mockResolvedValue(true),
  isMaintenanceMode: jest.fn().mockResolvedValue(false),
  getAllFlags: jest.fn().mockResolvedValue([]),
  setFlag: jest.fn().mockResolvedValue({ key: 'test', enabled: true }),
  getWhitelistedWallets: jest.fn().mockResolvedValue([]),
  addWalletToFlag: jest.fn().mockResolvedValue(undefined),
  removeWalletFromFlag: jest.fn().mockResolvedValue(undefined),
  invalidateCache: jest.fn(),
};

jest.mock('../../../services/featureFlagService', () => mockFeatureFlags);

// ── Mock: gameConfigService ──────────────────────────────────────────────
const mockGameConfig = {
  getPublicConfig: jest.fn().mockResolvedValue({
    keno: {
      betAmount: 1,
      feeBps: 1200,
      maxPayout: 50,
      poolBalance: 500,
      minSpots: 1,
      maxSpots: 10,
      totalNumbers: 80,
      drawnNumbers: 20,
    },
    system: { rngMethod: 'sha256_server_seed' },
  }),
  getKenoConfig: jest.fn().mockResolvedValue({
    betAmount: 1,
    feeBps: 1200,
    maxPayout: 50,
  }),
  getConfig: jest.fn().mockResolvedValue({}),
  getConfigValue: jest.fn().mockResolvedValue(null),
  getAllConfig: jest.fn().mockResolvedValue({ keno_bet_amount: 1, bingo_enabled: true }),
  setConfigValue: jest.fn().mockResolvedValue({ key: 'test', value: 'val' }),
  calculateBetFee: jest.fn().mockReturnValue(0.12),
  MVP_DEFAULTS: {
    keno_bet_amount: 1,
    keno_fee_bps: 1200,
    bingo_enabled: true,
  },
  invalidateCache: jest.fn(),
};

jest.mock('../../../services/gameConfigService', () => mockGameConfig);

// ── Mock: kenoService ────────────────────────────────────────────────────
jest.mock('../../../services/kenoService', () => ({
  getConfig: jest.fn().mockResolvedValue({
    betAmount: 1,
    feeBps: 1200,
    maxPayout: 50,
    payoutTable: {},
    minSpots: 1,
    maxSpots: 10,
  }),
  playKeno: jest.fn(),
}));

// ── Mock: kenoSessionService ─────────────────────────────────────────────
jest.mock('../../../services/kenoSessionService', () => ({
  getOrCreateSession: jest.fn(),
  settleSession: jest.fn(),
  getSessionNetResult: jest.fn(),
  signSettlement: jest.fn(),
}));

// ── Mock: kenoVrfService ─────────────────────────────────────────────────
jest.mock('../../../services/kenoVrfService', () => ({
  createCommit: jest.fn(),
  verifyAndReveal: jest.fn(),
}));

// ── Mock: kenoPoolHealthService ──────────────────────────────────────────
jest.mock('../../../services/kenoPoolHealthService', () => ({
  getPoolHealth: jest.fn().mockResolvedValue({ status: 'healthy', balance: 500 }),
}));

// ── Mock: bingoScheduler (auto-starts in app.js) ─────────────────────────
jest.mock('../../../services/bingoScheduler', () => ({
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn(),
  getRoomStates: jest.fn().mockReturnValue({}),
}));

// ── Mock: bingoSchedulerOnChain ──────────────────────────────────────────
jest.mock('../../../services/bingoSchedulerOnChain', () => ({
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn(),
}));

// ── Mock: bingoEventService ──────────────────────────────────────────────
jest.mock('../../../services/bingoEventService', () => ({
  bingoEventService: { start: jest.fn().mockResolvedValue(undefined), stop: jest.fn() },
}));

// ── Mock: bolitaIndexer ──────────────────────────────────────────────────
jest.mock('../../../services/bolitaIndexer', () => ({
  bolitaIndexer: { start: jest.fn().mockResolvedValue(undefined), stop: jest.fn() },
}));

// ── Mock: bingoService (used by bingo routes) ────────────────────────────
jest.mock('../../../services/bingoService', () => ({
  getConfig: jest.fn().mockResolvedValue({
    feeBps: 1000,
    reserveBps: 1000,
    linePrizeBps: 1500,
    bingoPrizeBps: 8500,
    cardPrice: '1.00',
    jackpot: '2500.00',
  }),
  getRooms: jest.fn().mockResolvedValue([]),
  getRounds: jest.fn().mockResolvedValue([]),
  getRoundDetail: jest.fn().mockResolvedValue(null),
  buyCards: jest.fn(),
  getMyRooms: jest.fn().mockResolvedValue([]),
  getMyCards: jest.fn().mockResolvedValue([]),
  getUserHistory: jest.fn().mockResolvedValue([]),
  getVerificationData: jest.fn().mockResolvedValue(null),
  createRound: jest.fn(),
  closeRound: jest.fn(),
  cancelRound: jest.fn(),
  getAdminStats: jest.fn().mockResolvedValue({}),
  getActiveRooms: jest.fn().mockResolvedValue([]),
  getJackpotBalance: jest.fn().mockResolvedValue('0.00'),
  getPlayerCounts: jest.fn().mockResolvedValue({}),
  getUserActiveRooms: jest.fn().mockResolvedValue([]),
}));

// ── Mock: walletService (used by walletController) ───────────────────────
jest.mock('../../../services/walletService', () => ({
  recharge: jest.fn().mockResolvedValue({ balance: 110, transaction: { id: 1 } }),
  getBalance: jest.fn().mockResolvedValue({ balance: '100.00', wallet_address: '0x' + 'a'.repeat(40) }),
  getTransactions: jest.fn().mockResolvedValue({ transactions: [], total: 0 }),
}));

// ── Mock: vrfService (auto-starts in server.js but not in app.js) ────────
jest.mock('../../../services/vrfService', () => ({
  initialize: jest.fn().mockResolvedValue(false),
  startEventListener: jest.fn(),
  stopEventListener: jest.fn(),
}));

// ── Mock: chain/provider ─────────────────────────────────────────────────
jest.mock('../../../chain/provider', () => ({
  getLaBolitaContract: jest.fn(),
  getKenoContract: jest.fn(),
  getBingoContract: jest.fn(),
}));

// ── Mock: auth middleware (JWT-based admin auth) ─────────────────────────
jest.mock('../../../middleware/auth', () => ({
  authenticate: jest.fn((req, res, next) => {
    if (req.headers.authorization === 'Bearer test-admin-jwt') {
      req.adminUser = { id: 1, address: '0x' + 'a'.repeat(40), role: 'admin' };
      return next();
    }
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }),
  requireAdmin: jest.fn((req, res, next) => {
    if (req.adminUser || (req.user && req.user.role === 'admin')) {
      return next();
    }
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }),
  optionalAuth: jest.fn((req, res, next) => next()),
}));

// ── Mock: controllers ────────────────────────────────────────────────────
const mockJsonHandler = (data = {}) => jest.fn((req, res) => res.json({ success: true, data }));

jest.mock('../../../controllers/drawController', () => ({
  getActive: mockJsonHandler([]),
  getUpcoming: mockJsonHandler([]),
  getCompleted: mockJsonHandler([]),
  getById: mockJsonHandler(null),
  getResults: mockJsonHandler(null),
}));

jest.mock('../../../controllers/walletController', () => ({
  recharge: mockJsonHandler({ balance: 110 }),
  getBalance: mockJsonHandler({ balance: '100.00' }),
  getTransactions: mockJsonHandler({ transactions: [], total: 0 }),
}));

jest.mock('../../../controllers/betController', () => ({
  placeBets: mockJsonHandler(),
  getMyBets: mockJsonHandler([]),
  getBetById: mockJsonHandler(null),
  getBetStats: mockJsonHandler({}),
}));

jest.mock('../../../controllers/adminController', () => ({
  createDraw: mockJsonHandler(),
  enterResults: mockJsonHandler(),
  listDraws: mockJsonHandler([]),
  getDrawStats: mockJsonHandler({}),
  openDraw: mockJsonHandler(),
  closeDraw: mockJsonHandler(),
  listUsers: mockJsonHandler([]),
  getUserById: mockJsonHandler(null),
  adjustBalance: mockJsonHandler(),
  listBets: mockJsonHandler([]),
  getStatistics: mockJsonHandler({}),
  listWithdrawals: mockJsonHandler([]),
  approveWithdrawal: mockJsonHandler(),
  rejectWithdrawal: mockJsonHandler(),
}));

jest.mock('../../../controllers/lotteryController', () => ({
  getLotteryInfo: mockJsonHandler({}),
  purchaseTickets: mockJsonHandler(),
  getMyTickets: mockJsonHandler([]),
  getJackpot: mockJsonHandler({ jackpot: 0 }),
  setDrawResults: mockJsonHandler(),
  getDrawWinners: mockJsonHandler([]),
  listLotteryDraws: mockJsonHandler([]),
}));

jest.mock('../../../controllers/paymentController', () => ({
  getCurrencies: mockJsonHandler([]),
  getMinAmount: mockJsonHandler({}),
  createDeposit: mockJsonHandler({}),
  getDepositStatus: mockJsonHandler({}),
  getDeposits: mockJsonHandler([]),
  requestWithdrawal: mockJsonHandler({}),
  getWithdrawals: mockJsonHandler([]),
  getWithdrawalLimits: mockJsonHandler({}),
  creditDeposit: jest.fn(),
}));

// ── Mock: models ─────────────────────────────────────────────────────────
jest.mock('../../../models/Bet', () => ({}));
jest.mock('../../../models/User', () => ({}));
jest.mock('../../../models/Transaction', () => ({}));
jest.mock('../../../models/Payment', () => ({}));
jest.mock('../../../models/Withdrawal', () => ({}));
jest.mock('../../../models/Draw', () => ({}));

// ── Mock: deep services used by controllers/routes ───────────────────────
jest.mock('../../../services/drawService', () => ({}));
jest.mock('../../../services/payoutService', () => ({}));
jest.mock('../../../services/withdrawalService', () => ({}));
jest.mock('../../../services/betService', () => ({ placeBets: jest.fn(), validateBet: jest.fn() }));
jest.mock('../../../services/lotteryService', () => ({}));
jest.mock('../../../indexer/winnerCalculator', () => ({}));
jest.mock('../../../services/auditService', () => ({
  log: jest.fn(), getAuditLogs: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../../services/bankrollService', () => ({
  getBankrollStatus: jest.fn().mockResolvedValue({
    current_limit_per_number: '50.00',
    min_limit_per_number: '10.00',
    max_limit_per_number: '100.00',
    bankroll_balance: '5000.00',
    prize_reserve: '1000.00',
    total_bets_processed: '200.00',
    total_prizes_paid: '80.00',
    total_fees_collected: '24.00',
  }),
  checkNumberAvailability: jest.fn().mockResolvedValue({ available: true }),
  canAcceptBet: jest.fn().mockResolvedValue(true),
  getFullStatus: jest.fn().mockResolvedValue({}),
  getSoldOutNumbers: jest.fn().mockResolvedValue([]),
  getDrawExposure: jest.fn().mockResolvedValue({ total: 0, by_game_type: {} }),
  getSettlementHistory: jest.fn().mockResolvedValue([]),
  initializeCapital: jest.fn().mockResolvedValue({ success: true }),
  adjustCapital: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('../../../services/claimsService', () => ({
  getUserClaims: jest.fn().mockResolvedValue([]),
  getClaimsSummary: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../../services/dataCleanupService', () => ({
  getStatus: jest.fn().mockResolvedValue({}),
  getCleanupStatus: jest.fn().mockResolvedValue({}),
  getHistory: jest.fn().mockResolvedValue([]),
  getCleanupHistory: jest.fn().mockResolvedValue([]),
  triggerCleanup: jest.fn(),
  runCleanup: jest.fn().mockResolvedValue({ deleted: 0 }),
  shouldRun: jest.fn().mockResolvedValue(false),
  shouldRunCleanup: jest.fn().mockResolvedValue(false),
  aggregateMetricsRange: jest.fn().mockResolvedValue(undefined),
  regenerateMonthlyMetrics: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../services/metricsService', () => ({
  getDashboardMetrics: jest.fn().mockResolvedValue({}),
  getDashboardSummary: jest.fn().mockResolvedValue({}),
  getChartData: jest.fn().mockResolvedValue([]),
  getRealTimeMetrics: jest.fn().mockResolvedValue({}),
  getRealtimeMetrics: jest.fn().mockResolvedValue({}),
  aggregateForDate: jest.fn(),
  aggregateTodayMetrics: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../services/referralAdminService', () => ({
  getStats: jest.fn().mockResolvedValue({}),
  getList: jest.fn().mockResolvedValue([]),
  getCommissions: jest.fn().mockResolvedValue([]),
  getTotals: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../../chain/kenoProvider', () => ({
  getKenoContract: jest.fn(),
}));
jest.mock('../../../config/adminWallets', () => ({
  isAdminWallet: jest.fn().mockReturnValue(false),
  getAdminWallets: jest.fn().mockReturnValue([]),
}));
jest.mock('../../../models/AuditLog', () => ({
  create: jest.fn().mockResolvedValue({}),
}));

// ── Mock: adminAuth middleware (JWT-based) ──────────────────────────────
jest.mock('../../../middleware/adminAuth', () => ({
  requireAdmin: jest.fn((req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.headers['x-admin-token'];
    if (token === 'test-admin-jwt') {
      req.admin = { address: '0x' + 'a'.repeat(40), role: 'superadmin', permissions: ['all'] };
      req.user = { address: '0x' + 'a'.repeat(40), role: 'superadmin' };
      return next();
    }
    return res.status(401).json({ success: false, message: 'Token de admin requerido' });
  }),
  requirePermission: jest.fn(() => (req, res, next) => next()),
}));
jest.mock('../../../models/Claim', () => ({}));
jest.mock('../../../scheduler', () => ({
  start: jest.fn(), stop: jest.fn(), isRunning: jest.fn().mockReturnValue(false),
}));
jest.mock('../../../scheduler/kenoVrfRequester', () => ({
  createBatch: jest.fn(),
}));

// ── Require the app AFTER all mocks ──────────────────────────────────────
const app = require('../../../app');

// ── Auth helper: generate valid wallet headers ───────────────────────────
const TEST_WALLET = '0x' + 'a'.repeat(40);

function walletHeaders(address = TEST_WALLET) {
  const ts = Math.floor(Date.now() / 1000);
  return {
    'x-wallet-address': address,
    'x-wallet-signature': '0xfakesignature',
    'x-wallet-message': `Bolcoin Auth: ${address} at ${ts}`,
  };
}

// Make ethers.verifyMessage return the same address sent in headers
function setupAuthForWallet(address = TEST_WALLET) {
  const { ethers } = require('ethers');
  ethers.verifyMessage.mockReturnValue(address);
  ethers.isAddress.mockReturnValue(true);

  // Mock DB user lookup to return a user
  mockClient.query.mockImplementation((text) => {
    if (typeof text === 'string' && text.includes('SELECT id FROM users')) {
      return Promise.resolve({ rows: [{ id: 42 }], rowCount: 1 });
    }
    if (typeof text === 'string' && text.includes('SELECT balance FROM users')) {
      return Promise.resolve({ rows: [{ balance: '100.00' }], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

// ── Reset helper ─────────────────────────────────────────────────────────
function resetMocks() {
  jest.clearAllMocks();
  mockFeatureFlags.isEnabled.mockResolvedValue(true);
  mockFeatureFlags.isEnabledForWallet.mockResolvedValue(true);
  mockFeatureFlags.isMaintenanceMode.mockResolvedValue(false);
  mockFeatureFlags.getFlagsSimple.mockResolvedValue({
    game_keno: true,
    game_bolita: false,
    game_fortuna: false,
    bingo_enabled: true,
  });
  mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
}

module.exports = {
  app,
  mockDb,
  mockClient,
  mockFeatureFlags,
  mockGameConfig,
  walletHeaders,
  setupAuthForWallet,
  resetMocks,
  TEST_WALLET,
};
