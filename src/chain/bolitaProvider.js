/**
 * La Bolita Contract Provider
 *
 * Exposes read-only and writable LaBolitaGame contract instances.
 * Writable instance uses a NonceManager-wrapped signer to serialize
 * nonce assignment across concurrent draw lifecycle operations.
 */

const ethers = require('ethers');
const LaBolitaABI = require('./abi/LaBolita.abi.json');
const { getProvider, getNonceManagedSigner, GAS_OVERRIDES } = require('./provider');

const BOLITA_CONTRACT_ADDRESS = process.env.BOLITA_CONTRACT_ADDRESS;

// Re-export as AMOY_GAS_OVERRIDES for backwards compatibility with callers.
const AMOY_GAS_OVERRIDES = GAS_OVERRIDES;

let _bolitaContract = null;

/**
 * Get a read-only LaBolitaGame contract instance (provider only).
 */
function getBolitaContractReadOnly() {
  if (!BOLITA_CONTRACT_ADDRESS) {
    throw new Error('[Chain] BOLITA_CONTRACT_ADDRESS not configured.');
  }
  return new ethers.Contract(BOLITA_CONTRACT_ADDRESS, LaBolitaABI, getProvider());
}

/**
 * Get a writable LaBolitaGame contract instance (NonceManager signer).
 * Cached — always returns the same instance.
 */
function getBolitaContract() {
  if (!_bolitaContract) {
    if (!BOLITA_CONTRACT_ADDRESS) {
      throw new Error('[Chain] BOLITA_CONTRACT_ADDRESS not configured.');
    }
    _bolitaContract = new ethers.Contract(
      BOLITA_CONTRACT_ADDRESS,
      LaBolitaABI,
      getNonceManagedSigner()
    );
    console.log('[Chain] LaBolitaGame contract initialized:', BOLITA_CONTRACT_ADDRESS);
  }
  return _bolitaContract;
}

/**
 * Reset the shared NonceManager.
 * Delegates to provider.js so Bingo and Bolita share one reset.
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
  getBolitaContract,
  getBolitaContractReadOnly,
  BOLITA_CONTRACT_ADDRESS,
  AMOY_GAS_OVERRIDES,
  resetNonceManager,
  isNonceError,
};
