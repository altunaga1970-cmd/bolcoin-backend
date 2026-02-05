const { getClient, query } = require('../config/database');
const Draw = require('../models/Draw');
const { DRAW_STATUS, LOTTERY_RULES, LOTTERY_PRIZES } = require('../config/constants');

// =================================
// LOTTERY SERVICE - La Fortuna
// =================================

/**
 * Get or create the next lottery draw
 * Auto-creates Wed/Sat draws if none exist
 */
async function getNextLotteryDraw() {
    const now = new Date();

    // First, look for an existing open/scheduled lottery draw
    // Check draws that are still accepting bets (15 min before scheduled time)
    const result = await query(`
        SELECT * FROM draws
        WHERE draw_type = 'lottery'
        AND status IN ($1, $2)
        AND scheduled_time > NOW() - INTERVAL '15 minutes'
        ORDER BY scheduled_time ASC
        LIMIT 1
    `, [DRAW_STATUS.SCHEDULED, DRAW_STATUS.OPEN]);

    if (result.rows.length > 0) {
        const draw = result.rows[0];
        const drawTime = new Date(draw.scheduled_time);
        const minutesUntilDraw = (drawTime - now) / (60 * 1000);

        // If draw is still open for bets (more than 15 min away or just passed)
        if (minutesUntilDraw > -60) { // Allow up to 60 min past for viewing
            return draw;
        }
    }

    // No suitable draw found - calculate and create the next one
    const nextDrawTime = calculateNextLotteryDrawTime();
    const drawNumber = generateLotteryDrawNumber(nextDrawTime);

    try {
        const newDraw = await Draw.createLottery({
            draw_number: drawNumber,
            scheduled_time: nextDrawTime,
            status: DRAW_STATUS.OPEN
        });
        console.log(`[LotteryService] Created new lottery draw: ${drawNumber}`);
        return newDraw;
    } catch (error) {
        // If draw already exists (race condition), fetch it
        if (error.message.includes('ya existe') || error.code === '23505') {
            const existing = await Draw.findByDrawNumber(drawNumber);
            return existing;
        }
        throw error;
    }
}

/**
 * Calculate next lottery draw time (Wed or Sat at 21:00 UTC)
 * Considers betting closes 15 min before draw
 */
function calculateNextLotteryDrawTime() {
    const now = new Date();
    const nextDraw = new Date(now);
    nextDraw.setUTCHours(21, 0, 0, 0);

    const day = now.getUTCDay(); // 0=Sun, 3=Wed, 6=Sat
    const hour = now.getUTCHours();
    const minutes = now.getUTCMinutes();

    // Consider betting closed if within 15 min of draw or past draw time
    const bettingClosed = hour > 21 || (hour === 21 && minutes >= 0) || (hour === 20 && minutes >= 45);

    // Find next Wed (3) or Sat (6) that's still open for betting
    if (day === 3 && !bettingClosed) {
        // It's Wednesday and betting is still open - use today
    } else if (day === 6 && !bettingClosed) {
        // It's Saturday and betting is still open - use today
    } else if (day === 3 && bettingClosed) {
        // Wednesday after betting closed - go to Saturday
        nextDraw.setUTCDate(now.getUTCDate() + 3);
    } else if (day === 6 && bettingClosed) {
        // Saturday after betting closed - go to next Wednesday
        nextDraw.setUTCDate(now.getUTCDate() + 4);
    } else if (day === 0) {
        // Sunday - go to Wednesday
        nextDraw.setUTCDate(now.getUTCDate() + 3);
    } else if (day === 1) {
        // Monday - go to Wednesday
        nextDraw.setUTCDate(now.getUTCDate() + 2);
    } else if (day === 2) {
        // Tuesday - go to Wednesday
        nextDraw.setUTCDate(now.getUTCDate() + 1);
    } else if (day === 4) {
        // Thursday - go to Saturday
        nextDraw.setUTCDate(now.getUTCDate() + 2);
    } else if (day === 5) {
        // Friday - go to Saturday
        nextDraw.setUTCDate(now.getUTCDate() + 1);
    }

    return nextDraw;
}

/**
 * Generate lottery draw number
 * Format: YYYYMMDD-2100-LF (La Fortuna at 21:00 UTC)
 */
