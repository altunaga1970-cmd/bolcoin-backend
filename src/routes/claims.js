const express = require('express');
const router = express.Router();
const ClaimsService = require('../services/claimsService');
const { authenticateWallet } = require('../middleware/web3Auth');
const { requireAdminSession, requirePermission } = require('../middleware/siweAuth');

// =================================
// RUTAS DE CLAIMS
// =================================

/**
 * GET /api/claims/summary
 * Obtener resumen de claims del usuario
 */
router.get('/summary', authenticateWallet, async (req, res) => {
    try {
        const summary = await ClaimsService.getUserClaimsSummary(req.user.address);

        res.json({
            success: true,
            data: summary
        });
    } catch (error) {
        console.error('Error obteniendo resumen de claims:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

/**
 * GET /api/claims
 * Obtener claims del usuario con paginación
 */
router.get('/', authenticateWallet, async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;

        const result = await ClaimsService.getUserClaimsWithDetails(
            req.user.address,
            { page: parseInt(page), limit: parseInt(limit) }
        );

        res.json({
            success: true,
            data: result.claims,
            pagination: result.pagination
        });
    } catch (error) {
        console.error('Error obteniendo claims:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

/**
 * GET /api/claims/draw/:drawId
 * Obtener datos de claim para un sorteo específico
 */
router.get('/draw/:drawId', authenticateWallet, async (req, res) => {
    try {
        const { drawId } = req.params;
        const claimData = await ClaimsService.getClaimData(
            parseInt(drawId),
            req.user.address
        );

        res.json({
            success: true,
            data: claimData
        });
    } catch (error) {
        console.error('Error obteniendo datos de claim:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

/**
 * POST /api/claims/:claimId/process
 * Procesar un claim (marcar como reclamado después de tx on-chain)
 */
router.post('/:claimId/process', authenticateWallet, async (req, res) => {
    try {
        const { claimId } = req.params;
        const { txHash } = req.body;

        if (!txHash) {
            return res.status(400).json({
                success: false,
                message: 'txHash requerido'
            });
        }

        const claim = await ClaimsService.processClaim(parseInt(claimId), txHash);

        res.json({
            success: true,
            data: claim,
            message: 'Claim procesado correctamente'
        });
    } catch (error) {
        console.error('Error procesando claim:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

/**
 * POST /api/claims/verify-proof
 * Verificar un proof off-chain
 */
router.post('/verify-proof', async (req, res) => {
    try {
        const { leafHash, proof, root } = req.body;

        if (!leafHash || !proof || !root) {
            return res.status(400).json({
                success: false,
                message: 'leafHash, proof y root son requeridos'
            });
        }

        const isValid = ClaimsService.verifyProof(leafHash, proof, root);

        res.json({
            success: true,
            data: { isValid }
        });
    } catch (error) {
        console.error('Error verificando proof:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// =================================
// RUTAS ADMIN
// =================================

/**
 * POST /api/claims/admin/publish/:drawId
 * Publicar Merkle root para un sorteo (solo admin)
 */
router.post('/admin/publish/:drawId', requireAdminSession, requirePermission('draws:results'), async (req, res) => {
    try {
        const { drawId } = req.params;

        const result = await ClaimsService.publishMerkleRoot(
            parseInt(drawId),
            req.admin.address
        );

        res.json({
            success: true,
            data: result,
            message: 'Merkle root publicado correctamente'
        });
    } catch (error) {
        console.error('Error publicando Merkle root:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

/**
 * GET /api/claims/admin/draw/:drawId
 * Obtener todos los claims de un sorteo (admin)
 */
router.get('/admin/draw/:drawId', requireAdminSession, requirePermission('draws:read'), async (req, res) => {
    try {
        const { drawId } = req.params;
        const { status } = req.query;
        const Claim = require('../models/Claim');

        const claims = await Claim.findByDraw(parseInt(drawId), { status });

        res.json({
            success: true,
            data: claims
        });
    } catch (error) {
        console.error('Error obteniendo claims:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

/**
 * POST /api/claims/admin/expire
 * Expirar claims vencidos (admin/cron)
 */
router.post('/admin/expire', requireAdminSession, requirePermission('draws:manage'), async (req, res) => {
    try {
        const expiredCount = await ClaimsService.expireOldClaims();

        res.json({
            success: true,
            data: { expiredCount },
            message: `${expiredCount} claims expirados`
        });
    } catch (error) {
        console.error('Error expirando claims:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router;
