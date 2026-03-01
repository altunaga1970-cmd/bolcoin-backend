const { query, getClient } = require('../config/database');

// =================================
// REFERRAL ADMIN SERVICE
// Gestion administrativa de referidos
// =================================

const COMMISSION_RATE = 0.03; // 3% de comision

/**
 * Obtener estadisticas generales de referidos
 */
async function getReferralStats() {
    const result = await query(`
        SELECT
            COUNT(DISTINCT referrer_wallet) as total_referrers,
            COUNT(*) FILTER (WHERE referred_wallet IS NOT NULL) as total_referrals,
            COUNT(*) FILTER (WHERE status = 'active') as active_referrals,
            COALESCE(SUM(total_bets_amount), 0) as total_bets_from_referrals,
            COALESCE(SUM(total_commissions_generated), 0) as total_commissions_generated
        FROM referrals
    `);

    const commissions = await query(`
        SELECT
            COUNT(*) as total_commissions,
            COUNT(*) FILTER (WHERE status = 'pending') as pending_commissions,
            COUNT(*) FILTER (WHERE status = 'paid') as paid_commissions,
            COALESCE(SUM(commission_amount) FILTER (WHERE status = 'pending'), 0) as pending_amount,
            COALESCE(SUM(commission_amount) FILTER (WHERE status = 'paid'), 0) as paid_amount
        FROM referral_commissions
    `);

    return {
        referrers: parseInt(result.rows[0].total_referrers) || 0,
        totalReferrals: parseInt(result.rows[0].total_referrals) || 0,
        activeReferrals: parseInt(result.rows[0].active_referrals) || 0,
        totalBetsFromReferrals: parseFloat(result.rows[0].total_bets_from_referrals) || 0,
        totalCommissionsGenerated: parseFloat(result.rows[0].total_commissions_generated) || 0,
        commissions: {
            total: parseInt(commissions.rows[0].total_commissions) || 0,
            pending: parseInt(commissions.rows[0].pending_commissions) || 0,
            paid: parseInt(commissions.rows[0].paid_commissions) || 0,
            pendingAmount: parseFloat(commissions.rows[0].pending_amount) || 0,
            paidAmount: parseFloat(commissions.rows[0].paid_amount) || 0
        }
    };
}

/**
 * Listar todos los referidos con paginacion
 */
async function listReferrals({ page = 1, limit = 50, status = null, search = null }) {
    const offset = (page - 1) * limit;
    let whereClause = 'WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (status) {
        whereClause += ` AND r.status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
    }

    if (search) {
        whereClause += ` AND (r.referrer_wallet ILIKE $${paramIndex} OR r.referral_code ILIKE $${paramIndex} OR r.referred_wallet ILIKE $${paramIndex})`;
        params.push(`%${search}%`);
        paramIndex++;
    }

    // Contar total
    const countResult = await query(`
        SELECT COUNT(*) FROM referrals r ${whereClause}
    `, params);

    // Obtener referidos
    const result = await query(`
        SELECT
            r.id,
            r.referrer_wallet,
            r.referral_code,
            r.referred_wallet,
            r.registration_method,
            r.total_bets_amount,
            r.total_commissions_generated,
            r.status,
            r.registered_at,
            (
                SELECT COUNT(*)
                FROM referral_commissions rc
                WHERE rc.referrer_wallet = r.referrer_wallet
            ) as commission_count
        FROM referrals r
        ${whereClause}
        ORDER BY r.registered_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, [...params, limit, offset]);

    return {
        referrals: result.rows,
        pagination: {
            page,
            limit,
            total: parseInt(countResult.rows[0].count),
            totalPages: Math.ceil(countResult.rows[0].count / limit)
        }
    };
}

/**
 * Listar comisiones con filtros
 */
async function listCommissions({ page = 1, limit = 50, status = null, referrerWallet = null, dateFrom = null, dateTo = null }) {
    const offset = (page - 1) * limit;
    let whereClause = 'WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (status) {
        whereClause += ` AND rc.status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
    }

    if (referrerWallet) {
        whereClause += ` AND rc.referrer_wallet = $${paramIndex}`;
        params.push(referrerWallet.toLowerCase());
        paramIndex++;
    }

    if (dateFrom) {
        whereClause += ` AND rc.created_at >= $${paramIndex}`;
        params.push(dateFrom);
        paramIndex++;
    }

    if (dateTo) {
        whereClause += ` AND rc.created_at <= $${paramIndex}`;
        params.push(dateTo);
        paramIndex++;
    }

    // Contar total
    const countResult = await query(`
        SELECT COUNT(*) FROM referral_commissions rc ${whereClause}
    `, params);

    // Obtener comisiones
    const result = await query(`
        SELECT
            rc.id,
            rc.referral_id,
            rc.referrer_wallet,
            rc.referred_wallet,
            rc.bet_id,
            rc.bet_amount,
            rc.commission_rate,
            rc.commission_amount,
            rc.status,
            rc.paid_at,
            rc.created_at
        FROM referral_commissions rc
        ${whereClause}
        ORDER BY rc.created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, [...params, limit, offset]);

    return {
        commissions: result.rows,
        pagination: {
            page,
            limit,
            total: parseInt(countResult.rows[0].count),
            totalPages: Math.ceil(countResult.rows[0].count / limit)
        }
    };
}