function generateLotteryDrawNumber(date) {
    const d = new Date(date);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${year}${month}${day}-2100-LF`;
}

/**
 * Validate lottery ticket numbers
 */
function validateTicketNumbers(numbers, keyNumber) {
    // Check array length
    if (!Array.isArray(numbers) || numbers.length !== 6) {
        throw new Error('Debe seleccionar exactamente 6 numeros');
    }

    // Check each number is in valid range (1-49)
    for (const num of numbers) {
        if (typeof num !== 'number' || num < 1 || num > 49 || !Number.isInteger(num)) {
            throw new Error('Los numeros deben ser enteros del 1 al 49');
        }
    }

    // Check for duplicates
    const uniqueNums = new Set(numbers);
    if (uniqueNums.size !== 6) {
        throw new Error('Los numeros deben ser unicos');
    }

    // Check key number (0-9)
    if (typeof keyNumber !== 'number' || keyNumber < 0 || keyNumber > 9 || !Number.isInteger(keyNumber)) {
        throw new Error('El numero clave debe ser un entero del 0 al 9');
    }

    return true;
}

/**
 * Purchase lottery tickets
 * @param {number} userId - User ID
 * @param {Array} tickets - Array of { numbers: [6 nums], keyNumber: 0-9 }
 */
async function purchaseTickets(userId, tickets) {
    if (!tickets || !Array.isArray(tickets) || tickets.length === 0) {
        throw new Error('Debe proporcionar al menos un ticket');
    }

    if (tickets.length > LOTTERY_RULES.maxTicketsPerTx) {
        throw new Error(`Maximo ${LOTTERY_RULES.maxTicketsPerTx} tickets por transaccion`);
    }

    const client = await getClient();

    try {
        await client.query('BEGIN');

        // 1. Get user and lock for update
        const userResult = await client.query(
            'SELECT id, balance, wallet_address, version FROM users WHERE id = $1 FOR UPDATE',
            [userId]
        );

        if (userResult.rows.length === 0) {
            throw new Error('Usuario no encontrado');
        }

        const user = userResult.rows[0];
        const currentBalance = parseFloat(user.balance);

        // 2. Calculate total cost
        const ticketPrice = LOTTERY_RULES.ticketPrice || 1;
        const totalCost = tickets.length * ticketPrice;

        if (currentBalance < totalCost) {
            throw new Error(`Balance insuficiente. Tienes ${currentBalance} USDT, necesitas ${totalCost} USDT`);
        }

        // 3. Get or create the next lottery draw
        const draw = await getNextLotteryDraw();

        if (!draw) {
            throw new Error('No hay sorteo de loteria disponible');
        }

        // Check draw is open for tickets
        const drawTime = new Date(draw.scheduled_time);
        const now = new Date();
        const minutesBefore = 15; // Close 15 min before draw

        if (drawTime - now < minutesBefore * 60 * 1000) {
            throw new Error('El sorteo esta cerrado para nuevos tickets');
        }

        // 4. Validate all tickets
        for (const ticket of tickets) {
            validateTicketNumbers(ticket.numbers, ticket.keyNumber);
        }

        // 5. Deduct balance
        const newBalance = currentBalance - totalCost;
        await client.query(
            'UPDATE users SET balance = $1, version = version + 1 WHERE id = $2 AND version = $3',
            [newBalance, userId, user.version]
        );

        // 6. Create ticket records
        const createdTickets = [];

        for (const ticket of tickets) {
            const ticketId = `TKT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            const ticketResult = await client.query(`
                INSERT INTO lottery_tickets (
                    ticket_id, draw_id, user_address, numbers, key_number, price, status
                ) VALUES ($1, $2, $3, $4, $5, $6, 'active')
                RETURNING *
            `, [
                ticketId,
                draw.id,
                user.wallet_address,
                JSON.stringify(ticket.numbers.sort((a, b) => a - b)),
                ticket.keyNumber,
                ticketPrice
            ]);

            createdTickets.push(ticketResult.rows[0]);
        }

        // 7. Update draw totals
        await client.query(`
            UPDATE draws
            SET total_bets_amount = total_bets_amount + $1,
                total_tickets = COALESCE(total_tickets, 0) + $2,
                bets_count = COALESCE(bets_count, 0) + $2,
                updated_at = NOW()
            WHERE id = $3
        `, [totalCost, tickets.length, draw.id]);

        await client.query('COMMIT');

        return {
            success: true,
            tickets: createdTickets,
            draw: {
                id: draw.id,
                drawNumber: draw.draw_number,
                scheduledTime: draw.scheduled_time
            },
            totalCost,
            newBalance
        };

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Get user's lottery tickets
 */
