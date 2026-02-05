const { ethers } = require('ethers');
const { VRF_CONFIG, AUDIT_ACTIONS } = require('../config/constants');
const Draw = require('../models/Draw');
const AuditLog = require('../models/AuditLog');
const { query } = require('../config/database');

// =================================
// SERVICIO VRF (Chainlink)
// =================================

/**
 * ABI mínimo para interactuar con el contrato VRF
 */
const VRF_CONSUMER_ABI = [
    'function requestRandomWords() external returns (uint256 requestId)',
    'function lastRequestId() external view returns (uint256)',
    'function s_requests(uint256) external view returns (bool fulfilled, bool exists, uint256[] randomWords)',
    'event RandomWordsRequested(uint256 indexed requestId, address requester)',
    'event RandomWordsFulfilled(uint256 indexed requestId, uint256[] randomWords)'
];

/**
 * ABI del contrato principal LaBolita
 */
const LA_BOLITA_ABI = [
    'function requestDrawResult(uint256 drawId) external returns (uint256 requestId)',
    'function fulfillRandomWords(uint256 requestId, uint256[] randomWords) internal',
    'function getDrawResult(uint256 drawId) external view returns (uint256 result, bool fulfilled)',
    'event DrawResultRequested(uint256 indexed drawId, uint256 indexed requestId)',
    'event DrawResultFulfilled(uint256 indexed drawId, uint256 result)'
];

class VRFService {
    constructor() {
        this.provider = null;
        this.signer = null;
        this.contract = null;
        this.isInitialized = false;
    }

    /**
     * Inicializar el servicio con provider y signer
     */
    async initialize() {
        try {
            const rpcUrl = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
            const privateKey = process.env.OPERATOR_PRIVATE_KEY;

            if (!privateKey) {
                console.warn('VRF Service: OPERATOR_PRIVATE_KEY no configurada. Modo simulación activado.');
                this.isInitialized = false;
                return false;
            }

            this.provider = new ethers.JsonRpcProvider(rpcUrl);
            this.signer = new ethers.Wallet(privateKey, this.provider);

            const contractAddress = process.env.CONTRACT_ADDRESS;
            if (contractAddress) {
                this.contract = new ethers.Contract(contractAddress, LA_BOLITA_ABI, this.signer);
            }

            this.isInitialized = true;
            console.log('VRF Service inicializado correctamente');
            return true;
        } catch (error) {
            console.error('Error inicializando VRF Service:', error);
            this.isInitialized = false;
            return false;
        }
    }

    /**
     * Solicitar número aleatorio VRF para un sorteo
     * @param {number} drawId - ID del sorteo
     * @returns {Object} - { success, requestId, error }
     */
    async requestRandomNumber(drawId) {
        try {
            const draw = await Draw.findById(drawId);
            if (!draw) {
                throw new Error('Sorteo no encontrado');
            }

            if (draw.status !== 'closed') {
                throw new Error(`Estado inválido para VRF: ${draw.status}`);
            }

            // Si no está inicializado, usar modo simulación
            if (!this.isInitialized || !this.contract) {
                return await this.simulateVrfRequest(drawId);
            }

            // Solicitar al contrato
            const tx = await this.contract.requestDrawResult(drawId);
            const receipt = await tx.wait();

            // Buscar el evento
            const event = receipt.logs.find(log => {
                try {
                    const parsed = this.contract.interface.parseLog(log);
                    return parsed.name === 'DrawResultRequested';
                } catch {
                    return false;
                }
            });

            let requestId;
            if (event) {
                const parsed = this.contract.interface.parseLog(event);
                requestId = parsed.args.requestId.toString();
            } else {
                requestId = receipt.hash;
            }

            // Actualizar sorteo
            await Draw.setVrfRequested(drawId, requestId);

            // Registrar en BD
            await this.saveVrfRequest(drawId, requestId, receipt.hash);

            // Audit log
            await AuditLog.logDrawAction(
                AUDIT_ACTIONS.DRAW_VRF_REQUESTED,
                drawId,
                'system',
                { requestId, txHash: receipt.hash }
            );

            return { success: true, requestId, txHash: receipt.hash };
        } catch (error) {
            console.error('Error solicitando VRF:', error);

            await AuditLog.logError(
                AUDIT_ACTIONS.VRF_ERROR,
                error,
                { drawId, action: 'request' }
            );

            return { success: false, error: error.message };
        }
    }

    /**
     * Modo simulación: generar número aleatorio localmente
     * SOLO PARA DESARROLLO - En producción usar Chainlink VRF real
     */
    async simulateVrfRequest(drawId) {
        console.warn(`VRF SIMULADO para sorteo ${drawId} - Solo para desarrollo!`);

        const requestId = `sim_${Date.now()}_${Math.random().toString(36).substring(7)}`;

        // Actualizar sorteo
        await Draw.setVrfRequested(drawId, requestId);

        // Guardar request
        await this.saveVrfRequest(drawId, requestId, null);

        // Simular delay de VRF (1-3 segundos)
        setTimeout(async () => {
            await this.simulateVrfFulfillment(drawId, requestId);
        }, 1000 + Math.random() * 2000);

        await AuditLog.logDrawAction(
            AUDIT_ACTIONS.DRAW_VRF_REQUESTED,
            drawId,
            'system',
            { requestId, simulated: true }
        );

        return { success: true, requestId, simulated: true };
    }