/**
 * Obtener totales de referidos para auditoria
 */
async function getReferralTotals() {
    // Totales por periodo
    const today = await query(`
        SELECT
            COUNT(*) as new_referrals,
            COALESCE(SUM(commission_amount), 0) as commissions
        FROM referral_commissions
        WHERE DATE(created_at) = CURRENT_DATE
    `);

    const thisMonth = await query(`
        SELECT
            COUNT(*) as new_referrals,
            COALESCE(SUM(commission_amount), 0) as commissions
        FROM referral_commissions
        WHERE EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE)
        AND EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM CURRENT_DATE)
    `);

    const thisYear = await query(`
        SELECT
            COUNT(*) as new_referrals,
            COALESCE(SUM(commission_amount), 0) as commissions
        FROM referral_commissions
        WHERE EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE)
    `);

    // Top referidores
    const topReferrers = await query(`
        SELECT
            referrer_wallet,
            COUNT(*) as total_referrals,
            COALESCE(SUM(total_commissions_generated), 0) as total_commissions
        FROM referrals
        WHERE referred_wallet IS NOT NULL
        GROUP BY referrer_wallet
        ORDER BY total_commissions DESC
        LIMIT 10
    `);

    // Comisiones pendientes de pago
    const pendingPayments = await query(`
        SELECT
            referrer_wallet,
            COUNT(*) as pending_count,
            COALESCE(SUM(commission_amount), 0) as pending_amount
        FROM referral_commissions
        WHERE status = 'pending'
        GROUP BY referrer_wallet
        ORDER BY pending_amount DESC
    `);

    return {
        today: {
            newReferrals: parseInt(today.rows[0].new_referrals) || 0,
            commissions: parseFloat(today.rows[0].commissions) || 0
        },
        thisMonth: {
            newReferrals: parseInt(thisMonth.rows[0].new_referrals) || 0,
            commissions: parseFloat(thisMonth.rows[0].commissions) || 0
        },
        thisYear: {
            newReferrals: parseInt(thisYear.rows[0].new_referrals) || 0,
            commissions: parseFloat(thisYear.rows[0].commissions) || 0
        },
        topReferrers: topReferrers.rows,
        pendingPayments: pendingPayments.rows
    };
}

/**
 * Marcar comisiones como pagadas
 */