async function getUserTickets(userAddress, filters = {}) {
    let queryText = `
        SELECT
            t.*,
            d.draw_number,
            d.scheduled_time,
            d.status as draw_status,
            d.lottery_numbers as winning_numbers,
            d.lottery_key as winning_key
        FROM lottery_tickets t
        JOIN draws d ON t.draw_id = d.id
        WHERE t.user_address = $1
    `;
    const params = [userAddress];
    let paramIndex = 2;

    if (filters.drawId) {
        queryText += ` AND t.draw_id = $${paramIndex}`;
        params.push(filters.drawId);
        paramIndex++;
    }

    if (filters.status) {
        queryText += ` AND t.status = $${paramIndex}`;
        params.push(filters.status);
        paramIndex++;
    }

    queryText += ` ORDER BY t.purchased_at DESC`;

    if (filters.limit) {
        queryText += ` LIMIT $${paramIndex}`;
        params.push(filters.limit);
        paramIndex++;
    }

    if (filters.page && filters.limit) {
        const offset = (filters.page - 1) * filters.limit;
        queryText += ` OFFSET $${paramIndex}`;
        params.push(offset);
    }

    const result = await query(queryText, params);
    return result.rows;
}

/**
 * Get current jackpot amount
 */
async function getJackpotAmount() {
    try {
        const result = await query(
            'SELECT jackpot_amount FROM jackpot_status ORDER BY updated_at DESC LIMIT 1'
        );

        if (result.rows.length > 0) {
            return parseFloat(result.rows[0].jackpot_amount);
        }

        return 0; // Jackpot starts at 0
    } catch (error) {
        console.error('[LotteryService] Error getting jackpot:', error);
        return 0;
    }
}

/**
 * Get recent completed lottery draws (last 4)
 */
async function getRecentDrawResults(limit = 4) {
    try {
        // First check if lottery_numbers column exists
        const columnCheck = await query(`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'draws' AND column_name = 'lottery_numbers'
        `);

        if (columnCheck.rows.length === 0) {
            // Column doesn't exist yet, return empty array
            console.log('[LotteryService] lottery_numbers column not found, skipping recent draws');
            return [];
        }

        const result = await query(`
            SELECT
                id,
                draw_number,
                scheduled_time,
                status,
                lottery_numbers,
                lottery_key,
                total_bets_amount as total_pool
            FROM draws
            WHERE draw_type = 'lottery'
            AND status = 'completed'
            AND lottery_numbers IS NOT NULL
            ORDER BY scheduled_time DESC
            LIMIT $1
        `, [limit]);

        return result.rows.map(draw => ({
            id: draw.id,
            drawNumber: draw.draw_number,
            drawDate: draw.scheduled_time,
            winningNumbers: Array.isArray(draw.lottery_numbers)
                ? draw.lottery_numbers
                : (typeof draw.lottery_numbers === 'string'
                    ? JSON.parse(draw.lottery_numbers)
                    : []),
            keyNumber: draw.lottery_key,
            totalPool: parseFloat(draw.total_pool) || 0
        }));
    } catch (error) {
        console.error('[LotteryService] Error getting recent draws:', error.message);
        return [];
    }
}

/**
 * Get lottery info for frontend
 */
async function getLotteryInfo() {
    const [nextDraw, jackpot, recentDraws] = await Promise.all([
        getNextLotteryDraw(),
        getJackpotAmount(),
        getRecentDrawResults(4)
    ]);

    return {
        nextDraw: nextDraw ? {
            id: nextDraw.id,
            drawNumber: nextDraw.draw_number,
            scheduledTime: nextDraw.scheduled_time,
            status: nextDraw.status
        } : null,
        jackpot,
        ticketPrice: LOTTERY_RULES.ticketPrice || 1,
        maxTicketsPerTx: LOTTERY_RULES.maxTicketsPerTx || 8,
        prizeDistribution: {
            jackpot: '20%',
            category2: '40%',
            category3: '5%',
            category4: '3%',
            category5: '6%'
        },
        recentDraws
    };
}

module.exports = {
    getNextLotteryDraw,
    calculateNextLotteryDrawTime,
    generateLotteryDrawNumber,
    validateTicketNumbers,
    purchaseTickets,
    getUserTickets,
    getJackpotAmount,
    getLotteryInfo,
    getRecentDrawResults
};
