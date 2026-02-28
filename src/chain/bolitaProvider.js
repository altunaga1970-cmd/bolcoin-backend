/**
 * La Bolita Contract Provider
 *
 * Exposes read-only and writable LaBolitaGame contract instances.
 * Writable instance uses a NonceManager-wrapped signer to serialize
 * nonce assignment across concurrent draw lifecycle operations.
 */

const ethers = require('ethers');
const LaBolitaABI = require('./abi/LaBolita.abi.json');
const { getProvider, getSigner } = require('./provider');

const BOLITA_CONTRACT_ADDRESS = process.env.BOLITA_CONTRACT_ADDRESS;

// ── Nonce-managed signer ───────────────────────────────────────────────────
// Serializes nonce assignment so concurrent draw operations (create, open,
// close, resolve) don't collide on the same operator wallet.
let _nonceManagedSigner = null;

function getNonceManagedSigner() {
  if (!_nonceManagedSigner) {
    _nonceManagedSigner = new ethers.NonceManager(getSigner());
  }
  return _nonceManagedSigner;
}

// Gas overrides for Polygon Amoy — eth_maxPriorityFeePerGas not supported.
const AMOY_GAS_OVERRIDES = {
  maxPriorityFeePerGas: ethers.parseUnits('30', 'gwei'),
  maxFeePerGas:         ethers.parseUnits('35', 'gwei'),
};

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
 * Reset the NonceManager so it re-reads the nonce from the chain on the next tx.
 * Call this when a NONCE_EXPIRED error is caught.
 */
function resetNonceManager() {
  if (_nonceManagedSigner) {
    _nonceManagedSigner.reset();
    console.log('[Chain] Bolita NonceManager reset — will re-sync nonce from chain on next tx');
  }
}

/**
 * Returns true if the error is a nonce-related rejection from the node.
 */
function isNonceError(err) {
  return err.code === 'NONCE_EXPIRED'
    || err.message?.includes('nonce too low')
    || err.message?.includes('nonce has already been used');
}

module.exports = {
  getBolitaContract,
  getBolitaContractReadOnly,
  BOLITA_CONTRACT_ADDRESS,
  AMOY_GAS_OVERRIDES,
  resetNonceManager,
  isNonceError,
};
