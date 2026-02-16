const ethers = require('ethers');
const KenoGameABI = require('./abi/KenoGame.abi.json');

const KENO_CONTRACT_ADDRESS = process.env.KENO_CONTRACT_ADDRESS;

// Reuse provider/signer from existing chain provider
const { getProvider, getSigner } = require('./provider');

let _kenoContract = null;

/**
 * Get read-only KenoGame contract instance (uses provider).
 */
function getKenoContractReadOnly() {
  if (!KENO_CONTRACT_ADDRESS) {
    throw new Error('[Chain] KENO_CONTRACT_ADDRESS not configured.');
  }
  return new ethers.Contract(KENO_CONTRACT_ADDRESS, KenoGameABI, getProvider());
}

/**
 * Get writable KenoGame contract instance (uses signer).
 * Caches the instance.
 */
function getKenoContract() {
  if (!_kenoContract) {
    if (!KENO_CONTRACT_ADDRESS) {
      throw new Error('[Chain] KENO_CONTRACT_ADDRESS not configured.');
    }
    _kenoContract = new ethers.Contract(KENO_CONTRACT_ADDRESS, KenoGameABI, getSigner());
    console.log('[Chain] KenoGame contract initialized:', KENO_CONTRACT_ADDRESS);
  }
  return _kenoContract;
}

/**
 * Check if the Keno contract is configured (address set in env).
 */
function isKenoOnChain() {
  return !!KENO_CONTRACT_ADDRESS;
}

module.exports = {
  getKenoContract,
  getKenoContractReadOnly,
  isKenoOnChain,
  KENO_CONTRACT_ADDRESS,
};
