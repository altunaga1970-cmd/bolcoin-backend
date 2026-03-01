const ethers = require('ethers');
const BingoGameABI = require('./abi/BingoGame.abi.json');

const BINGO_CONTRACT_ADDRESS = process.env.BINGO_CONTRACT_ADDRESS;

const { getProvider, getNonceManagedSigner, GAS_OVERRIDES } = require('./provider');

// Re-export as AMOY_GAS_OVERRIDES for backwards compatibility with callers
// that destructure it from this module.
const AMOY_GAS_OVERRIDES = GAS_OVERRIDES;

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

/**
 * Reset the shared NonceManager.
 * Delegates to provider.js so all contracts share one reset.
 */
function resetNonceManager() {
  const { resetNonceManagedSigner } = require('./provider');
  resetNonceManagedSigner();
}

/**
 * Returns true if the error is a nonce-related rejection from the node.
 */
function isNonceError(err) {
  const { isNonceError: _isNonceError } = require('./provider');
  return _isNonceError(err);
}

module.exports = {
  getBingoContract,
  getBingoContractReadOnly,
  isBingoOnChain,
  BINGO_CONTRACT_ADDRESS,
  AMOY_GAS_OVERRIDES,
  resetNonceManager,
  isNonceError,
};
