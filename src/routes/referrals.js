const express = require('express');
const router = express.Router();
const { authenticateWallet } = require('../middleware/web3Auth');
const referralAdminService = require('../services/referralAdminService');
const { query } = require('../config/database');

const COMMISSION_RATE = referralAdminService.COMMISSION_RATE; // 0.03

// Todas las rutas requieren autenticacion de wallet
router.use(authenticateWallet);

/**
 * GET /api/referrals/my-info
 * Retorna: codigo propio, referidor, estadisticas, lista de referidos, config
 */
router.get('/my-info', async (req, res) => {
    try {
        const wallet = req.user.address.toLowerCase();

        // Obtener o crear codigo de referido para esta wallet
        const code = await referralAdminService.createReferralCode(wallet);

        // Personas que este usuario ha referido
        const referralsResult = await query(`
            SELECT referred_wallet, registered_at, total_bets_amount, total_commissions_generated
            FROM referrals
            WHERE referrer_wallet = $1 AND referred_wallet IS NOT NULL AND status = 'active'
            ORDER BY registered_at DESC
        `, [wallet]);

        // Estadisticas de comisiones ganadas
        const statsResult = await query(`
            SELECT
                COALESCE(SUM(commission_amount), 0) as total_earnings,
                COALESCE(SUM(commission_amount) FILTER (WHERE status = 'pending'), 0) as pending_earnings
            FROM referral_commissions
            WHERE referrer_wallet = $1
        `, [wallet]);

        // Verificar si este usuario fue referido por alguien
        const referredByResult = await query(`
            SELECT referrer_wallet FROM referrals
            WHERE referred_wallet = $1 AND status = 'active'
            LIMIT 1
        `, [wallet]);

        const stats = statsResult.rows[0];

        res.json({
            success: true,
            data: {
                code,
                referredBy: referredByResult.rows[0]?.referrer_wallet || null,
                totalReferred: referralsResult.rows.length,
                totalEarnings: parseFloat(stats.total_earnings).toFixed(2),
                pendingEarnings: parseFloat(stats.pending_earnings).toFixed(2),
                referredList: referralsResult.rows.map(r => r.referred_wallet),
                config: {
                    bonusPercent: COMMISSION_RATE * 100,
                    welcomeEnabled: false,
                    welcomeBonus: 0,
                    systemEnabled: true
                }
            }
        });
    } catch (error) {
        console.error('Error getting referral info:', error);
        res.status(500).json({ success: false, message: 'Error al obtener informacion de referidos' });
    }
});

/**
 * POST /api/referrals/register
 * Body: { code: "ABCDEF" }
 * Registra al usuario actual como referido del codigo dado
 */
router.post('/register', async (req, res) => {
    try {
        const wallet = req.user.address.toLowerCase();
        const { code } = req.body;

        if (!code || typeof code !== 'string' || code.trim().length !== 6) {
            return res.status(400).json({ success: false, message: 'Codigo de 6 caracteres requerido' });
        }

        // Verificar que no tiene referidor ya
        const alreadyReferred = await query(`
            SELECT id FROM referrals WHERE referred_wallet = $1 LIMIT 1
        `, [wallet]);

        if (alreadyReferred.rows.length > 0) {
            return res.status(400).json({ success: false, message: 'Ya tienes un referidor registrado' });
        }

        const referral = await referralAdminService.registerReferral(code.trim().toUpperCase(), wallet);

        res.json({
            success: true,
            data: referral,
            message: 'Referido registrado correctamente'
        });
    } catch (error) {
        console.error('Error registering referral:', error);
        res.status(400).json({ success: false, message: error.message || 'Error al registrar referido' });
    }
});

module.exports = router;
