const Draw = require('../models/Draw');
const AuditLog = require('../models/AuditLog');
const { SCHEDULER_CONFIG, AUDIT_ACTIONS, DRAW_STATUS } = require('../config/constants');

// =================================
// DRAW SCHEDULER
// Crea y abre sorteos automáticamente
// =================================

class DrawScheduler {
    /**
     * Crear sorteos próximos automáticamente
     */
    async createUpcomingDraws() {
        try {
            const now = new Date();
            const hoursAhead = SCHEDULER_CONFIG.AUTO_CREATE_AHEAD_HOURS;

            // Crear sorteos de La Bolita para las próximas horas
            await this.createBolitaDraws(now, hoursAhead);

            // Crear sorteos de La Fortuna para los próximos días
            await this.createLotteryDraws(now);

        } catch (error) {
            console.error('Error creando sorteos:', error);
            throw error;
        }
    }

    /**
     * Crear sorteos de La Bolita
     *
     * Design: scheduled_time = when betting CLOSES and results are drawn.
     * Draws are created as 'open' immediately so users can bet right away.
     * The drawCloser will close them CLOSE_BEFORE_DRAW_MINUTES before scheduled_time.
     *
     * Always ensures the next 3 upcoming draws exist and are open for betting.
     */
    async createBolitaDraws(now, hoursAhead) {
        // On-chain mode: bolitaDrawScheduler handles draw creation/lifecycle
        if (process.env.BOLITA_CONTRACT_ADDRESS) return;
        const drawTimes = SCHEDULER_CONFIG.BOLITA_DRAW_TIMES;
        const closeBefore = SCHEDULER_CONFIG.CLOSE_BEFORE_DRAW_MINUTES;

        // Build a sorted list of all candidate draw times for today and tomorrow
        const candidates = [];
        for (const timeStr of drawTimes) {
            const [hours, minutes] = timeStr.split(':').map(Number);

            // Today
            const todayDraw = new Date(now);
            todayDraw.setUTCHours(hours, minutes, 0, 0);
            candidates.push(new Date(todayDraw));

            // Tomorrow
            const tomorrowDraw = new Date(todayDraw);
            tomorrowDraw.setUTCDate(tomorrowDraw.getUTCDate() + 1);
            candidates.push(new Date(tomorrowDraw));

            // Day after tomorrow (safety net)
            const dayAfter = new Date(tomorrowDraw);
            dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
            candidates.push(new Date(dayAfter));
        }

        // Sort chronologically
        candidates.sort((a, b) => a.getTime() - b.getTime());

        // Filter: only keep draws whose close window hasn't passed yet
        // A draw is still relevant if: scheduled_time - closeBefore > now
        const closeBufferMs = closeBefore * 60 * 1000;
        const upcoming = candidates.filter(d => d.getTime() - closeBufferMs > now.getTime());

        // Create the next 3 upcoming draws as 'open' immediately
        const drawsToCreate = upcoming.slice(0, 3);

        for (const drawTime of drawsToCreate) {
            await this.createDrawIfNotExists(drawTime, 'bolita');
        }
    }

    /**
     * Crear sorteos de La Fortuna (lottery)
     */
    async createLotteryDraws(now) {
        const drawDays = SCHEDULER_CONFIG.LOTTERY_DRAW_DAYS; // [3, 6] = miércoles, sábado
        const [hours, minutes] = SCHEDULER_CONFIG.LOTTERY_DRAW_TIME.split(':').map(Number);

        // Buscar próximos 2 días de sorteo
        for (let daysAhead = 0; daysAhead <= 7; daysAhead++) {
            const checkDate = new Date(now);
            checkDate.setUTCDate(checkDate.getUTCDate() + daysAhead);
            checkDate.setUTCHours(hours, minutes, 0, 0);

            if (drawDays.includes(checkDate.getUTCDay()) && checkDate > now) {
                await this.createDrawIfNotExists(checkDate, 'lottery');
            }
        }
    }

    /**
     * Crear sorteo si no existe
     */
    async createDrawIfNotExists(scheduledTime, drawType) {
        try {
            // Generar número de sorteo único
            const drawNumber = this.generateDrawNumber(scheduledTime, drawType);

            // Verificar si ya existe
            const existing = await Draw.findByDrawNumber(drawNumber);
            if (existing) {
                return null;
            }

            // Crear sorteo
            // La Bolita draws are created as 'open' immediately so users can bet.
            // Lottery draws stay 'scheduled' until their time.
            let draw;
            if (drawType === 'lottery') {
                draw = await Draw.createLottery({
                    draw_number: drawNumber,
                    scheduled_time: scheduledTime,
                    status: DRAW_STATUS.SCHEDULED
                });
            } else {
                draw = await Draw.create({
                    draw_number: drawNumber,
                    scheduled_time: scheduledTime,
                    status: DRAW_STATUS.OPEN
                });
            }

            console.log(`Sorteo creado: ${drawNumber} (${drawType}) para ${scheduledTime.toISOString()}`);

            await AuditLog.logDrawAction(
                AUDIT_ACTIONS.DRAW_CREATED,
                draw.id,
                'system',
                { drawNumber, drawType, scheduledTime: scheduledTime.toISOString() }
            );

            return draw;
        } catch (error) {
            // Ignorar error de duplicado
            if (error.message.includes('ya existe')) {
                return null;
            }
            throw error;
        }
    }

    /**
     * Generar número de sorteo único
     * Formato: YYYYMMDD-HHMM-TYPE
     */
    generateDrawNumber(scheduledTime, drawType) {
        const year = scheduledTime.getUTCFullYear();
        const month = String(scheduledTime.getUTCMonth() + 1).padStart(2, '0');
        const day = String(scheduledTime.getUTCDate()).padStart(2, '0');
        const hours = String(scheduledTime.getUTCHours()).padStart(2, '0');
        const minutes = String(scheduledTime.getUTCMinutes()).padStart(2, '0');
        const typeCode = drawType === 'lottery' ? 'LF' : 'LB';

        return `${year}${month}${day}-${hours}${minutes}-${typeCode}`;
    }

    /**
     * Abrir sorteos programados
     * Los sorteos se abren automáticamente cuando están scheduled y es hora
     */
    async openScheduledDraws() {
        try {
            const draws = await Draw.getNeedingOpen();

            for (const draw of draws) {
                // Abrir el sorteo
                await Draw.open(draw.id);

                console.log(`Sorteo abierto: ${draw.draw_number}`);

                await AuditLog.logDrawAction(
                    AUDIT_ACTIONS.DRAW_OPENED,
                    draw.id,
                    'system',
                    { drawNumber: draw.draw_number }
                );
            }

            return draws.length;
        } catch (error) {
            console.error('Error abriendo sorteos:', error);
            throw error;
        }
    }
}

module.exports = new DrawScheduler();
