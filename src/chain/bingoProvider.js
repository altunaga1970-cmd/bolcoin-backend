const ethers = require('ethers');
const BingoGameABI = require('./abi/BingoGame.abi.json');

const BINGO_CONTRACT_ADDRESS = process.env.BINGO_CONTRACT_ADDRESS;

const { getProvider, getSigner } = require('./provider');

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
 * Get writable BingoGame contract instance (uses signer).
 * Caches the instance.
 */
function getBingoContract() {
  if (!_bingoContract) {
    if (!BINGO_CONTRACT_ADDRESS) {
      throw new Error('[Chain] BINGO_CONTRACT_ADDRESS not configured.');
    }
    _bingoContract = new ethers.Contract(BINGO_CONTRACT_ADDRESS, BingoGameABI, getSigner());
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
};
