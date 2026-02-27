const ethers = require('ethers');
const BingoGameABI = require('./abi/BingoGame.abi.json');

const BINGO_CONTRACT_ADDRESS = process.env.BINGO_CONTRACT_ADDRESS;

const { getProvider, getSigner } = require('./provider');

// ── Nonce-managed signer ───────────────────────────────────────────────────
// Four room loops share a single operator wallet. ethers.Wallet resolves
// nonces via eth_getTransactionCount('pending'), which is not safe for
// concurrent callers — two rooms can read the same pending nonce and both
// submit txs that collide. NonceManager serialises nonce assignment so each
// call gets a unique, sequentially incremented nonce.
let _nonceManagedSigner = null;

function getNonceManagedSigner() {
  if (!_nonceManagedSigner) {
    _nonceManagedSigner = new ethers.NonceManager(getSigner());
  }
  return _nonceManagedSigner;
}

// Gas overrides for Polygon Amoy — eth_maxPriorityFeePerGas is not supported
// on Amoy so MetaMask/ethers underestimates. Hardcode safe minimums.
const AMOY_GAS_OVERRIDES = {
  maxPriorityFeePerGas: ethers.parseUnits('30', 'gwei'),
  maxFeePerGas:         ethers.parseUnits('35', 'gwei'),
};

let _bingoContract = null;

/**
 * Get read-only BingoGame contract instance (uses provider).
 */
function getBingoContractReadOnly() {
  if (!BINGO_CONTRACT_ADDRESS) {
    throw new Error('[Chain] BINGO_CONTRACT_ADDRESS not configured.');
  }
  return new ethers.Contract(BINGO_CONTRACT_ADDRESS, BingoGameABI, getProvider());
}

/**
 * Get writable BingoGame contract instance (uses NonceManager-wrapped signer).
 * Caches the instance.
 */
function getBingoContract() {
  if (!_bingoContract) {
    if (!BINGO_CONTRACT_ADDRESS) {
      throw new Error('[Chain] BINGO_CONTRACT_ADDRESS not configured.');
    }
    _bingoContract = new ethers.Contract(BINGO_CONTRACT_ADDRESS, BingoGameABI, getNonceManagedSigner());
    console.log('[Chain] BingoGame contract initialized:', BINGO_CONTRACT_ADDRESS);
  }
  return _bingoContract;
}

/**
 * Check if the Bingo contract is configured (address set in env).
 */
function isBingoOnChain() {
  return !!BINGO_CONTRACT_ADDRESS;
}

module.exports = {
  getBingoContract,
  getBingoContractReadOnly,
  isBingoOnChain,
  BINGO_CONTRACT_ADDRESS,
  AMOY_GAS_OVERRIDES,
};