    /**
     * Simular respuesta VRF
     */
    async simulateVrfFulfillment(drawId, requestId) {
        try {
            const draw = await Draw.findById(drawId);
            if (!draw || draw.status !== 'vrf_requested') {
                return;
            }

            // Generar número aleatorio
            const randomWord = BigInt(Math.floor(Math.random() * 2 ** 256)).toString();

            // Calcular número ganador según tipo de sorteo
            let winningNumber;
            if (draw.draw_type === 'lottery') {
                // La Fortuna: 6 números del 1-49 + clave 0-9
                const numbers = this.generateLotteryNumbers(randomWord);
                const keyNumber = parseInt(randomWord) % 10;
                await Draw.setLotteryResults(drawId, numbers, keyNumber);
                winningNumber = numbers.join(',') + '+' + keyNumber;
            } else {
                // La Bolita: número de 4 dígitos
                winningNumber = (parseInt(randomWord) % 10000).toString().padStart(4, '0');
            }

            // Actualizar sorteo
            await Draw.setVrfFulfilled(drawId, randomWord, winningNumber);

            // Actualizar request
            await this.updateVrfRequest(requestId, 'fulfilled', randomWord);

            await AuditLog.logDrawAction(
                AUDIT_ACTIONS.DRAW_VRF_FULFILLED,
                drawId,
                'system',
                { requestId, randomWord, winningNumber, simulated: true }
            );

            console.log(`VRF simulado completado para sorteo ${drawId}: ${winningNumber}`);
        } catch (error) {
            console.error('Error en simulación VRF:', error);
            await this.updateVrfRequest(requestId, 'failed', null, error.message);
        }
    }

    /**
     * Generar números de lotería a partir de un número aleatorio
     */
    generateLotteryNumbers(randomWord) {
        const numbers = new Set();
        let seed = BigInt(randomWord);

        while (numbers.size < 6) {
            seed = (seed * BigInt(1103515245) + BigInt(12345)) % BigInt(2 ** 31);
            const num = (Number(seed % BigInt(49)) + 1);
            numbers.add(num);
        }

        return Array.from(numbers).sort((a, b) => a - b);
    }

    /**
     * Convertir número VRF a número de 4 dígitos para La Bolita
     */
    vrfToWinningNumber(randomWord) {
        const bigNum = BigInt(randomWord);
        const fourDigit = Number(bigNum % BigInt(10000));
        return fourDigit.toString().padStart(4, '0');
    }

    /**
     * Guardar request VRF en BD
     */
    async saveVrfRequest(drawId, requestId, txHash) {
        const text = `
            INSERT INTO vrf_requests (draw_id, request_id, tx_hash, status)
            VALUES ($1, $2, $3, 'pending')
            ON CONFLICT (request_id) DO NOTHING
            RETURNING *
        `;
        try {
            await query(text, [drawId, requestId, txHash]);
        } catch (error) {
            console.error('Error guardando VRF request:', error);
        }
    }

    /**
     * Actualizar request VRF
     */
    async updateVrfRequest(requestId, status, randomWord = null, errorMessage = null) {
        const text = `
            UPDATE vrf_requests
            SET status = $1,
                random_word = $2,
                fulfilled_at = CASE WHEN $1 = 'fulfilled' THEN NOW() ELSE fulfilled_at END,
                error_message = $3
            WHERE request_id = $4
        `;
        try {
            await query(text, [status, randomWord, errorMessage, requestId]);
        } catch (error) {
            console.error('Error actualizando VRF request:', error);
        }
    }

    /**
     * Verificar estado de un request VRF
     */
    async checkVrfStatus(requestId) {
        const text = `SELECT * FROM vrf_requests WHERE request_id = $1`;
        const result = await query(text, [requestId]);
        return result.rows[0] || null;
    }

    /**
     * Listener para eventos VRF (para producción)
     */
    async startEventListener() {
        if (!this.isInitialized || !this.contract) {
            console.log('VRF Event Listener: Modo simulación, no se escuchan eventos on-chain');
            return;
        }

        this.contract.on('DrawResultFulfilled', async (drawId, result, event) => {
            console.log(`VRF Fulfilled: Draw ${drawId}, Result ${result}`);

            try {
                const winningNumber = result.toString().padStart(4, '0').slice(-4);
                await Draw.setVrfFulfilled(drawId.toString(), result.toString(), winningNumber);

                await AuditLog.logDrawAction(
                    AUDIT_ACTIONS.DRAW_VRF_FULFILLED,
                    drawId.toString(),
                    'system',
                    { result: result.toString(), winningNumber, txHash: event.transactionHash }
                );
            } catch (error) {
                console.error('Error procesando evento VRF:', error);
            }
        });

        console.log('VRF Event Listener iniciado');
    }

    /**
     * Detener listener
     */
    stopEventListener() {
        if (this.contract) {
            this.contract.removeAllListeners();
        }
    }
}

// Singleton
const vrfService = new VRFService();

module.exports = vrfService;