async function markCommissionsAsPaid(commissionIds, adminId) {
    const client = await getClient();

    try {
        await client.query('BEGIN');

        const result = await client.query(`
            UPDATE referral_commissions
            SET status = 'paid', paid_at = NOW()
            WHERE id = ANY($1) AND status = 'pending'
            RETURNING *
        `, [commissionIds]);

        await client.query('COMMIT');

        return {
            updated: result.rowCount,
            commissions: result.rows
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Generar codigo de referido unico
 */
function generateReferralCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

/**
 * Crear nuevo codigo de referido para una wallet
 */
async function createReferralCode(walletAddress) {
    const normalizedWallet = walletAddress.toLowerCase();

    // Verificar si ya tiene un codigo
    const existing = await query(`
        SELECT referral_code FROM referrals
        WHERE referrer_wallet = $1 AND referred_wallet IS NULL
        LIMIT 1
    `, [normalizedWallet]);

    if (existing.rows.length > 0) {
        return existing.rows[0].referral_code;
    }

    // Generar nuevo codigo unico
    let code;
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
        code = generateReferralCode();
        try {
            await query(`
                INSERT INTO referrals (referrer_wallet, referral_code)
                VALUES ($1, $2)
            `, [normalizedWallet, code]);
            return code;
        } catch (error) {
            if (error.code === '23505') { // Unique violation
                attempts++;
                continue;
            }
            throw error;
        }
    }

    throw new Error('No se pudo generar codigo de referido unico');
}

/**
 * Registrar un referido por codigo
 */
async function registerReferral(referralCode, referredWallet) {
    const normalizedWallet = referredWallet.toLowerCase();

    // Verificar que el codigo existe y no esta usado
    const referral = await query(`
        SELECT * FROM referrals
        WHERE referral_code = $1 AND referred_wallet IS NULL
    `, [referralCode.toUpperCase()]);

    if (referral.rows.length === 0) {
        throw new Error('Codigo de referido invalido o ya utilizado');
    }

    // No permitir auto-referido
    if (referral.rows[0].referrer_wallet === normalizedWallet) {
        throw new Error('No puedes usar tu propio codigo de referido');
    }

    // Registrar el referido
    const result = await query(`
        UPDATE referrals
        SET referred_wallet = $1, registration_method = 'code', updated_at = NOW()
        WHERE referral_code = $2 AND referred_wallet IS NULL
        RETURNING *
    `, [normalizedWallet, referralCode.toUpperCase()]);

    return result.rows[0];
}

/**
 * Calcular y registrar comision por una apuesta
 */
async function calculateBetCommission(betId, userId, betAmount) {
    const client = await getClient();

    try {
        // Obtener wallet del usuario
        const userResult = await client.query(
            'SELECT wallet_address FROM users WHERE id = $1',
            [userId]
        );

        if (!userResult.rows[0]?.wallet_address) {
            return null;
        }

        const userWallet = userResult.rows[0].wallet_address.toLowerCase();

        // Buscar si este usuario fue referido
        const referralResult = await client.query(`
            SELECT id, referrer_wallet
            FROM referrals
            WHERE referred_wallet = $1 AND status = 'active'
        `, [userWallet]);

        if (referralResult.rows.length === 0) {
            return null;
        }

        const referral = referralResult.rows[0];
        const commissionAmount = betAmount * COMMISSION_RATE;

        await client.query('BEGIN');

        // Crear registro de comision
        const commissionResult = await client.query(`
            INSERT INTO referral_commissions
            (referral_id, referrer_wallet, referred_wallet, bet_id, bet_amount, commission_rate, commission_amount)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `, [referral.id, referral.referrer_wallet, userWallet, betId, betAmount, COMMISSION_RATE, commissionAmount]);

        // Actualizar totales en referrals
        await client.query(`
            UPDATE referrals
            SET
                total_bets_amount = total_bets_amount + $1,
                total_commissions_generated = total_commissions_generated + $2,
                updated_at = NOW()
            WHERE id = $3
        `, [betAmount, commissionAmount, referral.id]);

        await client.query('COMMIT');

        return commissionResult.rows[0];
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error calculando comision de referido:', error);
        return null;
    } finally {
        client.release();
    }
}

/**
 * Calcular y registrar comision por apuesta (variante por wallet, para Keno y Bingo)
 */
async function calculateBetCommissionByWallet(betId, walletAddress, betAmount) {
    const userWallet = walletAddress.toLowerCase();
    const client = await getClient();

    try {
        const referralResult = await client.query(`
            SELECT id, referrer_wallet
            FROM referrals
            WHERE referred_wallet = $1 AND status = 'active'
        `, [userWallet]);

        if (referralResult.rows.length === 0) {
            return null;
        }

        const referral = referralResult.rows[0];
        const commissionAmount = betAmount * COMMISSION_RATE;

        await client.query('BEGIN');

        const commissionResult = await client.query(`
            INSERT INTO referral_commissions
            (referral_id, referrer_wallet, referred_wallet, bet_id, bet_amount, commission_rate, commission_amount)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `, [referral.id, referral.referrer_wallet, userWallet, String(betId), betAmount, COMMISSION_RATE, commissionAmount]);

        await client.query(`
            UPDATE referrals
            SET
                total_bets_amount = total_bets_amount + $1,
                total_commissions_generated = total_commissions_generated + $2,
                updated_at = NOW()
            WHERE id = $3
        `, [betAmount, commissionAmount, referral.id]);

        await client.query('COMMIT');

        return commissionResult.rows[0];
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error calculando comision de referido (wallet):', error);
        return null;
    } finally {
        client.release();
    }
}

/**
 * Cambiar estado de un referido
 */
async function updateReferralStatus(referralId, newStatus) {
    const validStatuses = ['active', 'inactive', 'banned'];
    if (!validStatuses.includes(newStatus)) {
        throw new Error('Estado invalido');
    }

    const result = await query(`
        UPDATE referrals
        SET status = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING *
    `, [newStatus, referralId]);

    if (result.rows.length === 0) {
        throw new Error('Referido no encontrado');
    }

    return result.rows[0];
}

module.exports = {
    getReferralStats,
    listReferrals,
    listCommissions,
    getReferralTotals,
    markCommissionsAsPaid,
    generateReferralCode,
    createReferralCode,
    registerReferral,
    calculateBetCommission,
    calculateBetCommissionByWallet,
    updateReferralStatus,
    COMMISSION_RATE
};
