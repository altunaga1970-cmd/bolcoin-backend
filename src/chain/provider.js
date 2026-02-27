const ethers = require('ethers');
const LA_BOLITA_ABI = require('./abi/LaBolita.abi.json');

// RPC_URL es la variable canonica; POLYGON_RPC_URL es fallback
const RPC_URL = process.env.RPC_URL || process.env.POLYGON_RPC_URL;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const OPERATOR_PRIVATE_KEY = process.env.OPERATOR_PRIVATE_KEY;
// TOKEN_ADDRESS: USDT contract on the active network (6 decimals on Polygon mainnet + Amoy)
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS || process.env.PAYMENT_TOKEN_ADDRESS;
const USDT_DECIMALS = 6;

// Minimal ERC-20 ABI for token transfer
const ERC20_TRANSFER_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
];

let _provider = null;
let _signer = null;
let _contract = null;

/**
 * Obtener provider JSON-RPC.
 * Lanza error si no hay RPC_URL configurada.
 */
function getProvider() {
    if (!_provider) {
        if (!RPC_URL) {
            throw new Error(
                '[Chain] RPC_URL not configured. Set RPC_URL or POLYGON_RPC_URL env variable.'
            );
        }
        _provider = new ethers.JsonRpcProvider(RPC_URL);
    }
    return _provider;
}

/**
 * Obtener signer (wallet del operador).
 * Lanza error si OPERATOR_PRIVATE_KEY no esta configurada.
 */
function getSigner() {
    if (!_signer) {
        if (!OPERATOR_PRIVATE_KEY) {
            throw new Error(
                '[Chain] OPERATOR_PRIVATE_KEY not configured. Cannot sign transactions.'
            );
        }
        _signer = new ethers.Wallet(OPERATOR_PRIVATE_KEY, getProvider());
    }
    return _signer;
}

/**
 * Obtener instancia del contrato LaBolita.
 * Lanza error controlado si falta CONTRACT_ADDRESS o RPC_URL.
 */
function getLaBolitaContract() {
    if (!_contract) {
        if (!CONTRACT_ADDRESS) {
            throw new Error(
                '[Chain] CONTRACT_ADDRESS not configured. Set CONTRACT_ADDRESS env variable.'
            );
        }
        // getSigner() ya valida RPC_URL y OPERATOR_PRIVATE_KEY
        _contract = new ethers.Contract(CONTRACT_ADDRESS, LA_BOLITA_ABI, getSigner());
        console.log('[Chain] LaBolita contract initialized:', CONTRACT_ADDRESS);
    }
    return _contract;
}

/**
 * Transfer USDT from the operator wallet to a recipient address.
 *
 * Pattern (H-04 fix):
 *   1. Submit ERC-20 transfer transaction
 *   2. Wait for 1 on-chain confirmation (60s timeout)
 *   3. Return txHash on success; throw on revert or timeout
 *
 * @param {string} toAddress  - Recipient wallet address
 * @param {string|number} amountUsdt - Amount in USDT (e.g. "10.50")
 * @returns {Promise<string>} Transaction hash
 */
async function sendUsdtTransfer(toAddress, amountUsdt) {
    if (!TOKEN_ADDRESS) {
        throw new Error(
            '[Chain] TOKEN_ADDRESS not configured. Set TOKEN_ADDRESS env variable.'
        );
    }

    const signer = getSigner(); // throws if OPERATOR_PRIVATE_KEY missing
    const token = new ethers.Contract(TOKEN_ADDRESS, ERC20_TRANSFER_ABI, signer);
    const amountUnits = ethers.parseUnits(String(amountUsdt), USDT_DECIMALS);

    const tx = await token.transfer(toAddress, amountUnits);
    console.log(`[Chain] USDT transfer submitted: ${tx.hash} → ${toAddress} (${amountUsdt} USDT)`);

    // Wait for 1 confirmation with 60s timeout
    const TIMEOUT_MS = 60_000;
    const receipt = await Promise.race([
        tx.wait(1),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Transfer timed out after ${TIMEOUT_MS / 1000}s: ${tx.hash}`)), TIMEOUT_MS)
        ),
    ]);

    if (!receipt || receipt.status !== 1) {
        throw new Error(`[Chain] Transfer reverted on-chain: ${tx.hash}`);
    }

    console.log(`[Chain] USDT transfer confirmed: ${tx.hash} (block ${receipt.blockNumber})`);
    return tx.hash;
}

module.exports = {
    getProvider,
    getSigner,
    getLaBolitaContract,
    sendUsdtTransfer,
    LA_BOLITA_ABI
};
