// Mock ethers before importing — web3Auth does: const { ethers } = require('ethers')
// so the mock module must have an `ethers` property with verifyMessage on it.
const mockVerifyMessage = jest.fn();
jest.mock('ethers', () => ({
  ethers: {
    verifyMessage: mockVerifyMessage,
    isAddress: jest.fn((addr) => /^0x[a-fA-F0-9]{40}$/.test(addr))
  }
}));

const mockClientQuery = jest.fn();
const mockClientRelease = jest.fn();
jest.mock('../../config/database', () => ({
  getClient: jest.fn(async () => ({
    query: mockClientQuery,
    release: mockClientRelease
  }))
}));

jest.mock('../../db', () => ({ query: jest.fn() }));

// Import after mocks
const { authenticateWallet } = require('../web3Auth');

function createMockReqRes(headers = {}) {
  const req = {
    headers: {
      'x-wallet-address': headers.address || '',
      'x-wallet-signature': headers.signature || '',
      'x-wallet-message': headers.message || ''
    }
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis()
  };
  const next = jest.fn();
  return { req, res, next };
}

describe('web3Auth middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ADMIN_WALLETS;
  });

  it('rejects request without wallet address', async () => {
    const { req, res, next } = createMockReqRes();
    await authenticateWallet(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects request without signature', async () => {
    const { req, res, next } = createMockReqRes({
      address: '0x1234567890abcdef1234567890abcdef12345678'
    });
    await authenticateWallet(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects invalid address format', async () => {
    const { req, res, next } = createMockReqRes({
      address: 'not-an-address',
      signature: '0xsig',
      message: 'Bolcoin Auth: 0x1234567890abcdef1234567890abcdef12345678 at 999999999999'
    });
    await authenticateWallet(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects invalid message format', async () => {
    const addr = '0x1234567890abcdef1234567890abcdef12345678';
    const { req, res, next } = createMockReqRes({
      address: addr,
      signature: '0xsig',
      message: 'Invalid message format'
    });
    await authenticateWallet(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Formato') })
    );
  });

  it('rejects mismatched address in message', async () => {
    const addr = '0x1234567890abcdef1234567890abcdef12345678';
    const otherAddr = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
    const ts = Math.floor(Date.now() / 1000);

    const { req, res, next } = createMockReqRes({
      address: addr,
      signature: '0xsig',
      message: `Bolcoin Auth: ${otherAddr} at ${ts}`
    });
    await authenticateWallet(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects expired timestamp (seconds-based)', async () => {
    const addr = '0x1234567890abcdef1234567890abcdef12345678';
    const expiredTs = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago

    const { req, res, next } = createMockReqRes({
      address: addr,
      signature: '0xsig',
      message: `Bolcoin Auth: ${addr} at ${expiredTs}`
    });
    await authenticateWallet(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('expirada') })
    );
  });

  it('rejects when signature verification fails', async () => {
    const addr = '0x1234567890abcdef1234567890abcdef12345678';
    const ts = Math.floor(Date.now() / 1000);

    mockVerifyMessage.mockReturnValue('0xdifferentaddress000000000000000000000000');

    const { req, res, next } = createMockReqRes({
      address: addr,
      signature: '0xbadsig',
      message: `Bolcoin Auth: ${addr} at ${ts}`
    });
    await authenticateWallet(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('authenticates valid request and looks up user', async () => {
    const addr = '0x1234567890abcdef1234567890abcdef12345678';
    const ts = Math.floor(Date.now() / 1000);

    mockVerifyMessage.mockReturnValue(addr);
    mockClientQuery.mockResolvedValueOnce({
      rows: [{ id: 42 }]
    });

    const { req, res, next } = createMockReqRes({
      address: addr,
      signature: '0xvalidsig',
      message: `Bolcoin Auth: ${addr} at ${ts}`
    });
    await authenticateWallet(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user.address).toBe(addr.toLowerCase());
  });

  it('assigns USER role even when ADMIN_WALLETS is empty', async () => {
    const addr = '0x1234567890abcdef1234567890abcdef12345678';
    const ts = Math.floor(Date.now() / 1000);

    process.env.ADMIN_WALLETS = '';
    mockVerifyMessage.mockReturnValue(addr);
    mockClientQuery.mockResolvedValueOnce({
      rows: [{ id: 42 }]
    });

    const { req, res, next } = createMockReqRes({
      address: addr,
      signature: '0xvalidsig',
      message: `Bolcoin Auth: ${addr} at ${ts}`
    });
    await authenticateWallet(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user.role).not.toBe('admin');
  });
});
