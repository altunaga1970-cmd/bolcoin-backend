const ethers = require('ethers');
const LA_BOLITA_ABI = require('./abi/LaBolita.abi.json');

// RPC_URL es la variable canonica; POLYGON_RPC_URL es fallback
const RPC_URL = process.env.RPC_URL || process.env.POLYGON_RPC_URL;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const OPERATOR_PRIVATE_KEY = process.env.OPERATOR_PRIVATE_KEY;

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

module.exports = {
    getProvider,
    getSigner,
    getLaBolitaContract,
    LA_BOLITA_ABI
};
