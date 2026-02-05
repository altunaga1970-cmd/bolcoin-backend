const { ethers } = require('ethers');
const MerkleRoot = require('../models/MerkleRoot');
const Claim = require('../models/Claim');
const Draw = require('../models/Draw');
const WinnerCalculator = require('../indexer/winnerCalculator');
const {
    MerkleTree,
    generateWinnersMerkleTree,
    createLeafHash,
    proofToBytes32Array
} = require('../indexer/merkleGenerator');
const AuditLog = require('../models/AuditLog');
const { AUDIT_ACTIONS, SCHEDULER_CONFIG } = require('../config/constants');

// =================================
// SERVICIO DE CLAIMS
// =================================

class ClaimsService {
    /**
     * Generar y publicar Merkle root para un sorteo
     * @param {number} drawId - ID del sorteo
     * @param {string} publisherAddress - Wallet del admin que publica
     */
    static async publishMerkleRoot(drawId, publisherAddress) {
        // Verificar que el sorteo existe y está en estado correcto
        const draw = await Draw.findById(drawId);
        if (!draw) {
            throw new Error('Sorteo no encontrado');
        }

        if (draw.status !== 'settled') {
            throw new Error(`El sorteo debe estar en estado 'settled'. Estado actual: ${draw.status}`);
        }

        // Verificar que no existe ya un Merkle root
        const existingRoot = await MerkleRoot.findByDrawId(drawId);
        if (existingRoot) {
            throw new Error('Ya existe un Merkle root para este sorteo');
        }

        // Obtener ganadores
        const winners = await WinnerCalculator.getWinners(drawId);
        if (winners.length === 0) {
            throw new Error('No hay ganadores para este sorteo');
        }

        console.log(`Generando Merkle tree para ${winners.length} ganadores...`);

        // Generar Merkle tree
        const { tree, root, proofs } = generateWinnersMerkleTree(winners);

        // Calcular fecha de expiración
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + SCHEDULER_CONFIG.CLAIMS_PERIOD_DAYS);

        // Guardar Merkle root
        const merkleRoot = await MerkleRoot.create({
            draw_id: drawId,
            root_hash: root,
            tree_data: tree.toJSON(),
            total_winners: winners.length,
            total_prize_amount: winners.reduce((sum, w) => sum + parseFloat(w.prize_amount), 0),
            published_by: publisherAddress,
            expires_at: expiresAt
        });

        // Crear claims pendientes para cada ganador
        for (const winnerProof of proofs) {
            await Claim.create({
                draw_id: drawId,
                user_address: winnerProof.user_address,
                ticket_id: winnerProof.ticket_id,
                category: winnerProof.category,
                prize_amount: winnerProof.prize_amount,
                merkle_proof: winnerProof.proof,
                leaf_hash: winnerProof.leafHash
            });
        }

        // Actualizar estado del sorteo
        await Draw.publishMerkleRoot(drawId, root, expiresAt);

        // Audit log
        await AuditLog.logDrawAction(
            AUDIT_ACTIONS.MERKLE_ROOT_PUBLISHED,
            drawId,
            publisherAddress,
            {
                root,
                winnersCount: winners.length,
                totalPrize: merkleRoot.total_prize_amount,
                expiresAt: expiresAt.toISOString()
            }
        );

        console.log(`Merkle root publicado: ${root}`);
        console.log(`Claims creados: ${winners.length}`);

        return {
            merkleRoot,
            winnersCount: winners.length,
            totalPrize: merkleRoot.total_prize_amount
        };
    }

    /**
     * Obtener datos para hacer un claim
     * @param {number} drawId - ID del sorteo
     * @param {string} userAddress - Dirección del usuario
     */
    static async getClaimData(drawId, userAddress) {
        // Obtener claims pendientes del usuario
        const claims = await Claim.findByDrawAndUser(drawId, userAddress);

        if (!claims || claims.length === 0) {
            return { hasClaims: false, claims: [] };
        }

        // Obtener Merkle root
        const merkleRoot = await MerkleRoot.findByDrawId(drawId);
        if (!merkleRoot) {
            throw new Error('Merkle root no encontrado');
        }

        // Preparar datos de claims
        const claimData = claims.map(claim => ({
            claimId: claim.id,
            ticketId: claim.ticket_id,
            category: claim.category,
            prizeAmount: claim.prize_amount,
            status: claim.status,
            leafHash: claim.leaf_hash,
            proof: proofToBytes32Array(JSON.parse(claim.merkle_proof)),
            merkleRoot: merkleRoot.root_hash
        }));

        return {
            hasClaims: true,
            claims: claimData,
            merkleRoot: merkleRoot.root_hash,
            expiresAt: merkleRoot.expires_at
        };
    }

    /**
     * Procesar un claim (marcar como reclamado)
     * @param {number} claimId - ID del claim
     * @param {string} txHash - Hash de la transacción
     */
    static async processClaim(claimId, txHash) {
        const claim = await Claim.findById(claimId);
        if (!claim) {
            throw new Error('Claim no encontrado');
        }

        if (claim.status !== 'pending') {
            throw new Error(`El claim ya fue procesado. Estado: ${claim.status}`);
        }

        // Verificar que no ha expirado
        const draw = await Draw.findById(claim.draw_id);
        if (draw.claims_deadline && new Date() > new Date(draw.claims_deadline)) {
            await Claim.markExpired(claimId);
            throw new Error('El período de claims ha expirado');
        }

        // Marcar como reclamado
        const updatedClaim = await Claim.markClaimed(claimId, txHash);

        // Audit log
        await AuditLog.create({
            action: AUDIT_ACTIONS.CLAIM_PROCESSED,
            entity_type: 'claim',
            entity_id: claimId,
            actor_address: claim.user_address,
            details: {
                drawId: claim.draw_id,
                ticketId: claim.ticket_id,
                category: claim.category,
                prizeAmount: claim.prize_amount,
                txHash
            }
        });

        return updatedClaim;
    }

    /**
     * Verificar proof off-chain
     */
    static verifyProof(leafHash, proof, root) {
        return MerkleTree.verify(leafHash, proof, root);
    }

    /**
     * Obtener resumen de claims de un usuario
     */
    static async getUserClaimsSummary(userAddress) {
        const summary = await Claim.getUserSummary(userAddress);
        const pendingClaims = await Claim.getPendingByUser(userAddress);

        return {
            ...summary,
            pendingClaims
        };
    }

    /**
     * Obtener claims con información completa
     */
    static async getUserClaimsWithDetails(userAddress, options = {}) {
        const { claims, pagination } = await Claim.findByUser(userAddress, options);

        // Enriquecer con datos de Merkle
        const enrichedClaims = await Promise.all(claims.map(async (claim) => {
            const merkleRoot = await MerkleRoot.findByDrawId(claim.draw_id);
            return {
                ...claim,
                merkle_proof: JSON.parse(claim.merkle_proof),
                merkle_root: merkleRoot?.root_hash,
                expires_at: merkleRoot?.expires_at
            };
        }));

        return { claims: enrichedClaims, pagination };
    }

    /**
     * Expirar claims vencidos
     */
    static async expireOldClaims() {
        const expiredCount = await Claim.expireOldClaims();
        if (expiredCount > 0) {
            console.log(`${expiredCount} claims expirados`);
        }
        return expiredCount;
    }
}

module.exports = ClaimsService;
